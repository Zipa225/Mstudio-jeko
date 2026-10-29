import { duressStatus, publicTranscript } from "../../../lib/duress";
import { guarded, json } from "../../../lib/http";
import { getRuntime } from "../../../lib/runtime";
import { readSpokenInput } from "../../../lib/spokenInput";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Un tour de parole, de deux façons :
 *  - JSON { sessionId, text } (mode clavier, ou voix du navigateur) ;
 *  - multipart { sessionId, audio } : l'enregistrement est transcrit par AethexAI, puis traité comme du texte.
 * Réponse : { heard, reply, speech, awaitingConfirm, tone, payment? }. `heard` est ce que l'écran peut afficher de la
 * phrase de la vendeuse : la phrase de contrainte en est retirée. Rien n'est journalisé (la parole peut contenir la
 * phrase secrète) et la clé AethexAI ne quitte jamais le serveur.
 *
 * Démonstration seulement (DEMO_MODE=1) : { macro: "contrainte" } fait dire « Oui, c'est bon » suivi du mot secret, ajouté
 * ICI par le serveur. Le bouton de la page ne contient donc jamais le mot : il n'est ni à l'écran, ni dans le navigateur.
 */
export async function POST(req: Request) {
  return guarded(async () => {
    const rt = getRuntime();
    const input = await readSpokenInput(req, rt);
    if (!input.ok) return input.response;

    let text = input.text;
    if (input.macro === "contrainte") {
      if (!rt.demoMode) return json({ error: "demo_only" }, 403);
      const phrase = rt.getPhrase();
      const status = duressStatus(phrase);
      if (status !== "active" && status !== "word") {
        return json({ error: "duress_disabled", message: "Aucun mot secret valide n'est configuré (DURESS_PHRASE)." }, 409);
      }
      text = `Oui, c'est bon, ${phrase}`;
    }

    const result = await rt.dialog.handleTurn(input.sessionId, text);
    rt.allowSpeech(result.speech);
    return json({ heard: publicTranscript(text, rt.getPhrase()), ...result });
  });
}
