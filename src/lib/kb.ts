// Base de réponses du support (F11). Règle RG-23 : toute réponse cite sa source ; une question hors base passe à un humain.
// Sources vérifiées le 29/10/2026 sur jeko.africa (pages Tarifs, FAQ, pied de page). Rien n'est inventé : ce qui n'est pas
// dans la base n'est pas répondu. Le plafond de 200 000 FCFA vient des notes des ingénieurs Jèko (à confirmer : par
// opération ou cumulé), et la réponse le dit.

import { toFrenchWords } from "./frenchNumbers";
import { formatXof, tokens } from "./text";

export interface KbEntry {
  id: string;
  /** Mots-clés sans accent, au singulier. Un mot de la question compte s'il est identique, ou au pluriel. */
  keywords: string[];
  /** Texte affiché. */
  reply: string;
  /** Texte prononcé (chiffres et sigles écrits comme on les dit). */
  speech: string;
  source: string;
  /** Vrai : la base ne sait qu'une partie de la réponse, un conseiller doit prendre la suite. */
  handoff?: boolean;
}

export const CEILING_XOF = 200_000;
export const SUPPORT_HOURS = "du lundi au vendredi, de 8 h à 18 h";

export const KB: KbEntry[] = [
  {
    id: "plafond",
    keywords: ["plafond", "limite", "maximum", "augmenter", "relever", "depasse"],
    reply: `Le plafond de ton compte est de ${formatXof(CEILING_XOF)} FCFA (règle communiquée par les ingénieurs Jèko, à confirmer). Je ne sais pas comment le relever : je transmets ta demande à un conseiller Jèko.`,
    speech: `Le plafond de ton compte est de ${toFrenchWords(CEILING_XOF)} francs. Je ne sais pas comment le relever : je transmets ta demande à un conseiller Jèko.`,
    source: "Notes des ingénieurs Jèko (plafond à confirmer)",
    handoff: true,
  },
  {
    id: "frais",
    keywords: ["frais", "commission", "tarif", "cout", "prix", "pourcentage", "abonnement"],
    reply: "Jèko prend 1,5 % sur chaque paiement reçu par lien de paiement ou en ligne, et 1 % avec la JèkoBox. Il n'y a ni abonnement ni frais d'activation.",
    speech: "Jèko prend un virgule cinq pour cent sur chaque paiement reçu par lien de paiement ou en ligne, et un pour cent avec la JèkoBox. Il n'y a ni abonnement ni frais d'activation.",
    source: "jeko.africa, page Tarifs",
  },
  {
    id: "virement",
    keywords: ["virement", "bancaire", "banque", "iban"],
    reply: "Un virement vers un compte bancaire coûte 1 000 FCFA, quel que soit le montant.",
    speech: "Un virement vers un compte bancaire coûte mille francs, quel que soit le montant.",
    source: "jeko.africa, page Tarifs",
  },
  {
    id: "reversement",
    keywords: ["reversement", "delai", "instantane", "attendre", "recois", "recevoir"],
    reply: "Ton argent arrive sur ton compte tout de suite, 24 heures sur 24 et 7 jours sur 7.",
    speech: "Ton argent arrive sur ton compte tout de suite, vingt-quatre heures sur vingt-quatre et sept jours sur sept.",
    source: "jeko.africa, page Tarifs",
  },
  {
    id: "box",
    keywords: ["jekobox", "box", "terminal", "sim", "forfait", "acheter"],
    reply: "La JèkoBox coûte 50 000 FCFA. Une carte SIM avec internet est en option, à 25 000 FCFA par an.",
    speech: "La JèkoBox coûte cinquante mille francs. Une carte SIM avec internet est en option, à vingt-cinq mille francs par an.",
    source: "jeko.africa, page Tarifs",
  },
  {
    id: "moyens",
    keywords: ["moyen", "accepte", "acceptez", "accepter", "carte", "visa", "mastercard", "djamo", "pispi", "qr"],
    reply: "Jèko accepte Wave, Orange Money, MTN Mobile Money, Moov Money, Djamo, les cartes Visa et Mastercard, et le QR Code PI-SPI.",
    speech: "Jèko accepte Wave, Orange Money, MTN Mobile Money, Moov Money, Djamo, les cartes Visa et Mastercard, et le QR Code PI-SPI.",
    source: "jeko.africa, FAQ",
  },
  {
    id: "pays",
    keywords: ["pays", "abidjan", "ivoire", "etranger", "cocody"],
    reply: "Jèko est basé à Abidjan, en Côte d'Ivoire, et travaille en Côte d'Ivoire.",
    speech: "Jèko est basé à Abidjan, en Côte d'Ivoire, et travaille en Côte d'Ivoire.",
    source: "jeko.africa, pied de page",
  },
  {
    id: "contact",
    keywords: ["contact", "contacter", "telephone", "appeler", "joindre", "horaire", "ouvert", "whatsapp", "mail", "courriel", "conseiller", "humain", "parler"],
    reply: `Tu peux joindre Jèko au 07 97 71 44 32 (aussi sur WhatsApp), ${SUPPORT_HOURS}. Courriel : hello@jeko.africa.`,
    speech: `Tu peux joindre Jèko au zéro sept, quatre-vingt-dix-sept, soixante et onze, quarante-quatre, trente-deux, ${SUPPORT_HOURS.replace(/8 h/, "huit heures").replace(/18 h/, "dix-huit heures")}. Le courriel est affiché à l'écran.`,
    source: "jeko.africa, pied de page",
  },
  {
    id: "verification",
    keywords: ["verification", "verifier", "securite", "securise", "protege", "protection", "argus", "kyc", "refuse", "bloque", "bloquee"],
    reply: "Quand une opération sort de l'ordinaire, comme un gros montant ou un nouveau numéro, je te pose une question avant de l'envoyer. Si elle est trop risquée, je la refuse et un conseiller te rappelle.",
    speech: "Quand une opération sort de l'ordinaire, comme un gros montant ou un nouveau numéro, je te pose une question avant de l'envoyer. Si elle est trop risquée, je la refuse et un conseiller te rappelle.",
    source: "Fonctionnement de cet assistant (protégé par Argus)",
  },
];

/** Un mot de la question correspond à un mot-clé s'il est identique, ou s'ils ne diffèrent que par un « s » final. */
const matches = (token: string, keyword: string) => token === keyword || token === `${keyword}s` || `${token}s` === keyword;

export interface SupportAnswer {
  entry: KbEntry;
  score: number;
}

/** La meilleure réponse de la base, ou undefined si aucun mot-clé ne correspond (la question passe alors à un humain). */
export function findAnswer(question: string): SupportAnswer | undefined {
  const words = tokens(question);
  let best: SupportAnswer | undefined;
  for (const entry of KB) {
    const score = entry.keywords.filter((k) => words.some((w) => matches(w, k))).length;
    if (score > 0 && (!best || score > best.score)) best = { entry, score };
  }
  return best;
}

/** Résumé d'une question pour le conseiller : une ligne, sans retour à la ligne, bornée. */
export function summarize(question: string, max = 200): string {
  const flat = question.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}
