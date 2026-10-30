// Lecture d'un tour de parole envoyé à une route : soit du texte (JSON { sessionId, text }), soit un enregistrement
// (multipart { sessionId, audio }) que le serveur fait transcrire par AethexAI. Partagé par /api/turn et /api/prospect.
// La clé AethexAI reste côté serveur ; aucune parole n'est journalisée.

import { audioExtension, MAX_AUDIO_BYTES } from "./aethex";
import { json, readJson, SESSION_ID } from "./http";
import type { Runtime } from "./runtime";

export const MAX_TEXT = 500;

/** Macros de démonstration (JSON seulement) : le serveur complète la phrase, le navigateur ne connaît jamais le mot secret. */
export const DEMO_MACROS = ["contrainte"] as const;
export type DemoMacro = (typeof DEMO_MACROS)[number];

export type SpokenInput = { ok: true; sessionId: string; text: string; macro?: DemoMacro } | { ok: false; response: Response };

export async function readSpokenInput(req: Request, rt: Runtime): Promise<SpokenInput> {
  const fail = (body: unknown, status: number): SpokenInput => ({ ok: false, response: json(body, status) });

  if ((req.headers.get("content-type") ?? "").includes("multipart/form-data")) {
    if (!rt.voice) {
      return fail({ error: "voice_not_available", message: "La voix serveur n'est pas configurée : utilise la voix du navigateur ou le clavier." }, 501);
    }
    const declared = Number(req.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > MAX_AUDIO_BYTES + 65_536) return fail({ error: "too_large" }, 413);

    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      return fail({ error: "invalid_form" }, 400);
    }
    const sessionId = form.get("sessionId");
    const audio = form.get("audio");
    if (typeof sessionId !== "string" || !SESSION_ID.test(sessionId)) return fail({ error: "invalid_session" }, 400);
    if (!(audio instanceof Blob)) return fail({ error: "no_audio" }, 400);
    if (!audioExtension(audio.type)) return fail({ error: "unsupported_media_type" }, 415);
    if (audio.size > MAX_AUDIO_BYTES) return fail({ error: "too_large" }, 413);

    try {
      return { ok: true, sessionId, text: (await rt.voice.transcribe(await audio.arrayBuffer(), audio.type)).slice(0, MAX_TEXT) };
    } catch {
      return fail({ error: "stt_failed", message: "Je n'ai pas pu comprendre l'audio. Réessaie ou utilise le clavier." }, 502);
    }
  }

  const body = await readJson(req);
  if (!body.ok) return { ok: false, response: body.response };
  const { sessionId, text, macro } = body.data;
  if (typeof sessionId !== "string" || !SESSION_ID.test(sessionId)) return fail({ error: "invalid_session" }, 400);
  if (typeof text !== "string" || text.length > MAX_TEXT) return fail({ error: "invalid_text" }, 400);
  if (macro === undefined) return { ok: true, sessionId, text };
  if (typeof macro !== "string" || !(DEMO_MACROS as readonly string[]).includes(macro)) return fail({ error: "invalid_macro" }, 400);
  return { ok: true, sessionId, text, macro: macro as DemoMacro };
}
