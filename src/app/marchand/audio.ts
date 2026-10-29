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

export interface AudioStats {
  durationSeconds: number;
  /** Plus grand niveau avant normalisation (0 à 1). */
  peak: number;
  /** Niveau moyen (RMS) avant normalisation. */
  rms: number;
  /** Amplification appliquée avant l'envoi. */
  gain: number;
}

/** Amplification maximale : au-delà, on gonflerait surtout le bruit. */
export const MAX_GAIN = 40;
/** Niveau visé pour la crête de la voix après normalisation. */
export const TARGET_PEAK = 0.8;
/** En dessous de ce niveau, il n'y a que du silence ou du bruit : on n'amplifie pas. */
const SILENCE_PEAK = 0.004;

/**
 * Remonte le volume d'un enregistrement trop faible, sans jamais le baisser. Le moteur de reconnaissance d'AethexAI perd des
 * mots (ou en invente) quand la voix est basse, surtout avec du bruit : on vise une crête de voix à 0,8. La crête est lue au
 * 99,5e centile, pour qu'un claquement isolé ne décide pas du volume de toute la phrase.
 */
export function normalizeLevel(samples: Float32Array): { samples: Float32Array; stats: Omit<AudioStats, "durationSeconds"> } {
  if (samples.length === 0) return { samples, stats: { peak: 0, rms: 0, gain: 1 } };
  const abs = new Float32Array(samples.length);
  let peak = 0;
  for (let i = 0; i < samples.length; i++) {
    abs[i] = Math.abs(samples[i]);
    if (abs[i] > peak) peak = abs[i];
  }
  const rms = rmsOf(samples);
  if (peak < SILENCE_PEAK) return { samples, stats: { peak, rms, gain: 1 } };
  abs.sort();
  const robust = abs[Math.min(abs.length - 1, Math.floor(abs.length * 0.995))] || peak;
  const gain = Math.min(MAX_GAIN, TARGET_PEAK / robust);
  // Déjà au bon niveau (ou plus fort) : on laisse le son tel quel, sans le baisser ni le recopier.
  if (gain < 1.1) return { samples, stats: { peak, rms, gain: 1 } };
  const out = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i++) out[i] = Math.max(-1, Math.min(1, samples[i] * gain));
  return { samples: out, stats: { peak, rms, gain } };
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
  /** WAV 16 kHz mono, volume normalisé, prêt à être envoyé. */
  wav: ArrayBuffer;
  reason: StopReason | "manual";
  /** Niveau du son enregistré : sert au mode `?debug=1` pour comprendre une mauvaise transcription. */
  stats: AudioStats;
}

export interface Recording {
  /** Arrête l'enregistrement tout de suite (la vendeuse rappuie sur le micro). */
  stop(): void;
  /** `undefined` si rien n'a été entendu. */
  result: Promise<RecordingResult | undefined>;
}

/**
 * Les traitements que le navigateur applique au micro (annulation d'écho, réduction de bruit, gain automatique) aident
 * parfois la reconnaissance vocale et la gênent d'autres fois, selon l'appareil. La page /micro essaie les trois profils
 * avec la voix de la personne et garde celui que le moteur comprend le mieux.
 */
export type MicProfile = "standard" | "sans_reduction" | "brut";

export const MIC_PROFILES: Record<MicProfile, { label: string; constraints: MediaTrackConstraints; silence: Partial<SilenceOptions> }> = {
  standard: {
    label: "Standard : écho, réduction de bruit et gain automatiques",
    constraints: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
    silence: {},
  },
  sans_reduction: {
    label: "Sans réduction de bruit",
    constraints: { echoCancellation: true, noiseSuppression: false, autoGainControl: true, channelCount: 1 },
    silence: {},
  },
  brut: {
    label: "Brut : aucun traitement du navigateur",
    constraints: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 },
    // Sans gain automatique la voix est plus basse : le seuil de détection de parole baisse aussi.
    silence: { threshold: 0.008 },
  },
};

