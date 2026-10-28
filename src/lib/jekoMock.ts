// Fausse caisse Jèko, au format de l'API réelle (developer.jeko.africa), pour que le vrai branchement soit direct.
// Jèko n'a pas de bac à sable : un test sur la vraie API déplace de l'argent réel. Rien ici n'appelle le réseau.
//
// Correspondance avec l'API réelle :
//   GET  /partner_api/stores            ->  listStores()
//   POST /partner_api/payment_requests  ->  postPaymentRequest({ storeId, amountCents, currency, reference, paymentDetails })
//   Montants de la demande               ->  en centimes : 5 FCFA s'écrit 500 (FCFA x 100), minimum 5 FCFA
//   Webhook TRANSACTION_COMPLETED        ->  simulateClientPayment() fabrique le message signé que Jèko enverrait
//
// Non reproduit : l'authentification (en-têtes X-API-KEY et X-API-KEY-ID), car il n'y a pas d'appel HTTP.
// À vérifier dans la documentation Jèko : la forme exacte de `paymentDetails` (supposée ici : { paymentMethod }),
// et si les montants du webhook sont bien en FCFA (déduit de l'exemple : 1000 avec 15 de frais).
// Simulés : les frais (1,5 %), le client (« Client de démonstration ») et le moyen de paiement par défaut.

import { randomBytes, randomUUID } from "node:crypto";
import { getConfig } from "./config";
import type { Wallet } from "./intent";
import {
  EVENT_TRANSACTION_COMPLETED, signBody, WEBHOOK_VERSION, type HeaderBag, type TransactionCompletedPayload,
} from "./jekoWebhook";
import type { Cashier } from "./ports";

export interface JekoStore {
  id: string;
  name: string;
}

export const DEMO_STORE: JekoStore = { id: "01a0b1c2-d3e4-7f89-a0b1-c2d3e4f5a6b7", name: "Boutique d'Awa (démo)" };
/** Minimum Mobile Money : 5 FCFA, soit 500 centimes. */
export const MIN_AMOUNT_CENTS = 500;
export const SIMULATED_FEE_RATE = 0.015;

export interface PaymentRequestBody {
  storeId: string;
  amountCents: number;
  currency: string;
  reference: string;
  paymentDetails: { paymentMethod?: Wallet };
}

export interface PaymentRequest {
  id: string;
  storeId: string;
  amountCents: number;
  currency: "XOF";
  reference: string;
  paymentDetails: { paymentMethod?: Wallet };
  status: "pending" | "paid";
  redirectUrl: string;
}

export interface Transfer {
  id: string;
  amountCents: number;
  currency: "XOF";
  to: string;
  status: "completed";
}

export interface WebhookDelivery {
  /** Le corps exact qui a été signé. */
  rawBody: string;
  headers: Record<string, string>;
}

export type JekoErrorCode =
  | "unknown_store" | "invalid_currency" | "invalid_amount" | "amount_too_small" | "unknown_payment_request" | "already_paid";

export class JekoApiError extends Error {
  constructor(readonly code: JekoErrorCode, message: string) {
    super(message);
    this.name = "JekoApiError";
  }
}

