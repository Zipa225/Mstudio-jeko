// Outils de texte : normalisation, découpage en mots, affichage des montants.

/** Minuscules, sans accents ni ponctuation : « Koné » devient « kone », « j'ai » devient « j ai ». */
export function normalize(input: string): string {
  return input
    .toLowerCase()
    .replace(/œ/g, "oe")
    .replace(/æ/g, "ae")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function tokens(input: string): string[] {
  const n = normalize(input);
  return n ? n.split(" ") : [];
}

/** Nombre de modifications (ajout, retrait, remplacement d'une lettre) pour passer de `a` à `b`. */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    prev = cur;
  }
  return prev[b.length];
}

/** Les mots qui comptent dans une phrase secrète : 4 lettres et plus. */
export const phraseKeywords = (phrase: string): string[] => tokens(phrase).filter((t) => t.length >= 4);

/** Une phrase avec moins de deux mots qui comptent se déclencherait trop facilement : elle est refusée. */
export const MIN_PHRASE_KEYWORDS = 2;

/** Un secret d'UN seul mot est accepté comme « mot déclencheur » s'il a au moins cinq lettres (le même seuil que la tolérance aux erreurs de transcription). */
export const MIN_TRIGGER_WORD_LETTERS = 5;

/** Vrai si le secret est un mot déclencheur : un seul mot, d'au moins cinq lettres. */
export function isTriggerWord(secret: string): boolean {
  const t = tokens(secret);
  return t.length === 1 && t[0].length >= MIN_TRIGGER_WORD_LETTERS;
}

/**
 * Vrai si les mots qui comptent de `phrase` se retrouvent dans `utterance`. La reconnaissance vocale n'est jamais
 * parfaite : un mot de 5 lettres ou plus peut différer d'une lettre. Il faut au moins `minRatio` des mots (80 % par défaut).
 */
export function containsFuzzyPhrase(utterance: string, phrase: string, minRatio = 0.8): boolean {
  const words = tokens(utterance);
  // Mot déclencheur : il suffit que ce mot (à une lettre près) soit dans la phrase, quoi qu'elle dise d'autre.
  if (isTriggerWord(phrase)) {
    const word = tokens(phrase)[0];
    return words.some((w) => w === word || levenshtein(w, word) <= 1);
  }
  const keys = phraseKeywords(phrase);
  if (keys.length < MIN_PHRASE_KEYWORDS || !words.length) return false;
  const hits = keys.filter((k) => words.some((w) => w === k || (k.length >= 5 && levenshtein(w, k) <= 1))).length;
  return hits / keys.length >= minRatio;
}

/** « 150000 » devient « 150 000 » (espace simple, sans espace insécable). */
export function formatXof(n: number): string {
  return new Intl.NumberFormat("fr-FR").format(n).replace(/[  ]/g, " ");
}
