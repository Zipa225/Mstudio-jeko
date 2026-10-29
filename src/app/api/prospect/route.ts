import { publicTranscript } from "../../../lib/duress";
import { guarded, json } from "../../../lib/http";
import { getRuntime } from "../../../lib/runtime";
import { readSpokenInput } from "../../../lib/spokenInput";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * L'entretien d'un visiteur (F12) : { sessionId, text } en JSON, ou { sessionId, audio } en multipart (transcrit par
 * AethexAI). Un texte vide fait démarrer l'entretien (ou répète la question en cours).
 * Réponse : { heard, reply, speech, source?, stage, interest }.
 * La phrase de contrainte du marchand, si un visiteur la disait par hasard, est retirée avant tout : elle n'entre ni dans
 * la fiche du prospect, ni dans la réponse. Aucune coordonnée n'est collectée.
 */
export async function POST(req: Request) {
  return guarded(async () => {
    const rt = getRuntime();
    const input = await readSpokenInput(req, rt);
    if (!input.ok) return input.response;

    const text = publicTranscript(input.text, rt.getPhrase());
    const result = rt.prospects.handleTurn(input.sessionId, text);
    rt.allowSpeech(result.speech);
    return json({ heard: text, ...result });
  });
}
