// Compréhension de la commande du marchand, par règles (pas de modèle de langage).
// Déterministe, testable, hors ligne. Une phrase non comprise donne « unknown » : l'agent redemande, il ne devine pas.
// Ce module ne décide rien et n'exécute rien : il structure une phrase.

import { parseAmount } from "./frenchNumbers";
import { normalize, tokens } from "./text";

export type Wallet = "wave" | "orange" | "mtn" | "moov";
export const WALLET_LABEL: Record<Wallet, string> = { wave: "Wave", orange: "Orange", mtn: "MTN", moov: "Moov" };

/** `amount` : un montant d'argent sans verbe compris (« on voit 5000 francs par 8 ») : l'agent demande s'il faut encaisser ou envoyer. */
export type IntentKind = "collect" | "send" | "summary" | "support" | "amount" | "unknown";

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
const WAVE_MISHEARD = new Set(["waf", "wif", "wav", "waive", "ouave", "ouaive", "weave"]);

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
/**
 * Titres et appellations qui précèdent le nom : « à monsieur Diallo » doit rendre « Diallo », pas « Monsieur ».
 * Faute de nom derrière, le titre sert lui-même de nom (« à tonton » rend « Tonton ») : sinon l'agent redemanderait
 * « à qui ? » et la seule réponse possible serait le même mot.
 */
