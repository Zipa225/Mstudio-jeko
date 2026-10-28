// Montants en FCFA : du français parlé vers un nombre (parseAmount) et d'un nombre vers des mots (toFrenchWords).
// Plage supportée : 1 à 999 999 999. Le FCFA n'a pas de décimales.
// Règle de prudence : si la phrase est ambiguë ou incohérente, on renvoie undefined plutôt qu'un montant faux.

import { tokens } from "./text";

export const MAX_AMOUNT = 999_999_999;

// ---------------------------------------------------------------------------
// Nombre vers mots (pour la voix)
// ---------------------------------------------------------------------------

const UNITS = [
  "zéro", "un", "deux", "trois", "quatre", "cinq", "six", "sept", "huit", "neuf",
  "dix", "onze", "douze", "treize", "quatorze", "quinze", "seize",
];
const TENS: Record<number, string> = { 20: "vingt", 30: "trente", 40: "quarante", 50: "cinquante", 60: "soixante" };

/** 0 à 99. `plural` : « quatre-vingts » prend un s seulement quand rien ne le suit. */
function below100(n: number, plural: boolean): string {
  if (n < 17) return UNITS[n];
  if (n < 20) return `dix-${UNITS[n - 10]}`;
  if (n < 70) {
    const tens = Math.floor(n / 10) * 10;
    const unit = n % 10;
    if (unit === 0) return TENS[tens];
    if (unit === 1) return `${TENS[tens]} et un`;
    return `${TENS[tens]}-${UNITS[unit]}`;
  }
  if (n < 80) {
    if (n === 71) return "soixante et onze";
    return `soixante-${below100(n - 60, plural)}`;
  }
  if (n === 80) return plural ? "quatre-vingts" : "quatre-vingt";
  return `quatre-vingt-${below100(n - 80, plural)}`;
}

/** 1 à 999. `plural` : « cents » prend un s seulement en fin de nombre ou devant « million ». */
function below1000(n: number, plural: boolean): string {
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  if (hundreds === 0) return below100(rest, plural);
  const head = hundreds === 1 ? "cent" : `${UNITS[hundreds]} cent${rest === 0 && plural ? "s" : ""}`;
  return rest === 0 ? head : `${head} ${below100(rest, plural)}`;
}

export function toFrenchWords(n: number): string {
  if (!Number.isInteger(n) || n < 0 || n > MAX_AMOUNT) throw new RangeError(`Montant hors limites : ${n}`);
  if (n === 0) return "zéro";
  const millions = Math.floor(n / 1_000_000);
  const thousands = Math.floor((n % 1_000_000) / 1000);
  const rest = n % 1000;
  const parts: string[] = [];
  if (millions) parts.push(`${below1000(millions, true)} million${millions > 1 ? "s" : ""}`);
  if (thousands) parts.push(thousands === 1 ? "mille" : `${below1000(thousands, false)} mille`);
  if (rest) parts.push(below1000(rest, true));
  return parts.join(" ");
}

// ---------------------------------------------------------------------------
// Mots vers nombre (pour la compréhension de la commande)
// ---------------------------------------------------------------------------

const WORD_VALUES: Record<string, number> = {
  zero: 0, un: 1, deux: 2, trois: 3, quatre: 4, cinq: 5, six: 6, sept: 7, huit: 8, neuf: 9,
  dix: 10, onze: 11, douze: 12, treize: 13, quatorze: 14, quinze: 15, seize: 16,
  vingt: 20, trente: 30, quarante: 40, cinquante: 50, soixante: 60,
};
/** « quatre-vingt » : jeton interne, créé en fusionnant « quatre » et « vingt ». */
const QV = "quatre-vingt";
const CURRENCY = new Set(["franc", "francs", "fcfa", "cfa", "xof", "f"]);

const isNumberWord = (t: string | undefined): boolean =>
  // « milliard » est reconnu mais non géré (hors plage) : la suite entière est rejetée au lieu de lire « deux ».
  t !== undefined && (t in WORD_VALUES || t === QV || t === "cent" || t === "mille" || t === "million" || t === "milliard");

/** Jetons normalisés : pluriels ramenés au singulier, « quatre vingt » fusionnés. */
function numberTokens(text: string): string[] {
  const raw = tokens(text).map((t) => (t === "cents" ? "cent" : t === "vingts" ? "vingt" : t === "millions" ? "million" : t === "milliards" ? "milliard" : t));
  const out: string[] = [];
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] === "quatre" && raw[i + 1] === "vingt") {
      out.push(QV);
      i++;
    } else {
      out.push(raw[i]);
    }
  }
  return out;
}

interface Parsed {
  value: number;
  next: number;
}

