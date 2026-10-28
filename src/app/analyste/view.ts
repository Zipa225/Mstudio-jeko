// Aides pures de l'écran analyste : libellés, choix de la bannière, compteurs. Sans React, donc testables.

import type { Decision, Factor } from "../../lib/risk";
import type { Alert, Operation, OperationStatus } from "../../lib/store";

export type DuressState = "disabled" | "weak" | "active";

/** Ce que renvoie GET /api/state. */
export interface AnalystState {
  now: number;
  merchant: { name: string; shop: string };
  thresholds: { verify: number; block: number };
  ceiling: number;
  duress: DuressState;
  demoMode: boolean;
  counts: Record<OperationStatus, number>;
  criticalAlerts: number;
  operations: Operation[];
  alerts: Alert[];
}

export const STATUS_LABEL: Record<OperationStatus, string> = {
  to_confirm: "À confirmer",
  awaiting_payment: "Attend le paiement",
  paid: "Payée",
  executed: "Exécutée",
  cancelled: "Annulée",
  held: "Retenue",
  blocked: "Bloquée",
  failed: "Échec",
};

/** La teinte d'une pastille d'état. Le rouge est réservé à la bannière « Contrainte signalée ». */
export type Tone = "ok" | "wait" | "neutral" | "held" | "warn";

export const STATUS_TONE: Record<OperationStatus, Tone> = {
  to_confirm: "wait",
  awaiting_payment: "wait",
  paid: "ok",
  executed: "ok",
  cancelled: "neutral",
  held: "held",
  blocked: "warn",
  failed: "warn",
};

export const KIND_LABEL: Record<Operation["kind"], string> = { collect: "Encaissement", send: "Transfert" };

export const DECISION_LABEL: Record<Decision, string> = { accept: "Accepté", verify: "À vérifier", block: "Bloqué" };

/** L'heure à Abidjan (UTC toute l'année), « 14:03:07 ». */
export function formatClock(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

/** « 0701020304 » devient « 07 01 02 03 04 ». */
export const formatPhoneNumber = (phone: string): string => phone.replace(/(\d{2})(?=\d)/g, "$1 ");

/** Bénéficiaire ou moyen de paiement, tel qu'on l'affiche dans le tableau. */
export function operationTarget(op: Operation): string {
  if (op.kind === "send") return op.beneficiary ?? (op.phone ? formatPhoneNumber(op.phone) : "Numéro inconnu");
  return op.wallet ? { wave: "Wave", orange: "Orange", mtn: "MTN", moov: "Moov" }[op.wallet] : "Sans moyen précisé";
}

/**
 * L'alerte à afficher dans la bannière rouge : la plus récente alerte critique que l'analyste n'a pas encore prise en compte.
 * `alerts` est trié du plus récent au plus ancien, comme le renvoie /api/state.
 */
export function pickBanner(alerts: Alert[], dismissed: ReadonlySet<string>): Alert | undefined {
  return alerts.find((a) => a.level === "critical" && !dismissed.has(a.id));
}

export interface CounterSpec {
  id: string;
  label: string;
  value: number;
  /** Mis en avant quand la valeur est positive (retenues, alertes critiques). */
  highlight: boolean;
}

export function counters(state: Pick<AnalystState, "counts" | "criticalAlerts">): CounterSpec[] {
  const c = state.counts;
  return [
    { id: "paid", label: "Encaissements payés", value: c.paid, highlight: false },
    { id: "pending", label: "En cours", value: c.to_confirm + c.awaiting_payment, highlight: false },
    { id: "executed", label: "Transferts envoyés", value: c.executed, highlight: false },
    { id: "blocked", label: "Bloquées", value: c.blocked, highlight: false },
    { id: "held", label: "Retenues", value: c.held, highlight: c.held > 0 },
    { id: "critical", label: "Alertes critiques", value: state.criticalAlerts, highlight: state.criticalAlerts > 0 },
  ];
}

/** Message d'avertissement quand la détection de contrainte ne peut pas fonctionner. */
export function duressNotice(status: DuressState): string | undefined {
  if (status === "disabled") return "Phrase de contrainte non configurée : la détection est désactivée.";
  if (status === "weak") return "Phrase de contrainte trop courte : la détection est désactivée.";
  return undefined;
}

export const factorChip = (f: Pick<Factor, "label" | "points">): string => `${f.label} +${f.points}`;

export type AlertTone = "critical" | "warning" | "info";
export const alertTone = (a: Pick<Alert, "level">): AlertTone => a.level;

export const ALERT_TONE_LABEL: Record<AlertTone, string> = { critical: "Critique", warning: "Attention", info: "Information" };
