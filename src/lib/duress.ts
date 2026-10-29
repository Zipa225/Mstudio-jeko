// Code de contrainte : une phrase secrète que le marchand glisse dans une phrase normale quand on le force.
// Sous contrainte : la réponse est IDENTIQUE à un succès (même fonction, `successTurn`), rien n'est transféré,
// l'opération est retenue et une alerte critique part vers l'analyste.
// Limite à dire franchement : un agresseur qui entend la phrase peut la comprendre. Elle protège contre la
// contrainte, pas contre toutes les fraudes.
// La phrase n'est jamais écrite nulle part : ni dans une alerte, ni dans un journal, ni dans l'état en mémoire.

import { randomUUID } from "node:crypto";
import { getConfig } from "./config";
import { successTurn, type TurnGuard, type TurnResult } from "./dialog";
import { formatPhone, isYes } from "./intent";
import type { Operation, Store } from "./store";
import { containsFuzzyPhrase, formatXof, isTriggerWord, MIN_PHRASE_KEYWORDS, phraseKeywords } from "./text";

/**
 * - disabled : aucune phrase configurée (jamais de phrase par défaut)
 * - weak : moins de deux mots qui comptent, la phrase se déclencherait trop facilement
 * - active : la détection fonctionne
 * - word : le secret est un seul mot (« mot déclencheur ») : il suffit de le dire dans n'importe quelle phrase. Ça marche,
 *   mais le mot peut aussi être dit par hasard : l'écran de l'analyste le signale.
 */
export type DuressStatus = "disabled" | "weak" | "active" | "word";

export function duressStatus(phrase: string | undefined): DuressStatus {
  if (!phrase) return "disabled";
  if (isTriggerWord(phrase)) return "word";
  return phraseKeywords(phrase).length >= MIN_PHRASE_KEYWORDS ? "active" : "weak";
}

const heard = (text: string, phrase: string | undefined): phrase is string => {
  const status = duressStatus(phrase);
  return (status === "active" || status === "word") && containsFuzzyPhrase(text, phrase as string);
};

/**
 * Ce que l'écran du marchand peut afficher de sa propre phrase. S'il a dit la phrase de contrainte, on ne l'affiche
 * jamais : « Oui » s'il confirmait, sinon « … ». Un agresseur qui regarde l'écran ne voit rien de suspect.
 */
export function publicTranscript(text: string, phrase: string | undefined): string {
  if (!heard(text, phrase)) return text;
  return isYes(text) ? "Oui" : "…";
}

const label = (op: Operation) => op.beneficiary ?? (op.phone ? formatPhone(op.phone) : "un numéro inconnu");

export function createDuressGuard(
  store: Store,
  getPhrase: () => string | undefined = () => getConfig().duressPhrase,
  /** Lien factice de même forme qu'un vrai lien de paiement (caisse réelle), pour que la réponse reste identique. */
  decoyPayUrl?: (id: string) => string | undefined,
): TurnGuard {
  return (text: string, op: Operation | undefined): TurnResult | undefined => {
    if (!heard(text, getPhrase())) return undefined;

    // Phrase dite sans opération à confirmer : on alerte discrètement, on ne laisse rien se dérouler.
    if (!op) {
      store.addAlert({
        level: "critical",
        type: "duress",
        title: "Code de contrainte reçu",
        detail: "Le marchand a prononcé sa phrase de contrainte, sans opération à confirmer. Aucune somme n'a été transférée. Rappel discret recommandé.",
      });
      const reply = "D'accord. Je suis là si tu as besoin.";
      return { reply, speech: reply, awaitingConfirm: false };
    }

    // Phrase dite pendant la confirmation : l'opération est retenue, l'écran affiche un succès.
    store.updateOperation(op.id, { status: "held" });
    const what = op.kind === "send" ? "Transfert" : "Encaissement";
    const to = op.kind === "send" ? ` vers ${label(op)}` : "";
    const outcome = op.kind === "send" ? "Aucune somme n'a été transférée." : "Aucun encaissement n'a été lancé.";
    store.addAlert({
      level: "critical",
      type: "duress",
      title: "Contrainte signalée",
      detail: `${what} de ${formatXof(op.amount)} FCFA${to} demandé sous contrainte probable. L'écran du marchand affiche un succès. ${outcome}`,
      operationId: op.id,
      score: op.score,
      factors: op.factors,
    });
    // Un encaissement normal renvoie un identifiant de paiement : on en fournit un fictif pour que la réponse soit identique.
    if (op.kind !== "collect") return successTurn(op);
    const fakeId = `pr_${randomUUID().slice(0, 8)}`;
    return successTurn(op, fakeId, decoyPayUrl?.(fakeId));
  };
}
