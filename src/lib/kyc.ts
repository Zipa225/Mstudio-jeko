// Vérification d'identité (KYC) STATIQUE, pour débloquer une opération qu'Argus a retenue (BLOCK ou QUARANTINE).
// Ce n'est pas un vrai KYC : faute de temps, la commerçante prouve son identité avec deux informations fixes, celles du
// personnage de démonstration (Awa). Un vrai KYC passerait par le dossier de vérification de Jèko.
// Rien ici ne décide d'envoyer de l'argent : un déblocage remet l'opération à l'état « à confirmer », et la commerçante
// doit encore entendre la relecture et dire « oui ».

import type { Operation, Store } from "./store";
import { formatXof } from "./text";

/** Au-delà de ce nombre de réponses fausses, l'opération reste bloquée et un conseiller doit s'en charger. */
export const KYC_MAX_ATTEMPTS = 3;

export interface Kyc {
  /** Date de naissance, au format AAAA-MM-JJ. */
  birthDate: string;
  /** Quatre derniers chiffres de la pièce d'identité. */
  idLast4: string;
}

/** Les informations d'Awa, le personnage de démonstration. Ce ne sont les données de personne. */
export const DEMO_KYC: Kyc = { birthDate: "2025-10-08", idLast4: "0810" };

export interface KycProof {
  birthDate?: unknown;
  idLast4?: unknown;
}

/** « 14/03/1988 », « 14-03-1988 », « 14.03.1988 », « 14 03 1988 » ou « 1988-03-14 » donnent « 1988-03-14 ». Une date impossible ne donne rien. */
export function parseBirthDate(input: unknown): string | undefined {
  if (typeof input !== "string") return undefined;
  const text = input.trim();
  let year: number, month: number, day: number;
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text);
  const fr = /^(\d{1,2})[\s/.-]+(\d{1,2})[\s/.-]+(\d{4})$/.exec(text);
  if (iso) [year, month, day] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  else if (fr) [day, month, year] = [Number(fr[1]), Number(fr[2]), Number(fr[3])];
  else return undefined;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return undefined;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Les quatre chiffres, avec ou sans espaces. Autre chose que quatre chiffres ne donne rien. */
export function parseIdLast4(input: unknown): string | undefined {
  if (typeof input !== "string") return undefined;
  const digits = input.replace(/\s/g, "");
  return /^\d{4}$/.test(digits) ? digits : undefined;
}

/** Les deux informations doivent être justes. */
export function checkKyc(proof: KycProof, expected: Kyc): boolean {
  return parseBirthDate(proof.birthDate) === expected.birthDate && parseIdLast4(proof.idLast4) === expected.idLast4;
}

export type UnblockCheck =
  | { ok: true; operation: Operation }
  | { ok: false; reason: "not_blocked" | "locked" | "wrong"; attemptsLeft: number };

const what = (op: Operation) => (op.kind === "send" ? "Transfert" : "Encaissement");

/**
 * Tente de débloquer une opération retenue par Argus. Chaque réponse fausse compte ; à la troisième l'opération reste
 * bloquée pour de bon et l'analyste est prévenu. Cette fonction ne change pas le statut : c'est le dialogue qui remet
 * l'opération à confirmer (`resumeBlocked`), pour que la relecture et le « oui » passent par le même chemin que tout le reste.
 */
export function checkUnblock(store: Store, operationId: string, proof: KycProof): UnblockCheck {
  const op = store.getOperation(operationId);
  if (!op || op.status !== "blocked") return { ok: false, reason: "not_blocked", attemptsLeft: 0 };
  const used = op.kycAttempts ?? 0;
  if (used >= KYC_MAX_ATTEMPTS) return { ok: false, reason: "locked", attemptsLeft: 0 };

  if (checkKyc(proof, store.merchant.kyc)) return { ok: true, operation: op };

  store.updateOperation(op.id, { kycAttempts: used + 1 });
  const attemptsLeft = KYC_MAX_ATTEMPTS - (used + 1);
  if (attemptsLeft === 0) {
    store.addAlert({
      level: "warning",
      type: "blocked",
      title: "Déblocage refusé : trop d'essais",
      detail: `${what(op)} de ${formatXof(op.amount)} FCFA : ${KYC_MAX_ATTEMPTS} vérifications d'identité fausses. L'opération reste bloquée, un conseiller doit contacter le marchand.`,
      operationId: op.id,
      score: op.score,
      factors: op.factors,
    });
  }
  return { ok: false, reason: attemptsLeft === 0 ? "locked" : "wrong", attemptsLeft };
}
