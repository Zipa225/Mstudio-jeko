import { audioExtension, MAX_AUDIO_BYTES } from "../../../lib/aethex";
import { publicTranscript } from "../../../lib/duress";
import { guarded, json } from "../../../lib/http";
import { getRuntime } from "../../../lib/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Transcrit un enregistrement SANS lancer le dialogue : pour la page de calibration /micro (démonstration seulement).
 * Rien n'est exécuté, ni opération, ni alerte, ni fiche. La phrase de contrainte, si elle était dite pendant un test,
 * est retirée du texte renvoyé et n'est jamais journalisée. La clé AethexAI reste côté serveur.
 */
export async function POST(req: Request) {
  return guarded(async () => {
    const rt = getRuntime();
    if (!rt.demoMode) return json({ error: "demo_only" }, 403);
    if (!rt.voice) return json({ error: "voice_not_available", message: "La voix serveur n'est pas configurée." }, 501);
    if (!(req.headers.get("content-type") ?? "").includes("multipart/form-data")) return json({ error: "unsupported_media_type" }, 415);

    const declared = Number(req.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > MAX_AUDIO_BYTES + 65_536) return json({ error: "too_large" }, 413);

    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      return json({ error: "invalid_form" }, 400);
    }
    const audio = form.get("audio");
    if (!(audio instanceof Blob)) return json({ error: "no_audio" }, 400);
    if (!audioExtension(audio.type)) return json({ error: "unsupported_media_type" }, 415);
    if (audio.size > MAX_AUDIO_BYTES) return json({ error: "too_large" }, 413);

    try {
      const text = (await rt.voice.transcribe(await audio.arrayBuffer(), audio.type)).slice(0, 500);
      return json({ text: publicTranscript(text, rt.getPhrase()) });
    } catch {
      return json({ error: "stt_failed", message: "Je n'ai pas pu comprendre l'audio." }, 502);
    }
  });
}
