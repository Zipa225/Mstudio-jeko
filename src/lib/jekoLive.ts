// Client de la VRAIE API Jèko (developer.jeko.africa), appelé UNIQUEMENT depuis le serveur.
// Jèko n'a pas de bac à sable : chaque demande de paiement créée ici est réelle (petits montants pour les essais).
//
// Contrat lu dans la documentation :
//   Authentification : en-têtes X-API-KEY et X-API-KEY-ID (clés créées dans l'application Jèko Business).
//   POST /partner_api/payment_requests
//     { storeId, amountCents (FCFA x 100, minimum 500), currency "XOF", reference,
//       paymentDetails: { type: "redirect", data: { paymentMethod, successUrl, errorUrl } } }
//     -> { ..., redirectUrl } : le lien où le client paie.
//   GET /partner_api/stores -> les boutiques du compte (pour trouver JEKO_STORE_ID).
//   Le paiement est confirmé plus tard par le webhook TRANSACTION_COMPLETED, qui ramène notre `reference`.
//
// Transferts : le contrat de POST /partner_api/transfers exige un `contactId` dont le format n'est pas documenté, et la
// décision D3 du plan désactive les vrais transferts pour la démonstration. Ils sont donc SIMULÉS ici : aucun appel
// réseau, aucun argent ne bouge. L'écran, l'analyste et Argus voient la même chose qu'avec un vrai transfert.
// Aucune clé n'apparaît dans un message d'erreur ni dans un journal.

import { randomBytes, randomUUID } from "node:crypto";
import type { Wallet } from "./intent";
import type { AsyncCashier } from "./ports";

/** Minimum Mobile Money : 5 FCFA. */
export const MIN_LIVE_AMOUNT = 5;
/** Moyen de paiement du lien quand la vendeuse n'en a pas précisé. */
export const DEFAULT_WALLET: Wallet = "wave";

export type JekoErrorKind = "timeout" | "network" | "http" | "invalid" | "rejected";

export class JekoHttpError extends Error {
  constructor(readonly kind: JekoErrorKind, message: string, readonly status?: number) {
    super(message);
    this.name = "JekoHttpError";
  }
}

export interface JekoLiveOptions {
  baseUrl: string;
  apiKey: string;
  apiKeyId: string;
  storeId: string;
  /** Adresse publique de l'application : où revient le client après le paiement. */
  publicBaseUrl: string;
  timeoutMs?: number;
  /** Pour les tests. */
  fetchImpl?: typeof fetch;
  /** Pour les tests : fabrique de références. */
  newReference?: () => string;
}

export interface JekoLive extends AsyncCashier {
  readonly mode: "live";
  decoyPayUrl(id: string): string;
  /** GET /partner_api/stores, tel que renvoyé par Jèko (pour les scripts). */
  listStores(): Promise<unknown>;
}

const hex = (bytes: number) => randomBytes(bytes).toString("hex");
/** Adresse de retour acceptée par Jèko quand l'application n'a pas encore d'adresse publique. */
const RETURN_FALLBACK = new URL("https://example.org");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Même forme que les identifiants de la fausse caisse : `pr_` + 8 caractères. */
const defaultReference = () => `pr_${hex(4)}`;

