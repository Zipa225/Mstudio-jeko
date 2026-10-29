// Client de l'API Argus : chaque opération est examinée AVANT d'être exécutée.
// Contrat lu dans la branche `develop` d'Argus : POST /v1/transactions/score, en-tête X-License-Key.
// Argus calcule lui-même l'historique et les agrégats du compte : on n'envoie que les champs bruts de l'opération.
// Décisions d'Argus : ALLOW (accepter), VERIFY (vérifier), QUARANTINE et BLOCK (refuser, alerte de rappel).
// Si le moteur ML d'Argus est en panne, Argus répond quand même et ne descend jamais sous QUARANTINE (repli « fail-closed ») :
// on lit `decision`, jamais seulement le code HTTP.
// La clé de licence et l'adresse n'apparaissent dans aucun message d'erreur ni journal.

import { randomUUID } from "node:crypto";
import type { AsyncRisk, RiskAssessment, RiskRequest, SyncRisk } from "./ports";
import { getConfig } from "./config";
import { scoreRisk, type Decision, type Factor } from "./risk";

/** Compte du client qui paie, pour un encaissement (identifiant de démonstration). */
export const CLIENT_ACCOUNT_ID = "client-demo";
const MAX_FACTORS = 6;

export type ArgusErrorKind = "timeout" | "network" | "http" | "invalid";

export class ArgusError extends Error {
  constructor(readonly kind: ArgusErrorKind, message: string, readonly status?: number) {
    super(message);
    this.name = "ArgusError";
  }
}

export interface ArgusOptions {
  baseUrl: string;
  licenseKey: string;
  /** Compte d'Awa : émetteur d'un transfert, bénéficiaire d'un encaissement. */
  senderAccountId: string;
  deviceId: string;
  timeoutMs?: number;
  /** Pour les tests. */
  fetchImpl?: typeof fetch;
  newId?: () => string;
}

const DECISIONS: Record<string, Decision> = { ALLOW: "accept", VERIFY: "verify", QUARANTINE: "block", BLOCK: "block" };

interface ArgusFactor {
  feature_name?: unknown;
  feature_value?: unknown;
  impact?: unknown;
  rank?: unknown;
  label?: unknown;
}

function mapFactors(raw: unknown): Factor[] {
  if (!Array.isArray(raw)) return [];
  return (raw as ArgusFactor[])
    .filter((f) => typeof f?.feature_name === "string" && typeof f.impact === "number" && Math.round(f.impact) > 0)
    .sort((a, b) => Number(a.rank ?? 99) - Number(b.rank ?? 99))
    .slice(0, MAX_FACTORS)
    .map((f) => ({
      id: String(f.feature_name),
      label: typeof f.label === "string" && f.label.trim() ? f.label.trim() : String(f.feature_name),
      points: Math.round(f.impact as number),
      detail: `Valeur : ${String(f.feature_value)}`,
    }));
}

function toAssessment(data: unknown): RiskAssessment {
  const d = data as { decision?: unknown; risk_score?: unknown; decision_reason?: unknown; model_version?: unknown; factors?: unknown };
  const decision = typeof d?.decision === "string" ? DECISIONS[d.decision] : undefined;
  if (!decision || typeof d.risk_score !== "number" || !Number.isFinite(d.risk_score)) {
    throw new ArgusError("invalid", "Réponse d'Argus illisible");
  }
  const assessment: RiskAssessment = {
    score: Math.min(100, Math.max(0, Math.round(d.risk_score))),
    decision,
    factors: mapFactors(d.factors),
    source: "argus",
  };
  if (typeof d.decision_reason === "string" && d.decision_reason.trim()) assessment.decisionReason = d.decision_reason.trim();
  if (typeof d.model_version === "string") assessment.modelVersion = d.model_version;
  return assessment;
}

/** Les raisons de son modèle : « conforme aux habitudes », « autorisation immédiate ». */
const CONTRADICTION = /conforme|autorisation imm[ée]diate/i;

/**
 * Quand une règle d'Argus fait monter la décision (vérifier, refuser) alors que son modèle trouve l'opération normale,
 * Argus renvoie la raison et les facteurs du MODÈLE (« conforme aux habitudes ») : la phrase dite à la vendeuse se
 * contredirait. On garde la décision d'Argus (c'est elle qui fait foi) et on l'explique avec nos propres critères.
 */
