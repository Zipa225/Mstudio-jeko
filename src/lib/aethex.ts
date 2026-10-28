// Client AethexAI : voix vers texte et texte vers voix, appelés UNIQUEMENT depuis le serveur.
// Contrat lu dans la documentation d'AethexAI (developers.aethexai.com) :
//   POST /transcribe  multipart, champ `file` (WAV, FLAC ou Ogg/Opus, 8 Mio au plus), `language`; réponse JSON, texte dans `text`.
//   POST /tts         JSON { text (1 à 650 caractères), language, voice_id?, streaming }; réponse : WAV 24 kHz, 16 bits, mono.
//   En-tête d'authentification : X-API-Key. Facturation : à la réussite de la transcription, au caractère pour la synthèse.
// La clé n'apparaît dans aucun message d'erreur ni journal.

import type { VoiceService } from "./ports";

export const MAX_AUDIO_BYTES = 8 * 1024 * 1024;
export const MAX_TTS_CHARS = 650;
const TTS_CACHE_SIZE = 100;

const EXTENSIONS: Record<string, string> = {
  "audio/wav": "wav", "audio/x-wav": "wav", "audio/wave": "wav", "audio/vnd.wave": "wav",
  "audio/flac": "flac", "audio/x-flac": "flac",
  "audio/ogg": "ogg", "audio/opus": "ogg",
};

const baseMime = (mime: string) => mime.split(";")[0].trim().toLowerCase();

/** Extension de fichier pour un type audio accepté par AethexAI, ou undefined si le format n'est pas accepté. */
export const audioExtension = (mime: string): string | undefined => EXTENSIONS[baseMime(mime)];

export type AethexErrorKind = "timeout" | "network" | "http" | "invalid" | "rejected";

export class AethexError extends Error {
  constructor(readonly kind: AethexErrorKind, message: string, readonly status?: number) {
    super(message);
    this.name = "AethexError";
  }
}

export interface AethexOptions {
  baseUrl: string;
  apiKey: string;
  /** Voix à utiliser. Si AethexAI ne la connaît pas (404), on retombe sur la voix par défaut de leur service. */
  voiceId?: string;
  timeoutMs?: number;
  /** Pour les tests. */
  fetchImpl?: typeof fetch;
}

/** Coupe un texte trop long pour la synthèse à la dernière fin de phrase (sinon au dernier espace) avant `max` caractères. */
export function truncateForTts(text: string, max = MAX_TTS_CHARS): string {
  if (text.length <= max) return text;
  const head = text.slice(0, max);
  const sentence = Math.max(head.lastIndexOf(". "), head.lastIndexOf("! "), head.lastIndexOf("? "));
  if (sentence > 0) return head.slice(0, sentence + 1);
  const space = head.lastIndexOf(" ");
  return space > 0 ? head.slice(0, space) : head;
}

const isWav = (bytes: Uint8Array) =>
  bytes.length > 12 && String.fromCharCode(...bytes.subarray(0, 4)) === "RIFF" && String.fromCharCode(...bytes.subarray(8, 12)) === "WAVE";

export function createAethexVoice(options: AethexOptions): VoiceService {
  let base: URL;
  try {
    base = new URL(options.baseUrl);
  } catch {
    throw new Error("Adresse d'AethexAI invalide");
  }
  if (base.protocol !== "http:" && base.protocol !== "https:") throw new Error("Adresse d'AethexAI invalide");
  if (!options.apiKey) throw new Error("Clé AethexAI manquante");

  const root = `${base.origin}${base.pathname.replace(/\/+$/, "")}`;
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 8000;
  let voiceId = options.voiceId;
  const cache = new Map<string, ArrayBuffer>();

  async function call(path: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetchImpl(`${root}${path}`, {
        ...init,
        headers: { ...(init.headers as Record<string, string> | undefined), "x-api-key": options.apiKey },
        signal: controller.signal,
        cache: "no-store",
      });
    } catch (e) {
      throw controller.signal.aborted || (e as { name?: string })?.name === "AbortError"
        ? new AethexError("timeout", "AethexAI n'a pas répondu à temps")
        : new AethexError("network", "AethexAI est injoignable");
    } finally {
      clearTimeout(timer);
    }
  }

  const failIfNotOk = (res: Response) => {
    if (!res.ok) throw new AethexError("http", `AethexAI a répondu avec le code ${res.status}`, res.status);
  };

  return {
    async transcribe(audio: ArrayBuffer, mime: string): Promise<string> {
      const ext = audioExtension(mime);
      if (!ext) throw new AethexError("rejected", "Format audio non accepté");
      if (audio.byteLength === 0) throw new AethexError("rejected", "Audio vide");
      if (audio.byteLength > MAX_AUDIO_BYTES) throw new AethexError("rejected", "Audio trop gros");

      const form = new FormData();
      form.set("file", new Blob([audio], { type: baseMime(mime) }), `voix.${ext}`);
      form.set("language", "french");
      const res = await call("/transcribe", { method: "POST", body: form });
      failIfNotOk(res);

      let data: { text?: unknown; status?: unknown } | null;
      try {
        data = (await res.json()) as { text?: unknown; status?: unknown } | null;
      } catch {
        throw new AethexError("invalid", "Réponse d'AethexAI illisible");
      }
      if (!data || typeof data.text !== "string" || (data.status !== undefined && data.status !== "completed")) {
        throw new AethexError("invalid", "Réponse d'AethexAI illisible");
      }
      return data.text.trim();
    },

    async synthesize(text: string): Promise<{ audio: ArrayBuffer; contentType: string }> {
      const spoken = truncateForTts(text.trim());
      if (!spoken) throw new AethexError("rejected", "Texte vide");

      const cached = cache.get(`${voiceId ?? ""}|${spoken}`);
      if (cached) return { audio: cached.slice(0), contentType: "audio/wav" };

      const request = (withVoice: boolean) =>
        call("/tts", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ text: spoken, language: "french", streaming: false, ...(withVoice && voiceId ? { voice_id: voiceId } : {}) }),
        });

      let res = await request(true);
      if (res.status === 404 && voiceId) {
        // La voix demandée n'existe pas chez AethexAI : on utilise la voix par défaut du service, et on s'en souvient.
        voiceId = undefined;
        res = await request(false);
      }
      failIfNotOk(res);

      const audio = await res.arrayBuffer();
      if (!isWav(new Uint8Array(audio))) throw new AethexError("invalid", "Réponse d'AethexAI illisible");
      if (cache.size >= TTS_CACHE_SIZE) cache.delete(cache.keys().next().value as string);
      cache.set(`${voiceId ?? ""}|${spoken}`, audio.slice(0));
      return { audio, contentType: "audio/wav" };
    },
  };
}

/** Texte sans détail sensible, pour dire pourquoi la voix a échoué. */
export function describeAethexFailure(error: unknown): string {
  if (error instanceof AethexError) {
    if (error.kind === "timeout") return "AethexAI n'a pas répondu à temps";
    if (error.kind === "rejected") return error.message;
    if (error.kind === "invalid") return "AethexAI a renvoyé une réponse illisible";
    if (error.kind === "http") {
      if (error.status === 401 || error.status === 403) return "La clé AethexAI est refusée";
      if (error.status === 402 || error.status === 429) return `Crédits ou limite d'AethexAI atteints (code ${error.status})`;
      if (error.status === 503) return "AethexAI est momentanément indisponible";
      return `AethexAI a refusé la demande (code ${error.status})`;
    }
  }
  return "AethexAI est injoignable";
}
