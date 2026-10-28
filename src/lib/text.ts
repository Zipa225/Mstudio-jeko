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

/** « 150000 » devient « 150 000 » (espace simple, sans espace insécable). */
export function formatXof(n: number): string {
  return new Intl.NumberFormat("fr-FR").format(n).replace(/[  ]/g, " ");
}
