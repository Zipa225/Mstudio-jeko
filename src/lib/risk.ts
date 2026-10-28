// Score de risque « Argus simplifié ».
// Six critères transparents, des points explicables, trois décisions. Ce n'est PAS le moteur Argus complet
// (11 critères confidentiels) : les poids sont illustratifs et ne sont pas calibrés sur des données réelles.
// Fonction pure : pas d'horloge, pas d'état, pas de phrases parlées (celles-ci relèvent du dialogue).

import { getConfig } from "./config";
import { formatXof } from "./text";

export type Decision = "accept" | "verify" | "block";
export type FactorId = "outbound" | "amount_ratio" | "ceiling" | "new_beneficiary" | "night" | "velocity";

export interface RiskInput {
  kind: "collect" | "send";
  /** Montant en FCFA. */
  amount: number;
  /** Bénéficiaire déjà connu du marchand (ignoré pour un encaissement). */
  beneficiaryKnown: boolean;
  /** Panier moyen du marchand, en FCFA. */
  avgTicket: number;
  /** Opérations déjà faites dans les 10 dernières minutes, sans compter celle qu'on évalue. */
  previousOps: number;
  /** Heure de l'opération (toujours fournie : le score ne lit jamais l'horloge). */
  now: Date;
}

export interface RiskSettings {
  ceilingXof: number;
  thresholds: { verify: number; block: number };
}

export interface Factor {
  /** Les six critères locaux (`FactorId`), ou le nom d'une caractéristique renvoyée par Argus. */
  id: string;
  label: string;
  points: number;
  detail: string;
}

export interface RiskResult {
  /** 0 à 100. */
  score: number;
  decision: Decision;
  /** Chaque point du score avec son explication, dans un ordre fixe. */
  factors: Factor[];
}

const fmtRatio = (r: number) => new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 }).format(r);

export function scoreRisk(input: RiskInput, settings: RiskSettings = getConfig()): RiskResult {
  const { kind, amount, beneficiaryKnown, now } = input;
  if (!Number.isFinite(amount) || amount <= 0) throw new RangeError(`Montant invalide : ${amount}`);

  const avg = Math.max(input.avgTicket, 1);
  const factors: Factor[] = [];
  const add = (f: Factor) => factors.push(f);

  // 1. Sortie d'argent
  if (kind === "send") {
    add({ id: "outbound", label: "Sortie d'argent", points: 10, detail: "Un transfert sortant est plus risqué qu'un encaissement" });
  }

  // 2. Montant par rapport au panier moyen (seuils inclusifs : 2, 4 et 10 fois)
  const ratioDetail = `${fmtRatio(amount / avg)} fois le panier moyen (${formatXof(Math.round(avg))} FCFA)`;
  if (amount >= avg * 10) add({ id: "amount_ratio", label: "Montant très supérieur à l'habitude", points: 30, detail: ratioDetail });
  else if (amount >= avg * 4) add({ id: "amount_ratio", label: "Montant supérieur à l'habitude", points: 20, detail: ratioDetail });
  else if (amount >= avg * 2) add({ id: "amount_ratio", label: "Montant un peu supérieur à l'habitude", points: 10, detail: ratioDetail });

  // 3. Plafond, appliqué par transaction. À confirmer avec Jèko : par transaction ou cumulé ?
  if (amount > settings.ceilingXof) {
    add({ id: "ceiling", label: "Dépasse le plafond", points: 25, detail: `Plafond de ${formatXof(settings.ceilingXof)} FCFA` });
  }

  // 4. Bénéficiaire inconnu (transfert seulement)
  if (kind === "send" && !beneficiaryKnown) {
    add({ id: "new_beneficiary", label: "Bénéficiaire inconnu", points: 20, detail: "Premier transfert vers ce bénéficiaire" });
  }

  // 5. Heure de nuit, de 22 h à 4 h 59. Abidjan est à UTC+0 toute l'année : pas d'heure d'été.
  const hour = now.getUTCHours();
  if (hour >= 22 || hour < 5) {
    add({ id: "night", label: "Heure inhabituelle", points: 15, detail: `Opération à ${hour} h` });
  }

  // 6. Rafale : l'opération en cours compte parmi les opérations des 10 dernières minutes.
  const ops = Math.max(0, input.previousOps) + 1;
  if (ops >= 5) add({ id: "velocity", label: "Rafale d'opérations", points: 25, detail: `${ops} opérations en 10 minutes, celle-ci comprise` });
  else if (ops >= 3) add({ id: "velocity", label: "Opérations rapprochées", points: 15, detail: `${ops} opérations en 10 minutes, celle-ci comprise` });

  const score = Math.min(100, factors.reduce((sum, f) => sum + f.points, 0));
  const decision: Decision =
    score >= settings.thresholds.block ? "block" : score >= settings.thresholds.verify ? "verify" : "accept";
  return { score, decision, factors };
}
