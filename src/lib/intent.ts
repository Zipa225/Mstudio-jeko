// Compréhension de la commande du marchand, par règles (pas de modèle de langage).
// Déterministe, testable, hors ligne. Une phrase non comprise donne « unknown » : l'agent redemande, il ne devine pas.
// Ce module ne décide rien et n'exécute rien : il structure une phrase.

import { parseAmount } from "./frenchNumbers";
import { normalize, tokens } from "./text";

export type Wallet = "wave" | "orange" | "mtn" | "moov";
export const WALLET_LABEL: Record<Wallet, string> = { wave: "Wave", orange: "Orange", mtn: "MTN", moov: "Moov" };

export type IntentKind = "collect" | "send" | "summary" | "support" | "unknown";

export interface Intent {
  kind: IntentKind;
  /** Montant en FCFA. */
  amount?: number;
  wallet?: Wallet;
  /** Prénom ou nom du bénéficiaire, accents conservés (transfert seulement). */
  beneficiary?: string;
  /** Numéro local à 10 chiffres, sans indicatif (transfert seulement). */
  phone?: string;
}

// ---------------------------------------------------------------------------
// Moyen de paiement, téléphone
// ---------------------------------------------------------------------------

/** Façons dont la reconnaissance vocale écrit « Wave » (AethexAI a rendu « WAF » lors d'un essai réel). */
const WAVE_MISHEARD = new Set(["waf", "wav", "waive", "ouave", "ouaive", "weave"]);

export function extractWallet(text: string): Wallet | undefined {
  for (const t of tokens(text)) {
    if (t === "wave" || t === "orange" || t === "mtn" || t === "moov") return t;
    if (WAVE_MISHEARD.has(t)) return "wave";
  }
  return undefined;
}

/** Numéro ivoirien à 10 chiffres commençant par 0, avec ou sans +225 / 00225. Renvoie les 10 chiffres. */
export function extractPhone(text: string): string | undefined {
  for (const m of text.matchAll(/\+?\d+(?:[ .\-  ]\d+)*/g)) {
    let digits = m[0].replace(/\D/g, "");
    if (digits.startsWith("00225")) digits = digits.slice(5);
    else if (digits.length === 13 && digits.startsWith("225")) digits = digits.slice(3);
    if (digits.length === 10 && digits.startsWith("0")) return digits;
  }
  return undefined;
}

/** « 0701020304 » devient « 07 01 02 03 04 ». */
export const formatPhone = (phone: string): string => phone.replace(/(\d{2})(?=\d)/g, "$1 ");

// ---------------------------------------------------------------------------
// Bénéficiaire
// ---------------------------------------------------------------------------