function parseHttpUrl(value: string, what: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${what} invalide`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error(`${what} invalide`);
  return url;
}

export function createJekoLive(options: JekoLiveOptions): JekoLive {
  const base = parseHttpUrl(options.baseUrl, "Adresse de Jèko");
  const publicBase = parseHttpUrl(options.publicBaseUrl, "Adresse publique de l'application");
  if (!options.apiKey || !options.apiKeyId) throw new Error("Clés Jèko manquantes");
  if (!options.storeId) throw new Error("Identifiant de boutique Jèko manquant");

  const root = `${base.origin}${base.pathname.replace(/\/+$/, "")}`;
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 8000;
  const newReference = options.newReference ?? defaultReference;
  // Jèko refuse les adresses de retour en localhost ou sans nom de domaine (constaté : « must be a valid URL »).
  // En local, le client revient donc sur une adresse neutre ; avec PUBLIC_BASE_URL public, il revient sur l'application.
  const returnBase = /^(localhost|127\.|\[|.*\.localhost$)/.test(publicBase.hostname) || !publicBase.hostname.includes(".") ? RETURN_FALLBACK : publicBase;
  const returnUrl = (result: "ok" | "erreur") => new URL(`/?paiement=${result}`, returnBase).toString();
  /** Dernier vrai lien reçu : sert de modèle au lien factice de la réponse sous contrainte. */
  let lastRealUrl: URL | undefined;

  async function call(path: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetchImpl(`${root}${path}`, {
        ...init,
        headers: {
          ...(init.headers as Record<string, string> | undefined),
          "x-api-key": options.apiKey,
          "x-api-key-id": options.apiKeyId,
        },
        signal: controller.signal,
        cache: "no-store",
      });
    } catch (e) {
      throw controller.signal.aborted || (e as { name?: string })?.name === "AbortError"
        ? new JekoHttpError("timeout", "Jèko n'a pas répondu à temps")
        : new JekoHttpError("network", "Jèko est injoignable");
    } finally {
      clearTimeout(timer);
    }
  }

  const failIfNotOk = (res: Response) => {
    if (!res.ok) throw new JekoHttpError("http", `Jèko a répondu avec le code ${res.status}`, res.status);
  };

  return {
    async: true,
    mode: "live",

    async createPaymentRequest({ amount, wallet }) {
      if (!Number.isInteger(amount) || amount < MIN_LIVE_AMOUNT) throw new JekoHttpError("rejected", "Montant invalide");
      const reference = newReference();
      const res = await call("/partner_api/payment_requests", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          storeId: options.storeId,
          amountCents: amount * 100,
          currency: "XOF",
          reference,
          paymentDetails: {
            type: "redirect",
            data: { paymentMethod: wallet ?? DEFAULT_WALLET, successUrl: returnUrl("ok"), errorUrl: returnUrl("erreur") },
          },
        }),
      });
      failIfNotOk(res);

      let data: { redirectUrl?: unknown } | null;
      try {
        data = (await res.json()) as { redirectUrl?: unknown } | null;
      } catch {
        throw new JekoHttpError("invalid", "Réponse de Jèko illisible");
      }
      // Le lien est affiché à la vendeuse : seul un lien https est accepté (jamais javascript: ni data:).
      let link: URL | undefined;
      if (data && typeof data.redirectUrl === "string") {
        try {
          link = new URL(data.redirectUrl);
        } catch {
          link = undefined;
        }
      }
      if (!link || link.protocol !== "https:") throw new JekoHttpError("invalid", "Réponse de Jèko illisible");
      lastRealUrl = link;
      return { id: reference, payUrl: link.toString() };
    },

    async createTransfer() {
      // Simulé, voir l'en-tête du fichier : aucun argent ne bouge.
      return { id: `tr_${hex(4)}` };
    },

    decoyPayUrl(id: string) {
      const model = lastRealUrl ?? new URL("https://pay.jeko.africa/");
      const segments = model.pathname.split("/").filter(Boolean);
      const last = segments.at(-1) ?? "";
      const token = UUID.test(last) ? randomUUID() : (id.replace(/[^A-Za-z0-9]/g, "") + hex(16)).slice(0, Math.max(8, last.length));
      const decoy = new URL(model.origin);
      decoy.pathname = `/${[...segments.slice(0, -1), token].join("/")}`;
      return decoy.toString();
    },

    async listStores() {
      const res = await call("/partner_api/stores", { method: "GET" });
      failIfNotOk(res);
      try {
        return (await res.json()) as unknown;
      } catch {
        throw new JekoHttpError("invalid", "Réponse de Jèko illisible");
      }
    },
  };
}

/** Texte sans détail sensible, pour dire pourquoi Jèko a échoué. */
export function describeJekoFailure(error: unknown): string {
  if (error instanceof JekoHttpError) {
    if (error.kind === "timeout") return "Jèko n'a pas répondu à temps";
    if (error.kind === "rejected") return error.message;
    if (error.kind === "invalid") return "Jèko a renvoyé une réponse illisible";
    if (error.kind === "http") {
      if (error.status === 401 || error.status === 403) return "Les clés Jèko sont refusées";
      if (error.status === 404) return "Boutique ou adresse Jèko introuvable (vérifie JEKO_STORE_ID)";
      if (error.status === 429) return "Limite d'appels Jèko atteinte";
      if (error.status === 400 || error.status === 422) return `Jèko a refusé la demande (code ${error.status}) : vérifie le montant et le moyen de paiement`;
      return `Jèko a refusé la demande (code ${error.status})`;
    }
  }
  return "Jèko est injoignable";
}