const pad = (n: number) => String(n).padStart(2, "0");
/** « 2024-01-15 14:30:25 », en UTC (Abidjan). */
const formatExecutedAt = (d: Date) =>
  `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;

const newId = (prefix: string) => `${prefix}_${randomUUID().slice(0, 8)}`;

export class JekoMock implements Cashier {
  /** Clé de signature : celle de la configuration, sinon une clé aléatoire propre à ce démarrage. Jamais journalisée. */
  readonly webhookSecret: string;
  private readonly clock: () => Date;
  private readonly stores: JekoStore[];
  private readonly requests = new Map<string, PaymentRequest>();
  private readonly transferLog: Transfer[] = [];

  constructor(options: { secret?: string; clock?: () => Date; stores?: JekoStore[] } = {}) {
    this.webhookSecret = options.secret ?? getConfig().jekoWebhookSecret ?? randomBytes(32).toString("hex");
    this.clock = options.clock ?? (() => new Date());
    this.stores = options.stores ?? [DEMO_STORE];
  }

  /** GET /partner_api/stores */
  listStores(): JekoStore[] {
    return this.stores.map((s) => ({ ...s }));
  }

  /** POST /partner_api/payment_requests */
  postPaymentRequest(body: PaymentRequestBody): PaymentRequest {
    return this.create(body, newId("pr"));
  }

  getPaymentRequest(id: string): PaymentRequest | undefined {
    return this.requests.get(id);
  }

  listTransfers(): Transfer[] {
    return [...this.transferLog];
  }

  // --- Contrat Cashier (montants en FCFA, convertis en centimes à la frontière de l'API) ---

  createPaymentRequest(args: { amount: number; wallet?: Wallet }): PaymentRequest {
    const id = newId("pr");
    // Notre référence est l'identifiant de la demande : le récepteur du webhook retrouve ainsi l'opération.
    return this.create(
      {
        storeId: this.stores[0].id,
        amountCents: Math.round(args.amount * 100),
        currency: "XOF",
        reference: id,
        paymentDetails: args.wallet ? { paymentMethod: args.wallet } : {},
      },
      id,
    );
  }

  createTransfer(args: { amount: number; to: string }): Transfer {
    const amountCents = Math.round(args.amount * 100);
    this.checkAmount(amountCents);
    const transfer: Transfer = { id: newId("tr"), amountCents, currency: "XOF", to: args.to, status: "completed" };
    this.transferLog.push(transfer);
    return transfer;
  }

  /**
   * Le client paie : Jèko enverrait ce webhook signé. La demande passe à « payée » côté caisse ;
   * c'est le récepteur de l'application qui décide, après vérification, d'annoncer le paiement.
   */
  simulateClientPayment(paymentRequestId: string): WebhookDelivery {
    const req = this.requests.get(paymentRequestId);
    if (!req) throw new JekoApiError("unknown_payment_request", "Demande de paiement inconnue");
    if (req.status === "paid") throw new JekoApiError("already_paid", "Demande déjà payée");
    req.status = "paid";

    const amount = req.amountCents / 100;
    const store = this.stores.find((s) => s.id === req.storeId) as JekoStore;
    const payload: TransactionCompletedPayload = {
      id: `txn_${randomBytes(5).toString("hex")}`,
      amount: { amount, currency: "XOF" },
      fees: { amount: Math.round(amount * SIMULATED_FEE_RATE), currency: "XOF" },
      status: "success",
      counterpartLabel: "Client de démonstration",
      counterpartIdentifier: "+2250100000000",
      paymentMethod: req.paymentDetails.paymentMethod ?? "wave",
      transactionType: "payment",
      businessName: "Marché d'Adjamé (démo)",
      storeId: store.id,
      storeName: store.name,
      executedAt: formatExecutedAt(this.clock()),
      transactionDetails: { id: randomUUID(), reference: req.reference, paymentLinkId: null },
    };
    const rawBody = JSON.stringify(payload);
    const headers: HeaderBag & Record<string, string> = {
      "Content-Type": "application/json",
      "Jeko-Event": EVENT_TRANSACTION_COMPLETED,
      "Jeko-Signature": signBody(rawBody, this.webhookSecret),
      "Jeko-Webhook-Version": WEBHOOK_VERSION,
    };
    return { rawBody, headers };
  }

  // --- Interne ---

  private checkAmount(amountCents: number) {
    if (!Number.isInteger(amountCents) || amountCents <= 0) throw new JekoApiError("invalid_amount", "Montant invalide");
    if (amountCents < MIN_AMOUNT_CENTS) throw new JekoApiError("amount_too_small", "Minimum : 5 FCFA (500 centimes)");
  }

  private create(body: PaymentRequestBody, id: string): PaymentRequest {
    if (!this.stores.some((s) => s.id === body.storeId)) throw new JekoApiError("unknown_store", "Magasin inconnu");
    if (body.currency !== "XOF") throw new JekoApiError("invalid_currency", "Seul le XOF est accepté");
    this.checkAmount(body.amountCents);
    const req: PaymentRequest = {
      id,
      storeId: body.storeId,
      amountCents: body.amountCents,
      currency: "XOF",
      reference: body.reference,
      paymentDetails: { ...body.paymentDetails },
      status: "pending",
      redirectUrl: `https://pay.jeko.invalid/simulation/${id}`,
    };
    this.requests.set(id, req);
    return req;
  }
}
