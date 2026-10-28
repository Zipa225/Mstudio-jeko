// Capture de la voix dans le navigateur : on enregistre, on s'arrête quand la vendeuse se tait, et on envoie un WAV
// 16 kHz mono à AethexAI (via notre serveur). Le micro exige HTTPS (ou localhost).
// Les fonctions pures (WAV, rééchantillonnage, silence) sont testées ; la capture du micro l'est dans un vrai navigateur.

export const TARGET_SAMPLE_RATE = 16_000;
/** Durée maximale d'un enregistrement (cahier des charges : 12 secondes). */
export const MAX_RECORDING_MS = 12_000;

// ---------------------------------------------------------------------------
// Fonctions pures
// ---------------------------------------------------------------------------

export function mixToMono(channels: Float32Array[]): Float32Array {
  if (channels.length === 0) return new Float32Array(0);
  if (channels.length === 1) return channels[0];
  const out = new Float32Array(channels[0].length);
  for (const channel of channels) for (let i = 0; i < out.length; i++) out[i] += channel[i] / channels.length;
  return out;
}

/** Réduit (moyenne par fenêtre) ou augmente (interpolation) la fréquence d'échantillonnage. */
export function resample(input: Float32Array, from: number, to: number): Float32Array {
  if (from === to || input.length === 0) return input;
  const ratio = from / to;
  const length = Math.floor(input.length / ratio);
  const out = new Float32Array(length);
  if (ratio > 1) {
    for (let i = 0; i < length; i++) {
      const start = Math.floor(i * ratio);
      const end = Math.min(input.length, Math.max(start + 1, Math.floor((i + 1) * ratio)));
      let sum = 0;
      for (let j = start; j < end; j++) sum += input[j];
      out[i] = sum / (end - start);
    }
  } else {
    for (let i = 0; i < length; i++) {
      const position = i * ratio;
      const left = Math.floor(position);
      const right = Math.min(input.length - 1, left + 1);
      out[i] = input[left] + (input[right] - input[left]) * (position - left);
    }
  }
  return out;
}

/** WAV PCM 16 bits, mono. */
export function encodeWav(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const dataBytes = samples.length * 2;
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);
  const text = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i));
  };
  text(0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true); // taille du bloc fmt
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // octets par seconde
  view.setUint16(32, 2, true); // octets par échantillon
  view.setUint16(34, 16, true); // bits par échantillon
  text(36, "data");
  view.setUint32(40, dataBytes, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return buffer;
}

export function rmsOf(samples: Float32Array): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  return Math.sqrt(sum / samples.length);
}

export type StopReason = "silence" | "max" | "no_speech";

export interface SilenceOptions {
  /** Niveau (RMS) au-dessus duquel on considère qu'on parle, dans une pièce calme. */
  threshold: number;
  /** Silence qui suit la parole avant l'arrêt. */
  silenceMs: number;
  /** Durée de parole minimale pour qu'un silence arrête l'enregistrement (un claquement ne compte pas). */
  minSpeechMs: number;
  maxMs: number;
  /** Sans aucune parole pendant ce temps, on arrête. */
  noSpeechMs: number;
  /** Les premières millisecondes mesurent le bruit ambiant (marché, musique) pour relever le seuil. */
  calibrateMs?: number;
  noiseFactor?: number;
  /** Le seuil relevé ne dépasse jamais cette valeur, pour ne pas couvrir la voix. */
  maxThreshold?: number;
}

export const DEFAULT_SILENCE: SilenceOptions = {
  threshold: 0.02, silenceMs: 1200, minSpeechMs: 250, maxMs: MAX_RECORDING_MS, noSpeechMs: 5000,
};

export type SilenceDecision = { stop: false } | { stop: true; reason: StopReason };

export interface SilenceDetector {
  push(rms: number, nowMs: number): SilenceDecision;
  /** Seuil réellement utilisé (relevé selon le bruit ambiant). */
  threshold(): number;
}