function explain(a: RiskAssessment, request: RiskRequest): RiskAssessment {
  if (a.decision === "accept") return a;
  const contradictory = a.decisionReason !== undefined && CONTRADICTION.test(a.decisionReason);
  if (!contradictory && (a.decisionReason || a.factors.length > 0)) return a;
  const { decisionReason: _dropped, ...rest } = a;
  try {
    const local = scoreRisk(
      { kind: request.kind, amount: request.amount, beneficiaryKnown: request.beneficiaryKnown, avgTicket: request.avgTicket, previousOps: request.previousOps, now: request.now },
      getConfig(),
    );
    return { ...rest, factors: local.factors };
  } catch {
    return contradictory ? { ...rest, factors: [] } : a;
  }
}

export function createArgusRisk(options: ArgusOptions): AsyncRisk {
  let base: URL;
  try {
    base = new URL(options.baseUrl);
  } catch {
    throw new Error("Adresse d'Argus invalide");
  }
  if (base.protocol !== "http:" && base.protocol !== "https:") throw new Error("Adresse d'Argus invalide");
  if (!options.licenseKey) throw new Error("Clé de licence Argus manquante");

  const endpoint = `${base.origin}${base.pathname.replace(/\/+$/, "")}/v1/transactions/score`;
  const fetchImpl = options.fetchImpl ?? fetch;
  const newId = options.newId ?? (() => `VOIX-${randomUUID()}`);
  const timeoutMs = options.timeoutMs ?? 2000;

  return {
    async: true,
    async assess(request: RiskRequest): Promise<RiskAssessment> {
      const send = request.kind === "send";
      const body = {
        // Argus est idempotent sur cet identifiant : chaque tentative a le sien, un rejeu donnerait 409.
        transaction_id: newId(),
        sender_account_id: send ? options.senderAccountId : CLIENT_ACCOUNT_ID,
        beneficiary_account_id: send ? request.beneficiaryAccount : options.senderAccountId,
        amount: request.amount,
        currency: "XOF",
        timestamp: request.now.toISOString(),
        transaction_channel: "app",
        transaction_type: send ? "transfer" : "cash_in",
        device_id: options.deviceId,
      };

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      let response: Response;
      try {
        response = await fetchImpl(endpoint, {
          method: "POST",
          headers: { "content-type": "application/json", "x-license-key": options.licenseKey },
          body: JSON.stringify(body),
          signal: controller.signal,
          cache: "no-store",
        });
      } catch (e) {
        throw controller.signal.aborted || (e as { name?: string })?.name === "AbortError"
          ? new ArgusError("timeout", "Argus n'a pas répondu à temps")
          : new ArgusError("network", "Argus est injoignable");
      } finally {
        clearTimeout(timer);
      }

      if (!response.ok) throw new ArgusError("http", `Argus a répondu avec le code ${response.status}`, response.status);
      let data: unknown;
      try {
        data = await response.json();
      } catch {
        throw new ArgusError("invalid", "Réponse d'Argus illisible");
      }
      return explain(toAssessment(data), request);
    },
  };
}

/** Texte sans détail sensible, pour dire pourquoi on est passé au secours. */
export function describeArgusFailure(error: unknown): string {
  if (error instanceof ArgusError) {
    if (error.kind === "timeout") return "Argus n'a pas répondu à temps";
    if (error.kind === "http") return `Argus a refusé la demande (code ${error.status})`;
    if (error.kind === "invalid") return "Argus a renvoyé une réponse illisible";
  }
  return "Argus est injoignable";
}

/**
 * Argus d'abord ; s'il échoue, le calcul local prend le relais, marqué « dégradé », et on prévient (`onDegraded`).
 * On n'exécute jamais une opération sans score.
 */
export function withFallback(primary: AsyncRisk, fallback: SyncRisk, onDegraded?: (reason: string) => void): AsyncRisk {
  return {
    async: true,
    async assess(request: RiskRequest): Promise<RiskAssessment> {
      try {
        return await primary.assess(request);
      } catch (error) {
        onDegraded?.(describeArgusFailure(error));
        return { ...fallback.assess(request), source: "local", degraded: true };
      }
    },
  };
}
