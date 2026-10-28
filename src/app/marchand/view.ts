// Aides pures de l'écran de la vendeuse : états, textes, choix d'affichage. Sans React, donc testables.

import type { Tone, TurnResult } from "../../lib/dialog";

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
export const canSimulateClientPayment = (r: Pick<TurnResult, "payment"> | undefined, demoMode: boolean): boolean =>
  demoMode && Boolean(r?.payment?.id);

/** `?test=1` : mode clavier, sans micro. */
export const isTestMode = (search: string): boolean => new URLSearchParams(search).get("test") === "1";

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

export function heardLine(heard: string | undefined): string | undefined {
  const text = heard?.trim();
  return text ? `Tu as dit : « ${text} »` : undefined;
}