const TITRES = new Set(["monsieur", "madame", "mademoiselle", "tonton", "tanti", "tantie", "papa", "maman", "frere", "soeur"]);
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
    let titre: string | undefined;
    while (j < words.length && (FILLERS.has(norm[j]) || TITRES.has(norm[j]))) {
      if (TITRES.has(norm[j])) titre ??= words[j];
      j++;
    }
    const name = nameFrom(words[j]) ?? nameFrom(titre);
    if (name) return name;
  }
  if (options.bare) {
    let titre: string | undefined;
    for (const w of words) {
      if (CONTRACTION.test(w)) continue;
      if (TITRES.has(normalize(w))) {
        titre ??= w;
        continue;
      }
      const name = nameFrom(w);
      if (name) return name;
    }
    const name = nameFrom(titre);
    if (name) return name;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Oui et non (prudents : en cas de doute, ni l'un ni l'autre)
// ---------------------------------------------------------------------------

const YES = [
  "oui", "ouais", "ouai", "ouep", "wi", "ui", "ouaip", "yes", "ok", "okay", "daccord", "d accord", "confirme", "confirmer", "valide", "valider",
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
/**
 * Encaissements bâtis sur « payer » ou « devoir » : c'est le client qui paie le marchand. Une vendeuse dit « fais
 * payer » bien plus souvent que « encaisse ».
 * Des expressions entières, jamais le seul mot « payer », parce que « je dois payer » et « paye Koffi » sont des
 * envois : seul l'entourage dit qui paie qui. Pour la même raison, « fait payer » (passé) et « vais payer »
 * (le marchand) n'y sont pas.
 */
const COLLECT_PHRASES = [
  "fais payer", "fais moi payer", "fais lui payer", "faire payer", "faites payer",
  "demande de paiement", "demande le paiement", "demande un paiement", "demander le paiement",
  "doit payer", "doivent payer", "va payer", "vont payer",
  "me doit", "me doivent", "nous doit", "nous doivent",
];
const SEND_VERBS = new Set([
  "envoie", "envoyer", "envoyez", "envoi", "transfere", "transferer", "transferez", "transfert", "vire", "virer", "verse", "verser",
]);
const QUESTION_WORDS = new Set(["comment", "pourquoi", "quoi", "quel", "quelle", "quels", "quelles", "combien"]);
const SUPPORT_KEYWORDS = [
  "plafond", "limite", "frais", "commission", "tarif", "kyc", "verification", "inscription", "compte", "jekobox", "aide", "probleme",
  "pays", "horaires", "contact", "conseiller", "virement", "reversement", "abonnement", "support",
];
const SUMMARY = [
  /\bbilan\b/,
  /\bcombien\b.*\b(encaisse|gagne|vendu|recu|fait)\b/,
  /\b(mes|les) ventes\b/,
  /\btotal (du jour|d aujourd hui)\b/,
];

// ---------------------------------------------------------------------------
// Réparer les erreurs de prononciation courantes de la reconnaissance vocale
// ---------------------------------------------------------------------------

const MONEY_WORDS = new Set(["franc", "francs", "fcfa", "cfa", "xof", "f"]);
const hasMoneyWord = (norm: string) => norm.split(" ").some((w) => MONEY_WORDS.has(w));

/** « envoie » entendu « on voit », « en voie », « en voyé »... */
const SEND_MISHEARD = /\b(?:on|en|an) (?:voit|voie|voix|voi|voyer|voye|voyez)\b/g;
/** « encaisse » entendu « on casse », « en caisse », « en cesse »... */
const COLLECT_MISHEARD = /\b(?:on|en|an) (?:caisse|caisses|casse|casses|cesse|kess|quaisse|caisser|cesser|casser)\b/g;
/** « Wave » entendu « 8 », « huit », « vague », « ouève »... après « par », « sur » ou « avec ». */
const WALLET_MISHEARD = /\b(par|sur|avec) (?:8|huit|weve|wev|oueve|ouev|vague|vagues|waif|ouaf)\b/g;

/**
 * Le texte normalisé, avec les erreurs de prononciation connues corrigées. Ces corrections ne s'appliquent QUE quand la
 * phrase parle d'argent (un montant et « francs », ou `assumeMoney`) : « on voit que » dans une conversation ordinaire
 * ne devient jamais « envoie ». Le texte d'origine reste la référence pour les noms.
 */
export function repairSpeech(text: string, assumeMoney = false): string {
  const norm = normalize(text);
  if (!assumeMoney && !(parseAmount(text) !== undefined && hasMoneyWord(norm))) return norm;
  return norm.replace(SEND_MISHEARD, "envoie").replace(COLLECT_MISHEARD, "encaisse").replace(WALLET_MISHEARD, "$1 wave");
}

/** Encaisser ou envoyer ? Réponse à la question de l'agent, tolérante aux mêmes erreurs. `undefined` si on ne sait pas. */
export function kindFrom(text: string): "collect" | "send" | undefined {
  const toks = repairSpeech(text, true).split(" ");
  if (toks.some((t) => COLLECT_VERBS.has(t) || ["recevoir", "recois", "recoit"].includes(t))) return "collect";
  if (toks.some((t) => SEND_VERBS.has(t))) return "send";
  return undefined;
}

function isQuestion(norm: string): boolean {
  return norm.startsWith("est ce que") || norm.split(" ").some((t) => QUESTION_WORDS.has(t));
}

export function parseIntent(rawText: string): Intent {
  const norm = repairSpeech(rawText);
  const toks = norm ? norm.split(" ") : [];
  // Les noms gardent leurs accents : ils se lisent dans le texte d'origine, pas dans le texte réparé.
  const text = rawText;

  if (SUMMARY.some((re) => re.test(norm))) return { kind: "summary" };

  const amount = parseAmount(norm);
  const verb = toks.find((t) => COLLECT_VERBS.has(t) || SEND_VERBS.has(t));
  // Cherché seulement faute de verbe : quand les deux sont là, le verbe est le signal le plus clair et il décide.
  // Sur `norm` et non sur le texte brut : la recherche doit voir le même texte que celle du verbe, donc réparé.
  const collectPhrase = verb === undefined && hasAny(` ${norm} `, COLLECT_PHRASES);
  const question = isQuestion(norm);

  // « comment envoyer de l'argent ? » est une question, pas un ordre : un ordre porte un montant.
  if ((verb !== undefined || collectPhrase) && !(question && amount === undefined)) {
    const intent: Intent = { kind: verb === undefined || COLLECT_VERBS.has(verb) ? "collect" : "send" };
    if (amount !== undefined) intent.amount = amount;
    const wallet = extractWallet(norm);
    if (wallet) intent.wallet = wallet;
    if (intent.kind === "send") {
      const beneficiary = extractBeneficiary(text);
      if (beneficiary) intent.beneficiary = beneficiary;
      const phone = extractPhone(text);
      if (phone) intent.phone = phone;
    }
    return intent;
  }

  // Un montant d'argent sans verbe compris : on ne devine pas, l'agent demande s'il faut encaisser ou envoyer.
  if (amount !== undefined && !question) {
    const wallet = extractWallet(norm);
    if (hasMoneyWord(norm) || wallet) return { kind: "amount", amount, ...(wallet ? { wallet } : {}) };
  }

  const keyword = SUPPORT_KEYWORDS.some((k) => toks.includes(k)) || norm.includes("cote d ivoire");
  if (toks.length >= 2 && (question || keyword)) return { kind: "support" };
  return { kind: "unknown" };
}