export const isMicProfile = (value: unknown): value is MicProfile => typeof value === "string" && Object.hasOwn(MIC_PROFILES, value);

const MIC_PROFILE_KEY = "jeko-micro-profil";

/** Le profil retenu pour cet appareil par la page /micro, sinon « standard ». Le stockage peut être indisponible. */
export function savedMicProfile(): MicProfile {
  try {
    const value = localStorage.getItem(MIC_PROFILE_KEY);
    return isMicProfile(value) ? value : "standard";
  } catch {
    return "standard";
  }
}

export function saveMicProfile(profile: MicProfile): void {
  try {
    localStorage.setItem(MIC_PROFILE_KEY, profile);
  } catch {
    /* stockage indisponible : le profil standard servira */
  }
}

/** Du son brut au fichier envoyé : mono, 16 kHz, volume remonté. Pure, donc testée sans micro. */
export function prepareForUpload(channels: Float32Array[], sampleRate: number): { wav: ArrayBuffer; stats: AudioStats } {
  const mono = resample(mixToMono(channels), sampleRate, TARGET_SAMPLE_RATE);
  const { samples, stats } = normalizeLevel(mono);
  return { wav: encodeWav(samples, TARGET_SAMPLE_RATE), stats: { ...stats, durationSeconds: samples.length / TARGET_SAMPLE_RATE } };
}

/**
 * On enregistre le son BRUT du micro (échantillons PCM), pas un fichier compressé : pas de compression ni de décodage
 * intermédiaire qui abîment la voix. Le contrôle automatique du gain remonte les voix basses ; l'annulation d'écho évite
 * que le micro réentende la voix de l'assistant.
 */
export async function startRecording(profile: MicProfile = savedMicProfile(), base: SilenceOptions = DEFAULT_SILENCE): Promise<Recording> {
  const options: SilenceOptions = { ...base, ...MIC_PROFILES[profile].silence };
  const stream = await navigator.mediaDevices.getUserMedia({ audio: MIC_PROFILES[profile].constraints });
  const AudioCtor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const context = new AudioCtor();
  if (context.state === "suspended") await context.resume().catch(() => undefined);
  const source = context.createMediaStreamSource(stream);

  const analyser = context.createAnalyser();
  analyser.fftSize = 1024;
  source.connect(analyser);

  const chunks: Float32Array[] = [];
  const processor = context.createScriptProcessor(4096, 1, 1);
  processor.onaudioprocess = (e) => {
    chunks.push(new Float32Array(e.inputBuffer.getChannelData(0)));
  };
  source.connect(processor);
  processor.connect(context.destination); // sortie muette : le processeur n'écrit rien, mais doit être relié pour tourner

  const detector = createSilenceDetector(options);
  const level = new Float32Array(analyser.fftSize);
  let finished = false;
  let settle: (value: RecordingResult | undefined) => void = () => undefined;
  const result = new Promise<RecordingResult | undefined>((resolve) => {
    settle = resolve;
  });

  const finish = (why: StopReason | "manual") => {
    if (finished) return;
    finished = true;
    clearInterval(timer);
    processor.onaudioprocess = null;
    try {
      source.disconnect();
      processor.disconnect();
    } catch {
      /* déjà déconnecté */
    }
    stream.getTracks().forEach((t) => t.stop());
    const sampleRate = context.sampleRate;
    void context.close();

    if (why === "no_speech" || chunks.length === 0) return settle(undefined);
    const all = new Float32Array(chunks.reduce((n, c) => n + c.length, 0));
    let offset = 0;
    for (const c of chunks) {
      all.set(c, offset);
      offset += c.length;
    }
    settle({ ...prepareForUpload([all], sampleRate), reason: why });
  };

  const timer = setInterval(() => {
    analyser.getFloatTimeDomainData(level);
    const decision = detector.push(rmsOf(level), performance.now());
    if (decision.stop) finish(decision.reason);
  }, 100);

  return { stop: () => finish("manual"), result };
}
