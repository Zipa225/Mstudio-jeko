import { MAX_TTS_CHARS } from "../../../lib/aethex";
import { guarded, json, readJson } from "../../../lib/http";
import { getRuntime } from "../../../lib/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Texte vers voix : { text } -> un fichier WAV (24 kHz, mono) prononcé par AethexAI.
 * Deux protections, car chaque caractère synthétisé consomme des crédits :
 *  - la route n'accepte que des phrases que le serveur a lui-même produites (réponses du dialogue, annonce de paiement) ;
 *  - la clé AethexAI reste côté serveur, la page ne voit jamais que l'audio.
 * Sans clé AethexAI, la route répond 501 et la page utilise la voix du navigateur.
 */
export async function POST(req: Request) {
  return guarded(async () => {
    const rt = getRuntime();
    if (!rt.voice) return json({ error: "voice_not_available" }, 501);

    const body = await readJson(req, 4_000);
    if (!body.ok) return body.response;
    const { text } = body.data;
    if (typeof text !== "string" || !text.trim() || text.length > MAX_TTS_CHARS) return json({ error: "invalid_text" }, 400);
    if (!rt.isAllowedSpeech(text)) return json({ error: "not_allowed" }, 403);

    try {
      const { audio, contentType } = await rt.voice.synthesize(text);
      return new Response(audio, { status: 200, headers: { "content-type": contentType, "cache-control": "no-store" } });
    } catch {
      return json({ error: "tts_failed" }, 502);
    }
  });
}
