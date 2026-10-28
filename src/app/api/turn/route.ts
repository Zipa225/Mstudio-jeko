import { audioExtension, MAX_AUDIO_BYTES } from "../../../lib/aethex";
import { guarded, json, readJson, SESSION_ID } from "../../../lib/http";
import { publicTranscript } from "../../../lib/duress";
import { getRuntime } from "../../../lib/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_TEXT = 500;

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
    let sessionId: unknown;
    let text: unknown;

    if ((req.headers.get("content-type") ?? "").includes("multipart/form-data")) {
      if (!rt.voice) {
        return json({ error: "voice_not_available", message: "La voix serveur n'est pas configurée : utilise la voix du navigateur ou le clavier." }, 501);
      }
      const declared = Number(req.headers.get("content-length"));
      if (Number.isFinite(declared) && declared > MAX_AUDIO_BYTES + 65_536) return json({ error: "too_large" }, 413);

      let form: FormData;
      try {
        form = await req.formData();
      } catch {
        return json({ error: "invalid_form" }, 400);
      }
      sessionId = form.get("sessionId");
      const audio = form.get("audio");
      if (typeof sessionId !== "string" || !SESSION_ID.test(sessionId)) return json({ error: "invalid_session" }, 400);
      if (!(audio instanceof Blob)) return json({ error: "no_audio" }, 400);
      if (!audioExtension(audio.type)) return json({ error: "unsupported_media_type" }, 415);
      if (audio.size > MAX_AUDIO_BYTES) return json({ error: "too_large" }, 413);

      try {
        text = (await rt.voice.transcribe(await audio.arrayBuffer(), audio.type)).slice(0, MAX_TEXT);
      } catch {
        return json({ error: "stt_failed", message: "Je n'ai pas pu comprendre l'audio. Réessaie ou utilise le clavier." }, 502);
      }
    } else {
      const body = await readJson(req);
      if (!body.ok) return body.response;
      sessionId = body.data.sessionId;
      text = body.data.text;
      if (typeof sessionId !== "string" || !SESSION_ID.test(sessionId)) return json({ error: "invalid_session" }, 400);
      if (typeof text !== "string" || text.length > MAX_TEXT) return json({ error: "invalid_text" }, 400);
    }

    const result = await rt.dialog.handleTurn(sessionId as string, text as string);
    rt.allowSpeech(result.speech);
    return json({ heard: publicTranscript(text as string, rt.getPhrase()), ...result });
  });
}
