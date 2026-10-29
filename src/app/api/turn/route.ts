import { guarded, json } from "../../../lib/http";
import { publicTranscript } from "../../../lib/duress";
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
 */
export async function POST(req: Request) {
  return guarded(async () => {
    const rt = getRuntime();
    const input = await readSpokenInput(req, rt);
    if (!input.ok) return input.response;

    const result = await rt.dialog.handleTurn(input.sessionId, input.text);
    rt.allowSpeech(result.speech);
    return json({ heard: publicTranscript(input.text, rt.getPhrase()), ...result });
  });
}