/** Analyse une suite de mots-nombres. Renvoie undefined si la suite n'est pas un nombre français correct. */
function parseRun(tok: string[]): number | undefined {
  const val = (i: number): number | undefined => (tok[i] === QV ? 80 : tok[i] in WORD_VALUES ? WORD_VALUES[tok[i]] : undefined);

  // 1 à 19 : « sept », « onze », « dix-sept » (dix suivi de sept, huit ou neuf).
  const parseSub20 = (i: number): Parsed | null => {
    const v = val(i);
    if (v === undefined || v < 1 || v >= 20) return null;
    if (v === 10 && ["sept", "huit", "neuf"].includes(tok[i + 1])) return { value: 10 + (val(i + 1) as number), next: i + 2 };
    return { value: v, next: i + 1 };
  };

  // 1 à 99
  const parseBelow100 = (i: number): Parsed | null => {
    if (tok[i] === QV) {
      const r = parseSub20(i + 1);
      return r ? { value: 80 + r.value, next: r.next } : { value: 80, next: i + 1 };
    }
    const v = val(i);
    if (v !== undefined && v >= 20 && v <= 60) {
      if (tok[i + 1] === "et" && tok[i + 2] === "un") return { value: v + 1, next: i + 3 };
      if (v === 60) {
        if (tok[i + 1] === "et" && tok[i + 2] === "onze") return { value: 71, next: i + 3 };
        const teen = parseSub20(i + 1);
        if (teen && teen.value >= 10) return { value: 60 + teen.value, next: teen.next };
      }
      const unit = parseSub20(i + 1);
      if (unit && unit.value <= 9) return { value: v + unit.value, next: unit.next };
      return { value: v, next: i + 1 };
    }
    return parseSub20(i);
  };

  // 1 à 999
  const parseGroup = (i: number): Parsed | null => {
    const v = val(i);
    let hundreds = 0;
    let j = i;
    if (tok[i] === "cent") {
      hundreds = 1;
      j = i + 1;
    } else if (v !== undefined && v >= 2 && v <= 9 && tok[i + 1] === "cent") {
      hundreds = v;
      j = i + 2;
    }
    if (hundreds) {
      const rest = parseBelow100(j);
      return rest ? { value: hundreds * 100 + rest.value, next: rest.next } : { value: hundreds * 100, next: j };
    }
    return parseBelow100(i);
  };

  let j = 0;
  let total = 0;
  const millions = parseGroup(j);
  if (millions && tok[millions.next] === "million") {
    total += millions.value * 1_000_000;
    j = millions.next + 1;
  }
  if (tok[j] === "mille") {
    total += 1000;
    j++;
  } else {
    const thousands = parseGroup(j);
    if (thousands && thousands.value >= 2 && tok[thousands.next] === "mille") {
      total += thousands.value * 1000;
      j = thousands.next + 1;
    }
  }
  const rest = parseGroup(j);
  if (rest) {
    total += rest.value;
    j = rest.next;
  }
  if (j !== tok.length || total < 1 || total > MAX_AMOUNT) return undefined;
  return total;
}

interface Candidate {
  value: number;
  /** Suivi d'un mot de monnaie (« francs », « FCFA »...) : un indice fort que c'est bien le montant. */
  currency: boolean;
}

function wordCandidates(text: string): Candidate[] {
  const tok = numberTokens(text);
  const out: Candidate[] = [];
  let i = 0;
  while (i < tok.length) {
    if (!isNumberWord(tok[i])) {
      i++;
      continue;
    }
    let j = i;
    while (j < tok.length) {
      if (isNumberWord(tok[j])) j++;
      else if (
        tok[j] === "et" && j > i && isNumberWord(tok[j + 1]) &&
        (WORD_VALUES[tok[j - 1]] ?? 0) >= 20 && (tok[j + 1] === "un" || tok[j + 1] === "onze")
      ) j++;
      else break;
    }
    const run = tok.slice(i, j);
    const currency = CURRENCY.has(tok[j]);
    const value = parseRun(run);
    // « un » seul est presque toujours l'article (« un transfert »), sauf devant « franc ».
    if (value !== undefined && !(run.length === 1 && run[0] === "un" && !currency)) out.push({ value, currency });
    i = j;
  }
  return out;
}

const DIGIT_RUN = /(\+?)(\d+(?:[ .  ]\d+)*)/g;
const THOUSANDS_GROUPED = /^\d{1,3}(?:[ .  ]\d{3})+$/;
const PLAIN = /^[1-9]\d{0,8}$/;

function digitCandidates(text: string): Candidate[] {
  const out: Candidate[] = [];
  for (const m of text.matchAll(DIGIT_RUN)) {
    const [whole, plus, run] = m;
    if (plus) continue; // « +225... » : un numéro de téléphone
    const end = (m.index ?? 0) + whole.length;
    const start = m.index ?? 0;
    // Décimale (« 5,5 ») : pas gérée, on préfère ne rien comprendre plutôt que lire 5.
    if (/^,\d/.test(text.slice(end)) || /\d,$/.test(text.slice(Math.max(0, start - 2), start))) continue;
    let value: number;
    if (THOUSANDS_GROUPED.test(run)) value = Number(run.replace(/\D/g, ""));
    else if (PLAIN.test(run)) value = Number(run);
    else continue; // commence par 0, groupes de 2 chiffres, trop long : numéro de téléphone
    let after = text.slice(end);
    const mult = /^\s*(mille|millions?)(?![a-zà-ÿ])/i.exec(after);
    if (mult) {
      value *= mult[1].toLowerCase() === "mille" ? 1000 : 1_000_000;
      after = after.slice(mult[0].length);
    }
    if (value < 1 || value > MAX_AMOUNT) continue;
    out.push({ value, currency: /^\s*(f|fcfa|cfa|francs?|xof)(?![a-zà-ÿ0-9])/i.test(after) });
  }
  return out;
}

/**
 * Premier montant compris dans une phrase, ou undefined. Un montant suivi de « francs », « FCFA »... est préféré.
 * Limite connue : sans mot de monnaie, le premier nombre de la phrase l'emporte (« deux enfants, envoie cinq mille »).
 */
export function parseAmount(text: string): number | undefined {
  const candidates = [...digitCandidates(text), ...wordCandidates(text)];
  return (candidates.find((c) => c.currency) ?? candidates[0])?.value;
}
