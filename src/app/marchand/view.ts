// Aides pures de l'écran de la vendeuse : états, textes, choix d'affichage. Sans React, donc testables.

import type { Tone, TurnResult } from "../../lib/dialog";
import { CLIPPING_LIMIT, type MicProfile } from "./audio";

/** Ce que fait l'écran : au repos, il écoute, il réfléchit, il parle. */
export type Phase = "idle" | "listening" | "thinking" | "speaking";

export const PHASE_LABEL: Record<Phase, string> = {
  idle: "Appuie pour parler",
  listening: "Je t'écoute",
  thinking: "Je réfléchis",
  speaking: "Je réponds",
};

/**
 * Ce que renvoie POST /api/turn : la réponse du dialogue, et `heard`, ce que l'écran peut montrer de la phrase de la
 * vendeuse. La phrase secrète en est retirée par le serveur : l'écran n'affiche jamais le texte reconnu par le micro.
 */
export interface TurnView extends TurnResult {
  heard?: string;
}

export const GREETING: TurnView = {
  reply: "Appuie sur le micro et dis ce que tu veux faire.",
  speech: "Appuie sur le micro et dis ce que tu veux faire.",
  awaitingConfirm: false,
  tone: "info",
};

export const errorView = (): TurnView => ({
  reply: "Un problème est survenu. Réessaie.",
  speech: "Un problème est survenu. Réessaie.",
  awaitingConfirm: false,
  tone: "refusal",
});

/** L'apparence de la réponse. Sans `tone` (ancienne réponse), on se rabat sur « confirmation » ou « information ». */
export const screenKind = (r: Pick<TurnResult, "tone" | "awaitingConfirm"> | undefined): Tone =>
  r?.tone ?? (r?.awaitingConfirm ? "ask" : "info");

/** Les gros boutons Oui et Non n'existent que pendant une confirmation. */
export const showConfirmButtons = (r: Pick<TurnResult, "awaitingConfirm"> | undefined): boolean => r?.awaitingConfirm === true;

/** Le bouton « le client a payé » (simulation) n'existe qu'en démonstration, après le lancement d'un encaissement. */
export const canSimulateClientPayment = (r: Pick<TurnResult, "payment"> | undefined, demoMode: boolean, jekoLive = false): boolean =>
  demoMode && !jekoLive && Boolean(r?.payment?.id);

/** Le lien de paiement du client, seulement s'il est en https (la page ne suit jamais un autre schéma). */
export function payLink(r: Pick<TurnResult, "payment"> | undefined): string | undefined {
  const url = r?.payment?.url;
  if (!url) return undefined;
  try {
    return new URL(url).protocol === "https:" ? url : undefined;
  } catch {
    return undefined;
  }
}

/** Avec la vraie caisse, la page attend le webhook de Jèko : elle demande où en est le paiement toutes les 2 s, 10 min au plus. */
export const PAYMENT_POLL_MS = 2000;
export const PAYMENT_POLL_MAX_MS = 10 * 60_000;

export const jekoModeFrom = (health: { jeko?: unknown } | undefined): "live" | "mock" => (health?.jeko === "live" ? "live" : "mock");

/** `?test=1` : mode clavier, sans micro. */
export const isTestMode = (search: string): boolean => new URLSearchParams(search).get("test") === "1";

/** `?demo=1` : panneau du présentateur, des boutons qui disent les phrases de la démonstration à la place de la voix. */
export const isDemoPanel = (search: string): boolean => new URLSearchParams(search).get("demo") === "1";

/**
 * Prénoms jamais utilisés dans les essais (Argus retient les bénéficiaires : un prénom déjà vu n'est plus « nouveau » et ne
 * déclenche plus la question de vérification). Ni Koné, Ouattara ni Sanogo, ni les trois contacts d'Awa.
 */
export const DEMO_NAMES = [
  "Traoré", "Coulibaly", "Diabaté", "Bamba", "Kouassi", "Yao", "Konan", "Fofana", "Soro", "Gnagne", "Tano", "Doumbia", "Cissé",
  "Touré", "Kouadio", "Zadi", "Ahoua", "Bakayoko", "Dosso", "Sylla",
];

/** Un prénom au hasard (`random` entre 0 et 1), différent de `not` quand c'est possible. */
export function pickDemoName(random: number, not?: string): string {
  const pool = DEMO_NAMES.filter((n) => n !== not);
  return pool[Math.min(pool.length - 1, Math.floor(random * pool.length))];
}

export interface DemoPhrase {
  id: "encaisse" | "oui" | "transfert" | "contrainte" | "refus" | "support" | "non";
  label: string;
  /** Ce que la page envoie, comme si la vendeuse l'avait dit. */
  text: string;
  /** « contrainte » : le serveur ajoute le mot secret, la page ne le connaît pas. */
  macro?: "contrainte";
}