export function createSilenceDetector(options: SilenceOptions = DEFAULT_SILENCE): SilenceDetector {
  const { silenceMs, minSpeechMs, maxMs, noSpeechMs } = options;
  const calibrateMs = options.calibrateMs ?? 300;
  const noiseFactor = options.noiseFactor ?? 2.5;
  const maxThreshold = options.maxThreshold ?? 0.06;

  let start: number | undefined;
  let last = 0;
  let lastLoud = 0;
  let speechMs = 0;
  let heard = false;
  let noiseSum = 0;
  let noiseCount = 0;
  let effective = options.threshold;

  return {
    threshold: () => effective,
    push(rms: number, now: number): SilenceDecision {
      if (start === undefined) {
        start = now;
        last = now;
        lastLoud = now;
      }
      const dt = now - last;
      last = now;

      if (now - start < calibrateMs) {
        noiseSum += rms;
        noiseCount++;
        effective = Math.min(maxThreshold, Math.max(options.threshold, (noiseSum / noiseCount) * noiseFactor));
        return { stop: false };
      }

      if (rms >= effective) {
        speechMs += dt;
        lastLoud = now;
        heard = true;
      }
      if (now - start >= maxMs) return { stop: true, reason: "max" };
      if (!heard && now - start >= noSpeechMs) return { stop: true, reason: "no_speech" };
      if (heard && speechMs >= minSpeechMs && now - lastLoud >= silenceMs) return { stop: true, reason: "silence" };
      if (heard && speechMs < minSpeechMs && now - lastLoud >= noSpeechMs) return { stop: true, reason: "no_speech" };
      return { stop: false };
    },
  };
}

// ---------------------------------------------------------------------------
// Capture du micro (navigateur)
// ---------------------------------------------------------------------------

export interface RecordingResult {
  /** WAV 16 kHz mono, prêt à être envoyé. */
  wav: ArrayBuffer;
  reason: StopReason | "manual";
}

export interface Recording {
  /** Arrête l'enregistrement tout de suite (la vendeuse rappuie sur le micro). */
  stop(): void;
  /** `undefined` si rien n'a été entendu. */
  result: Promise<RecordingResult | undefined>;
}

const MIME_CANDIDATES = ["audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/mp4", "audio/webm"];

export async function startRecording(options: SilenceOptions = DEFAULT_SILENCE): Promise<Recording> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
  const AudioCtor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const context = new AudioCtor();
  const analyser = context.createAnalyser();
  analyser.fftSize = 1024;
  context.createMediaStreamSource(stream).connect(analyser);

  const mimeType = MIME_CANDIDATES.find((m) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(m));
  const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };

  const detector = createSilenceDetector(options);
  const level = new Float32Array(analyser.fftSize);
  let reason: StopReason | "manual" = "manual";
  const finish = (why: StopReason | "manual") => {
    reason = why;
    if (recorder.state !== "inactive") recorder.stop();
  };
  const timer = setInterval(() => {
    analyser.getFloatTimeDomainData(level);
    const decision = detector.push(rmsOf(level), performance.now());
    if (decision.stop) finish(decision.reason);
  }, 100);

  const release = () => {
    clearInterval(timer);
    stream.getTracks().forEach((t) => t.stop());
  };

  const result = new Promise<RecordingResult | undefined>((resolve) => {
    recorder.onstop = async () => {
      release();
      try {
        if (reason === "no_speech" || chunks.length === 0) return resolve(undefined);
        const decoded = await context.decodeAudioData(await new Blob(chunks).arrayBuffer());
        const channels = Array.from({ length: decoded.numberOfChannels }, (_v, i) => decoded.getChannelData(i));
        const mono = resample(mixToMono(channels), decoded.sampleRate, TARGET_SAMPLE_RATE);
        resolve({ wav: encodeWav(mono, TARGET_SAMPLE_RATE), reason });
      } catch {
        resolve(undefined);
      } finally {
        void context.close();
      }
    };
  });

  recorder.start();
  return { stop: () => finish("manual"), result };
}
