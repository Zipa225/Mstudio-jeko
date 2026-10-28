// État en mémoire du prototype : opérations, alertes, sessions, contacts. Pas de base de données.
// Une classe sans variable globale : l'horloge est injectée, ce qui rend les règles de nuit et de rafale testables.

import { randomUUID } from "node:crypto";
import type { Wallet } from "./intent";
import type { Decision, Factor } from "./risk";
import { normalize } from "./text";

/**
 * Cycle de vie : à confirmer, puis exécutée (transfert) ou en attente de paiement puis payée (encaissement) ;
 * annulée (le marchand dit non), retenue (contrainte), bloquée (score trop élevé), échouée (la caisse a refusé).
 */
export type OperationStatus =
  | "to_confirm" | "awaiting_payment" | "paid" | "executed" | "cancelled" | "held" | "blocked" | "failed";

export interface Operation {
  id: string;
  ts: number;
  kind: "collect" | "send";
  /** FCFA. */
  amount: number;
  wallet?: Wallet;
  beneficiary?: string;
  phone?: string;
  status: OperationStatus;
  score: number;
  decision: Decision;
  factors: Factor[];
  verifiedByVoice: boolean;
  paymentId?: string;
}

export interface Alert {
  id: string;
  ts: number;
  level: "info" | "warning" | "critical";
  type: "verified" | "blocked" | "duress" | "failed" | "webhook";
  title: string;
  detail: string;
  operationId?: string;
  score?: number;
  factors?: Factor[];
}

export interface Contact {
  name: string;
  phone: string;
}

export interface Merchant {
  name: string;
  shop: string;
  contacts: Contact[];
}

/** Commande en cours d'élaboration (le « brouillon ») : elle vit dans la session, pas dans les opérations. */
export interface Pending {
  stage: "need_amount" | "need_beneficiary" | "confirm";
  kind: "collect" | "send";
  amount?: number;
  wallet?: Wallet;
  beneficiary?: string;
  phone?: string;
  /** Renseignée à l'étape de confirmation : l'opération évaluée par Argus. */
  operationId?: string;
}

export interface Session {
  id: string;
  pending?: Pending;
}

/** Panier moyen utilisé quand le marchand n'a encore aucun encaissement payé. */
export const DEFAULT_AVG_TICKET = 5000;
export const BURST_WINDOW_MS = 10 * 60_000;

/** Encaissements d'exemple (données simulées) : panier moyen de 4 500 FCFA. */
const SEED_AMOUNTS = [2500, 5000, 3000, 7500, 1500, 4000, 6000, 2000, 8000, 5500];

const startOfUtcDay = (ms: number) => ms - (ms % 86_400_000);

export class Store {
  merchant!: Merchant;
  operations: Operation[] = [];
  alerts: Alert[] = [];
  private sessions = new Map<string, Session>();

  constructor(private readonly clock: () => Date = () => new Date(), seed = true) {
    this.reset(seed);
  }

  now(): Date {
    return this.clock();
  }

  /** Remet la démonstration à zéro. Avec `seed`, recharge les données d'exemple. */
  reset(seed = true): void {
    this.operations = [];
    this.alerts = [];
    this.sessions = new Map();
    this.merchant = {
      name: "Awa (personnage de démonstration)",
      shop: "Marché d'Adjamé",
      contacts: seed
        ? [
            { name: "Fatou", phone: "0100000001" },
            { name: "Mamadou", phone: "0100000002" },
            { name: "Adjoua", phone: "0100000003" },
          ]
        : [],
    };
    if (!seed) return;
    const now = this.clock().getTime();
    const dayStart = startOfUtcDay(now);
    SEED_AMOUNTS.forEach((amount, i) => {
      this.operations.push({
        id: randomUUID(),
        ts: Math.max(dayStart, now - (i + 2) * 25 * 60_000),
        kind: "collect",
        amount,
        status: "paid",
        score: 0,
        decision: "accept",
        factors: [],
        verifiedByVoice: false,
      });
    });
  }

  getSession(id: string): Session {
    let s = this.sessions.get(id);
    if (!s) {
      s = { id };
      this.sessions.set(id, s);
    }
    return s;
  }

  addOperation(data: Omit<Operation, "id" | "ts">): Operation {
    const op: Operation = { id: randomUUID(), ts: this.clock().getTime(), ...data };
    this.operations.push(op);
    return op;
  }

  getOperation(id: string | undefined): Operation | undefined {
    return id ? this.operations.find((o) => o.id === id) : undefined;
  }

  updateOperation(id: string, patch: Partial<Omit<Operation, "id" | "ts">>): Operation {
    const op = this.getOperation(id);
    if (!op) throw new Error(`Opération inconnue : ${id}`);
    Object.assign(op, patch);
    return op;
  }

  addAlert(data: Omit<Alert, "id" | "ts">): Alert {
    const alert: Alert = { id: randomUUID(), ts: this.clock().getTime(), ...data };
    this.alerts.push(alert);
    return alert;
  }

  /** Panier moyen : moyenne des encaissements payés. */
  avgTicket(): number {
    const paid = this.operations.filter((o) => o.kind === "collect" && o.status === "paid");
    if (!paid.length) return DEFAULT_AVG_TICKET;
    return paid.reduce((sum, o) => sum + o.amount, 0) / paid.length;
  }

  /** Opérations évaluées dans les 10 dernières minutes, sans compter celles que le marchand a annulées. */
  previousOps(now: Date): number {
    const since = now.getTime() - BURST_WINDOW_MS;
    return this.operations.filter((o) => o.ts >= since && o.ts <= now.getTime() && o.status !== "cancelled").length;
  }

  /** Encaissements payés du jour calendaire (Abidjan = UTC). */
  paidToday(now: Date): { total: number; count: number } {
    const start = startOfUtcDay(now.getTime());
    const paid = this.operations.filter(
      (o) => o.kind === "collect" && o.status === "paid" && o.ts >= start && o.ts < start + 86_400_000,
    );
    return { total: paid.reduce((sum, o) => sum + o.amount, 0), count: paid.length };
  }

  isKnownContact(who: { name?: string; phone?: string }): boolean {
    const name = who.name ? normalize(who.name) : undefined;
    return this.merchant.contacts.some(
      (c) => (name !== undefined && normalize(c.name) === name) || (who.phone !== undefined && c.phone === who.phone),
    );
  }
}