const MARKERS = new Set(["a", "pour", "chez", "vers"]);
const FILLERS = new Set(["mon", "ma", "numero", "num", "de", "du"]);
const STOP = new Set([
  "le", "la", "les", "l", "un", "une", "des", "mon", "ma", "mes", "ton", "ta", "numero", "num",
  "par", "wave", "orange", "mtn", "moov", "money", "francs", "franc", "fcfa", "cfa", "xof",
  "moi", "lui", "elle", "eux", "oui", "non", "ok", "merci", "svp", "stp", "euh", "heu", "bah", "ben",
  "alors", "voila", "bonjour", "salut", "a", "au", "aux", "de", "du", "pour", "chez", "vers", "et", "ou", "que", "qui",
]);
const NAME_WORD = /^[\p{L}][\p{L}\p{M}'’-]*$/u;
const CONTRACTION = /^(c|j|l|d|qu|n|s|m|t)['’]/i;

/** « koné » et « KONÉ » deviennent « Koné ». Une casse volontaire (« N'Guessan ») est conservée. */
function prettify(word: string): string {
  const mixed = /\p{Lu}/u.test(word.slice(1)) && /\p{Ll}/u.test(word);
  if (mixed) return word;
  return word.charAt(0).toLocaleUpperCase("fr") + word.slice(1).toLocaleLowerCase("fr");
}

function nameFrom(word: string | undefined): string | undefined {
  if (!word || !NAME_WORD.test(word)) return undefined;
  const n = normalize(word);
  if (n.replace(/ /g, "").length < 2 || STOP.has(n)) return undefined;
  return prettify(word);
}

/**
 * Nom du bénéficiaire : le mot qui suit « à », « pour », « chez » ou « vers », accents conservés.
 * Avec `bare`, accepte aussi un nom seul (réponse à « À qui veux-tu l'envoyer ? »).
 */
export function extractBeneficiary(text: string, options: { bare?: boolean } = {}): string | undefined {
  const words = text.split(/[\s,;:!?.«»"()]+/).filter(Boolean);
  const norm = words.map(normalize);
  for (let i = 0; i < words.length; i++) {
    if (!MARKERS.has(norm[i])) continue;
    let j = i + 1;
    while (j < words.length && FILLERS.has(norm[j])) j++;
    const name = nameFrom(words[j]);
    if (name) return name;
  }
  if (options.bare) {
    for (const w of words) {
      if (CONTRACTION.test(w)) continue;
      const name = nameFrom(w);
      if (name) return name;
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Oui et non (prudents : en cas de doute, ni l'un ni l'autre)
// ---------------------------------------------------------------------------

const YES = [
  "oui", "ouais", "ouaip", "yes", "ok", "okay", "daccord", "d accord", "confirme", "confirmer", "valide", "valider",
  "exact", "exactement", "parfait", "vasy", "vas y", "c est bon", "c est ca", "bien sur", "tout a fait",
];
/** Annulation explicite : elle l'emporte toujours, même accompagnée d'un « ok ». */
const CANCEL = ["annule", "annuler", "annulez", "stop", "arrete", "arreter", "laisse tomber", "tant pis"];
/** Refus : compte comme un non seulement s'il n'y a aucun mot affirmatif (« non, d'accord » est ambigu). */
const NEGATIVE = ["non", "nan", "jamais", "refuse", "pas maintenant", "pas question", "surtout pas"];
/** Mots qui interdisent de lire un oui : « je ne confirme pas », « c'est pas bon ». */
const NEGATION = ["pas", "ne"];

const padded = (text: string) => ` ${normalize(text)} `;
const hasAny = (s: string, list: string[]) => list.some((p) => s.includes(` ${p} `));

export function isYes(text: string): boolean {
  const s = padded(text);
  return hasAny(s, YES) && !hasAny(s, CANCEL) && !hasAny(s, NEGATIVE) && !hasAny(s, NEGATION);
}

export function isNo(text: string): boolean {
  const s = padded(text);
  return hasAny(s, CANCEL) || (hasAny(s, NEGATIVE) && !hasAny(s, YES));
}

// ---------------------------------------------------------------------------
// Intention
// ---------------------------------------------------------------------------

const COLLECT_VERBS = new Set(["encaisse", "encaisser", "encaissez", "encaissement"]);
const SEND_VERBS = new Set([
  "envoie", "envoyer", "envoyez", "envoi", "transfere", "transferer", "transferez", "transfert", "vire", "virer", "verse", "verser",
]);
const QUESTION_WORDS = new Set(["comment", "pourquoi", "quoi", "quel", "quelle", "quels", "quelles", "combien"]);
const SUPPORT_KEYWORDS = [
  "plafond", "limite", "frais", "commission", "tarif", "kyc", "verification", "inscription", "compte", "jekobox", "aide", "probleme",
];
const SUMMARY = [
  /\bbilan\b/,
  /\bcombien\b.*\b(encaisse|gagne|vendu|recu|fait)\b/,
  /\b(mes|les) ventes\b/,
  /\btotal (du jour|d aujourd hui)\b/,
];

function isQuestion(norm: string): boolean {
  return norm.startsWith("est ce que") || norm.split(" ").some((t) => QUESTION_WORDS.has(t));
}

export function parseIntent(text: string): Intent {
  const norm = normalize(text);
  const toks = norm ? norm.split(" ") : [];

  if (SUMMARY.some((re) => re.test(norm))) return { kind: "summary" };

  const amount = parseAmount(text);
  const verb = toks.find((t) => COLLECT_VERBS.has(t) || SEND_VERBS.has(t));
  const question = isQuestion(norm);

  // « comment envoyer de l'argent ? » est une question, pas un ordre : un ordre porte un montant.
  if (verb && !(question && amount === undefined)) {
    const intent: Intent = { kind: COLLECT_VERBS.has(verb) ? "collect" : "send" };
    if (amount !== undefined) intent.amount = amount;
    const wallet = extractWallet(text);
    if (wallet) intent.wallet = wallet;
    if (intent.kind === "send") {
      const beneficiary = extractBeneficiary(text);
      if (beneficiary) intent.beneficiary = beneficiary;
      const phone = extractPhone(text);
      if (phone) intent.phone = phone;
    }
    return intent;
  }

  const keyword = SUPPORT_KEYWORDS.some((k) => toks.includes(k)) || norm.includes("cote d ivoire");
  if (toks.length >= 2 && (question || keyword)) return { kind: "support" };
  return { kind: "unknown" };
}
