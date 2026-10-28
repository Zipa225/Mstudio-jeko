import { guarded, json, readJson, SESSION_ID } from "../../../lib/http";
import { publicTranscript } from "../../../lib/duress";
import { getRuntime } from "../../../lib/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_TEXT = 500;

/**
 * Un tour de parole : { sessionId, text } -> { heard, reply, speech, awaitingConfirm, payment? }.
 * `heard` est ce que l'écran peut afficher de la phrase du marchand : la phrase de contrainte en est retirée.
 * Rien n'est journalisé : une phrase peut contenir la phrase secrète.
 * La voix (envoi d'un enregistrement audio) arrive avec la branche voix.
 */
export async function POST(req: Request) {
  return guarded(async () => {
    if ((req.headers.get("content-type") ?? "").includes("multipart/form-data")) {
      return json({ error: "voice_not_available", message: "La voix n'est pas encore branchée : utilise le clavier." }, 501);
    }
    const body = await readJson(req);
    if (!body.ok) return body.response;

    const { sessionId, text } = body.data;
    if (typeof sessionId !== "string" || !SESSION_ID.test(sessionId)) return json({ error: "invalid_session" }, 400);
    if (typeof text !== "string" || text.length > MAX_TEXT) return json({ error: "invalid_text" }, 400);

    const rt = getRuntime();
    const result = await rt.dialog.handleTurn(sessionId, text);
    return json({ heard: publicTranscript(text, rt.getPhrase()), ...result });
  });
}
