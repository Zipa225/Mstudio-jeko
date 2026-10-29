// Aides pures de la page /micro : comparer ce que le moteur de reconnaissance a compris à la phrase attendue, et choisir le
// meilleur réglage de micro. Sans React ni réseau, donc testées.

import type { MicProfile, SttEngine } from "../marchand/audio";
import { levenshtein, tokens } from "../../lib/text";

/** La phrase que la personne dit pendant le test : montant, moyen de paiement, verbe : ce que la démo utilise le plus. */
export const EXPECTED_PHRASE = "Encaisse cinq mille francs par Wave";

/** Chaque mot attendu, avec les façons dont le moteur l'écrit parfois (« WAF » pour Wave, relevé lors d'un essai réel). */
const EXPECTED_WORDS: string[][] = [
  ["encaisse", "encaisser", "encaissez"],
  ["cinq"],
  ["mille"],
  ["francs", "franc", "f", "fcfa", "cfa"],
  ["par"],
  ["wave", "waf", "wif", "wav", "ouave"],
];

const close = (heard: string, wanted: string) => heard === wanted || (wanted.length >= 5 && levenshtein(heard, wanted) <= 1);

/**
 * Part des mots attendus retrouvés dans la transcription, de 0 à 1. Le moteur écrit souvent les nombres en chiffres :
 * « 5000 » ou « 5 000 » tient lieu de « cinq » et de « mille ».
 */
export function phraseScore(heard: string): number {
  const words = tokens(heard);
  if (!words.length) return 0;
  const digits = /(^|\D)5000(\D|$)/.test(heard.replace(/(\d)[\s  ]+(?=\d)/g, "$1"));
  const hits = EXPECTED_WORDS.filter((alternatives, i) => {
    if (digits && (i === 1 || i === 2)) return true;
    return alternatives.some((alt) => words.some((w) => close(w, alt)));
  }).length;
  return hits / EXPECTED_WORDS.length;
}

export interface Take {
  profile: MicProfile;
  heard: string;
  /** Le son était saturé (déformé) : à score égal, un essai propre passe devant. */
  saturated?: boolean;
}

/**
 * Le profil dont la transcription est la plus proche de la phrase attendue. À score égal : un essai non saturé passe
 * devant un essai saturé, puis le premier essayé. `undefined` si aucun n'a rien compris.
 */
export function bestProfile(takes: readonly Take[]): MicProfile | undefined {
  let best: { profile: MicProfile; score: number; saturated: boolean } | undefined;
  for (const take of takes) {
    const score = phraseScore(take.heard);
    const saturated = take.saturated === true;
    if (score <= 0) continue;
    if (!best || score > best.score || (score === best.score && best.saturated && !saturated)) best = { profile: take.profile, score, saturated };
  }
  return best?.profile;
}

/**
 * Qui doit écouter : AethexAI, sauf si la reconnaissance du navigateur a fait STRICTEMENT mieux que son meilleur essai
 * (à égalité, on garde AethexAI : c'est lui que le projet met en avant). Sans essai du navigateur : AethexAI.
 */
export function chooseEngine(takes: readonly Take[], browserHeard: string | undefined): SttEngine {
  if (browserHeard === undefined) return "aethex";
  const best = Math.max(0, ...takes.map((t) => phraseScore(t.heard)));
  return phraseScore(browserHeard) > best ? "navigateur" : "aethex";
}

/** « 4 mots sur 6 » : de quoi lire un score sans calcul. */
export const scoreLabel = (score: number): string => `${Math.round(score * EXPECTED_WORDS.length)} mots sur ${EXPECTED_WORDS.length}`;