/** Les phrases de la démonstration, dans l'ordre des scènes du README. */
export const demoPhrases = (name: string): DemoPhrase[] => [
  { id: "encaisse", label: "1. Encaisser 5 000 F par Wave", text: "Encaisse cinq mille francs par Wave" },
  { id: "oui", label: "Oui", text: "oui" },
  { id: "transfert", label: `2. Envoyer 150 000 F à ${name}`, text: `Envoie cent cinquante mille francs à ${name}` },
  { id: "contrainte", label: "3. Oui, sous contrainte", text: "oui", macro: "contrainte" },
  { id: "refus", label: `4. Envoyer 250 000 F à ${name}`, text: `Envoie deux cent cinquante mille francs à ${name}` },
  { id: "support", label: "5. Question : le plafond", text: "J'ai atteint la limite de 200 000, comment augmenter mon plafond ?" },
  { id: "non", label: "Non", text: "non" },
];

/** `?debug=1` : rejoue le son envoyé à la reconnaissance vocale, avec son niveau, pour comprendre une transcription fausse. */
export const isDebugMode = (search: string): boolean => new URLSearchParams(search).get("debug") === "1";

/**
 * Un enregistrement saturé (voix déformée) est mal transcrit : on ne l'envoie pas, on le dit. Si le réglage utilise le gain
 * automatique du navigateur (la cause habituelle), on le coupe pour l'essai suivant ; sinon on demande de baisser le volume.
 * `undefined` : le son n'est pas saturé, on l'envoie.
 */
export function saturationAdvice(profile: MicProfile, stats: { clipped: number }): { message: string; nextProfile?: MicProfile } | undefined {
  if (!(stats.clipped > CLIPPING_LIMIT)) return undefined;
  if (profile === "standard" || profile === "sans_reduction") {
    return { nextProfile: "sans_gain", message: "Ton micro sature, la voix est déformée : j'ai coupé le gain automatique. Redis ta phrase." };
  }
  return {
    message: "Ton micro sature, la voix est déformée : baisse le volume du micro dans les réglages de ton appareil, ou éloigne-toi un peu. Puis redis ta phrase.",
  };
}

/** Une ligne lisible sur l'enregistrement : durée, volume d'origine, amplification appliquée, et un diagnostic. */
export function describeRecording(stats: { durationSeconds: number; peak: number; gain: number; clipped?: number }): string {
  const fmt = (n: number) => new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 2 }).format(n);
  const quality =
    (stats.clipped ?? 0) > CLIPPING_LIMIT ? "SATURÉ : le son est déformé, baisse le volume du micro ou éloigne-toi de lui"
    : stats.peak < 0.004 ? "quasi silencieux : le micro n'a presque rien capté"
    : stats.peak < 0.05 ? "voix très basse : rapproche le micro"
    : stats.gain > 4 ? "voix basse (remontée automatiquement)"
    : "volume correct";
  return `${fmt(stats.durationSeconds)} s · crête ${fmt(stats.peak)} · amplifié ×${fmt(stats.gain)} · ${quality}`;
}

/** Identifiant de session de la page : lettres, chiffres et tirets, comme l'attend le serveur. */
export const newSessionId = (randomBytes: ArrayLike<number>): string =>
  `awa-${Array.from(randomBytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;

/** D'où vient la voix : d'AethexAI (clé configurée côté serveur), ou du navigateur en secours. */
export type VoiceMode = "aethex" | "browser";

export const voiceModeFrom = (health: { voice?: unknown } | undefined): VoiceMode => (health?.voice === "aethex" ? "aethex" : "browser");

/** Message pour la vendeuse quand le micro ne démarre pas. `name` : le nom de l'erreur du navigateur. */
export function micErrorMessage(name: string | undefined, secureContext: boolean): string {
  if (!secureContext) return "Le micro demande une connexion sécurisée (HTTPS) : écris ta demande.";
  if (name === "NotAllowedError" || name === "SecurityError") return "Autorise le micro dans ton navigateur.";
  if (name === "NotFoundError" || name === "OverconstrainedError") return "Aucun micro n'a été trouvé.";
  if (name === "NotReadableError") return "Le micro est utilisé par une autre application.";
  return "Le micro n'est pas disponible ici : écris ta demande.";
}

/** « 10 000 » ne doit pas se couper en fin de ligne : on lie les groupes de chiffres par une espace insécable. */
export const keepNumbersTogether = (text: string): string => text.replace(/(\d) (?=\d{3}(?!\d))/g, "$1 ");

/** « Source : … » sous une réponse du support. */
export const sourceLine = (source: string | undefined): string | undefined => {
  const text = source?.trim();
  return text ? `Source : ${text}` : undefined;
};

export function heardLine(heard: string | undefined): string | undefined {
  const text = heard?.trim();
  return text ? `Tu as dit : « ${text} »` : undefined;
}
