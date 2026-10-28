// Webhook TRANSACTION_COMPLETED de Jèko : signature (HMAC-SHA256 du corps brut, en hexadécimal) et récepteur.
// Règle : « Paiement reçu » n'est annoncé qu'APRÈS vérification de la signature, du montant et de la demande.

import { createHmac, timingSafeEqual } from "node:crypto";
import { paymentReceivedTurn, type TurnResult } from "./dialog";
import type { Store } from "./store";

export const EVENT_TRANSACTION_COMPLETED = "TRANSACTION_COMPLETED";
export const WEBHOOK_VERSION = "1";

/** Format donné par Jèko. Les montants du webhook sont en FCFA (et non en centimes, contrairement à la demande de paiement). */
export interface TransactionCompletedPayload {
  id: string;
  amount: { amount: number; currency: string };
  fees: { amount: number; currency: string };
  status: string;
  counterpartLabel: string;
  counterpartIdentifier: string;
  paymentMethod: string;
  transactionType: string;
  businessName: string;
  storeId: string;
  storeName: string;
  executedAt: string;
  transactionDetails: { id: string; reference: string; paymentLinkId: string | null };
}

export type HeaderBag = Record<string, string | undefined>;

export interface WebhookRequest {
  /** Le corps tel que reçu, caractère pour caractère : c'est lui qui est signé. */
  rawBody: string;
  headers: HeaderBag;
}

export const signBody = (rawBody: string, secret: string): string =>
  createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");

/** Comparaison à temps constant. Une signature absente, mal formée ou d'une autre longueur est refusée. */
export function verifySignature(rawBody: string, signature: string | undefined, secret: string): boolean {
  if (!secret || !signature) return false;
  const given = signature.trim();
  if (!/^[0-9a-fA-F]{64}$/.test(given)) return false;
  return timingSafeEqual(Buffer.from(signBody(rawBody, secret), "hex"), Buffer.from(given, "hex"));
}

const header = (headers: HeaderBag, name: string): string | undefined => {
  const wanted = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) if (key.toLowerCase() === wanted) return value;
  return undefined;
};

export type WebhookRefusal =
  | "bad_signature" | "unsupported_version" | "unsupported_event" | "bad_payload"
  | "unknown_payment" | "amount_mismatch" | "not_success";

export type WebhookOutcome =
  | { ok: true; status: 200; duplicate: boolean; operationId: string; announcement?: TurnResult }
  | { ok: false; status: 400 | 401 | 404 | 409; reason: WebhookRefusal };

const STATUS: Record<WebhookRefusal, 400 | 401 | 404 | 409> = {
  bad_signature: 401, unsupported_version: 400, unsupported_event: 400, bad_payload: 400,
  unknown_payment: 404, amount_mismatch: 409, not_success: 409,
};

const refuse = (reason: WebhookRefusal): WebhookOutcome => ({ ok: false, status: STATUS[reason], reason });

function parsePayload(rawBody: string): TransactionCompletedPayload | undefined {
  let data: unknown;
  try {
    data = JSON.parse(rawBody);
  } catch {
    return undefined;
  }
  const p = data as Partial<TransactionCompletedPayload> | null;
  const money = (m: unknown) =>
    typeof m === "object" && m !== null && Number.isInteger((m as { amount?: unknown }).amount) &&
    typeof (m as { currency?: unknown }).currency === "string";
  if (
    !p || typeof p !== "object" || typeof p.id !== "string" || !money(p.amount) || typeof p.status !== "string" ||
    !p.transactionDetails || typeof p.transactionDetails.reference !== "string"
  ) {
    return undefined;
  }
  return p as TransactionCompletedPayload;
}

/**
 * Récepteur du webhook. Ordre des contrôles : signature, version, événement, contenu, demande connue, montant, statut.
 * Rien n'est modifié tant que tout n'est pas valide. Un second envoi du même webhook est accepté sans rien refaire.
 */
export function createWebhookReceiver(deps: { store: Store; secret: string }): (req: WebhookRequest) => WebhookOutcome {
  if (!deps.secret) throw new Error("Clé de signature du webhook manquante");
  const { store, secret } = deps;

  return ({ rawBody, headers }) => {
    if (!verifySignature(rawBody, header(headers, "Jeko-Signature"), secret)) {
      store.addAlert({
        level: "warning",
        type: "webhook",
        title: "Message de paiement refusé",
        detail: "La signature du message n'est pas valide. Aucun paiement n'a été enregistré.",
      });
      return refuse("bad_signature");
    }
    if (header(headers, "Jeko-Webhook-Version") !== WEBHOOK_VERSION) return refuse("unsupported_version");
    if (header(headers, "Jeko-Event") !== EVENT_TRANSACTION_COMPLETED) return refuse("unsupported_event");

    const payload = parsePayload(rawBody);
    if (!payload) return refuse("bad_payload");

    const op = store.operations.find((o) => o.kind === "collect" && o.paymentId === payload.transactionDetails.reference);
    if (!op) return refuse("unknown_payment");

    if (payload.amount.currency !== "XOF" || payload.amount.amount !== op.amount) {
      store.addAlert({
        level: "warning",
        type: "webhook",
        title: "Message de paiement refusé",
        detail: "Le montant annoncé ne correspond pas à la demande de paiement. Aucun paiement n'a été enregistré.",
        operationId: op.id,
      });
      return refuse("amount_mismatch");
    }
    if (payload.status !== "success") return refuse("not_success");

    if (op.status === "paid") return { ok: true, status: 200, duplicate: true, operationId: op.id };
    if (op.status !== "awaiting_payment") return refuse("unknown_payment");

    store.updateOperation(op.id, { status: "paid" });
    return { ok: true, status: 200, duplicate: false, operationId: op.id, announcement: paymentReceivedTurn(op) };
  };
}
