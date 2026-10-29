import test from "node:test";
import assert from "node:assert/strict";
import {
  CLIPPING_LIMIT, createSilenceDetector, DEFAULT_SILENCE, encodeWav, MAX_GAIN, MAX_RECORDING_MS, mixToMono, normalizeLevel, prepareForUpload,
  resample, rmsOf, type SilenceDecision,
} from "../src/app/marchand/audio";
import { describeRecording, isDebugMode } from "../src/app/marchand/view";

const text = (view: DataView, offset: number, length: number) =>
  Array.from({ length }, (_v, i) => String.fromCharCode(view.getUint8(offset + i))).join("");

// --- WAV ----------------------------------------------------------------------

test("encodeWav : en-tête RIFF/WAVE PCM 16 bits mono, tailles cohérentes", () => {
  const buffer = encodeWav(new Float32Array([0, 0.5, -0.5, 1]), 16_000);
  const view = new DataView(buffer);
  assert.equal(buffer.byteLength, 44 + 4 * 2);
  assert.equal(text(view, 0, 4), "RIFF");
  assert.equal(view.getUint32(4, true), 36 + 8, "taille du fichier moins 8");
  assert.equal(text(view, 8, 4), "WAVE");
  assert.equal(text(view, 12, 4), "fmt ");
  assert.equal(view.getUint32(16, true), 16);
  assert.equal(view.getUint16(20, true), 1, "PCM");
  assert.equal(view.getUint16(22, true), 1, "mono");
  assert.equal(view.getUint32(24, true), 16_000);
  assert.equal(view.getUint32(28, true), 32_000, "octets par seconde");
  assert.equal(view.getUint16(32, true), 2);
  assert.equal(view.getUint16(34, true), 16);
  assert.equal(text(view, 36, 4), "data");
  assert.equal(view.getUint32(40, true), 8);
});

test("encodeWav : valeurs converties en entiers 16 bits et écrêtées", () => {
  const view = new DataView(encodeWav(new Float32Array([0, 0.5, -0.5, 1, -1, 3, -3]), 16_000));
  const sample = (i: number) => view.getInt16(44 + i * 2, true);
  assert.equal(sample(0), 0);
  assert.equal(sample(1), 16383);
  assert.equal(sample(2), -16384);
  assert.equal(sample(3), 32767);
  assert.equal(sample(4), -32768);
  assert.equal(sample(5), 32767, "au-delà de 1 : écrêté");
  assert.equal(sample(6), -32768, "en dessous de -1 : écrêté");
});

test("encodeWav : un enregistrement vide donne un fichier valide sans données", () => {
  const view = new DataView(encodeWav(new Float32Array(0), 16_000));
  assert.equal(view.byteLength, 44);
  assert.equal(view.getUint32(40, true), 0);
});

// --- Mono et rééchantillonnage -----------------------------------------------------

test("mixToMono : moyenne des canaux", () => {
  const out = mixToMono([new Float32Array([1, 0, -1]), new Float32Array([0, 1, -1])]);
  assert.deepEqual(Array.from(out), [0.5, 0.5, -1]);
  const single = new Float32Array([0.1, 0.2]);
  assert.equal(mixToMono([single]), single);
  assert.equal(mixToMono([]).length, 0);
});

test("resample : 48 kHz vers 16 kHz divise la longueur par trois et garde le niveau", () => {
  const out = resample(new Float32Array(4800).fill(0.4), 48_000, 16_000);
  assert.equal(out.length, 1600);
  assert.ok(out.every((v) => Math.abs(v - 0.4) < 1e-6));
});

test("resample : 44,1 kHz vers 16 kHz garde la durée", () => {
  const out = resample(new Float32Array(44_100).fill(0.2), 44_100, 16_000);
  assert.ok(Math.abs(out.length - 16_000) <= 1, `longueur ${out.length}`);
});

test("resample : fait la moyenne d'une fenêtre (un pic isolé est lissé)", () => {
  const out = resample(new Float32Array([0, 0, 0.9, 0, 0, 0]), 48_000, 16_000);
  assert.equal(out.length, 2);
  assert.ok(Math.abs(out[0] - 0.3) < 1e-6);
  assert.equal(out[1], 0);
});

test("resample : 8 kHz vers 16 kHz interpole", () => {
  const out = resample(new Float32Array([0, 1, 0, 1]), 8_000, 16_000);
  assert.equal(out.length, 8);
  assert.deepEqual(Array.from(out.slice(0, 3)), [0, 0.5, 1]);
});

test("resample : même fréquence, ou entrée vide : rien ne change", () => {
  const input = new Float32Array([0.1, 0.2]);
  assert.equal(resample(input, 16_000, 16_000), input);
  assert.equal(resample(new Float32Array(0), 48_000, 16_000).length, 0);
});

test("rmsOf : niveau efficace", () => {
  assert.equal(rmsOf(new Float32Array(0)), 0);
  assert.ok(Math.abs(rmsOf(new Float32Array(100).fill(0.5)) - 0.5) < 1e-9);
  assert.ok(Math.abs(rmsOf(new Float32Array([0.5, -0.5, 0.5, -0.5])) - 0.5) < 1e-9, "le signe ne compte pas");
  assert.equal(rmsOf(new Float32Array(10)), 0);
});

// --- Volume ---------------------------------------------------------------------------------

const tone = (amp: number, n = 16_000) => Float32Array.from({ length: n }, (_v, i) => amp * Math.sin((2 * Math.PI * 220 * i) / 16_000));
const peakOf = (x: Float32Array) => x.reduce((m, v) => Math.max(m, Math.abs(v)), 0);

test("normalizeLevel : une voix basse est remontée vers une crête de 0,8", () => {
  const { samples, stats } = normalizeLevel(tone(0.05));
  assert.ok(Math.abs(peakOf(samples) - 0.8) < 0.02, `crête ${peakOf(samples)}`);
  assert.ok(Math.abs(stats.gain - 16) < 0.6, `gain ${stats.gain}`);
  assert.ok(Math.abs(stats.peak - 0.05) < 1e-3, "la crête d'origine est mesurée avant normalisation");
  assert.ok(stats.rms > 0.03 && stats.rms < 0.04);
});

test("normalizeLevel : on ne baisse jamais un son fort, et un son déjà correct ne change pas", () => {
  const loud = tone(0.95);
  const a = normalizeLevel(loud);
  assert.equal(a.stats.gain, 1);
  assert.equal(a.samples, loud, "même tableau : rien n'est copié ni modifié");
  const fine = tone(0.8);
  assert.equal(normalizeLevel(fine).stats.gain, 1);
});

test("normalizeLevel : le silence ou le bruit seul n'est pas amplifié", () => {
  const hiss = tone(0.002);
  const r = normalizeLevel(hiss);
  assert.equal(r.stats.gain, 1);
  assert.equal(r.samples, hiss);
  const empty = normalizeLevel(new Float32Array(0));
  assert.deepEqual(empty.stats, { peak: 0, rms: 0, gain: 1, clipped: 0 });
});

test("normalizeLevel : l'amplification est plafonnée à ×40", () => {
  const { stats, samples } = normalizeLevel(tone(0.006));
  assert.equal(stats.gain, MAX_GAIN);
  assert.ok(peakOf(samples) < 0.3, "pas de gonflement démesuré");
});

test("normalizeLevel : un claquement isolé ne décide pas du volume de la phrase", () => {
  const voice = tone(0.05, 32_000);
  voice[100] = 0.9; // un clic
  const { stats } = normalizeLevel(voice);
  assert.ok(stats.gain > 10, `gain ${stats.gain} : la voix est remontée malgré le clic`);
});

test("normalizeLevel : écrête à 1 au lieu de déborder", () => {
  const voice = tone(0.05, 32_000);
  voice[100] = 0.9;
  const { samples } = normalizeLevel(voice);
  assert.ok(peakOf(samples) <= 1);
});

test("prepareForUpload : mono, 16 kHz, volume remonté, WAV valide", () => {
  const left = tone(0.05, 48_000);
  const right = tone(0.05, 48_000);
  const { wav, stats } = prepareForUpload([left, right], 48_000);
  const view = new DataView(wav);
  assert.equal(text(view, 0, 4), "RIFF");
  assert.equal(view.getUint32(24, true), 16_000);
  assert.equal(view.getUint16(22, true), 1);
  assert.equal((wav.byteLength - 44) / 2, 16_000, "1 s à 48 kHz devient 16 000 échantillons");
  assert.ok(Math.abs(stats.durationSeconds - 1) < 0.01);
  assert.ok(stats.gain > 10);
  const first = view.getInt16(44 + 2 * 36, true);
  assert.ok(Math.abs(first) > 0, "le son n'est pas muet");
});

test("saturation : la part d'échantillons collés au maximum est mesurée, et un son saturé n'est pas amplifié", () => {
  const square = Float32Array.from({ length: 1000 }, (_v, i) => (i % 2 ? 1 : -1)); // tout le temps au maximum
  const r = normalizeLevel(square);
  assert.equal(r.stats.clipped, 1);
  assert.equal(r.stats.gain, 1, "déjà au plafond : jamais amplifié");
  assert.equal(normalizeLevel(tone(0.05)).stats.clipped, 0);
  const few = tone(0.5, 10_000);
  few[0] = 1;
  few[1] = -1; // 2 échantillons sur 10 000
  assert.ok(Math.abs(normalizeLevel(few).stats.clipped - 0.0002) < 1e-9);
});

test("saturation : le diagnostic l'annonce avant tout le reste", () => {
  const saturated = describeRecording({ durationSeconds: 2, peak: 1, gain: 1, clipped: 0.05 });
  assert.match(saturated, /SATURÉ/);
  assert.match(saturated, /baisse le volume du micro/);
  assert.doesNotMatch(saturated, /volume correct/, "un son saturé n'est pas « correct »");
  assert.match(describeRecording({ durationSeconds: 2, peak: 1, gain: 1, clipped: 0 }), /volume correct/);
  assert.match(describeRecording({ durationSeconds: 2, peak: 1, gain: 1, clipped: CLIPPING_LIMIT }), /volume correct/, "à la limite exacte : pas encore saturé");
  assert.match(describeRecording({ durationSeconds: 2, peak: 1, gain: 1, clipped: CLIPPING_LIMIT + 0.001 }), /SATURÉ/);
  assert.match(describeRecording({ durationSeconds: 2, peak: 0.5, gain: 1 }), /volume correct/, "sans mesure : comme avant");
});

test("mode debug : détection de ?debug=1 et description de l'enregistrement", () => {
  assert.equal(isDebugMode("?debug=1"), true);
  assert.equal(isDebugMode("?test=1&debug=1"), true);
  assert.equal(isDebugMode("?debug=0"), false);
  assert.equal(isDebugMode(""), false);
  assert.match(describeRecording({ durationSeconds: 3.24, peak: 0.0012, gain: 1 }), /quasi silencieux/);
  assert.match(describeRecording({ durationSeconds: 3.24, peak: 0.03, gain: 26 }), /voix très basse/);
  assert.match(describeRecording({ durationSeconds: 2, peak: 0.1, gain: 8 }), /voix basse \(remontée automatiquement\)/);
  assert.match(describeRecording({ durationSeconds: 2, peak: 0.6, gain: 1.3 }), /volume correct/);
  assert.match(describeRecording({ durationSeconds: 3.24, peak: 0.5, gain: 1.6 }), /^3,24 s · crête 0,5 · amplifié ×1,6/);
});

// --- Détection du silence ---------------------------------------------------------------

/** Joue des séquences [niveau, durée] avec un échantillon toutes les 100 ms ; renvoie la première décision d'arrêt. */
function play(steps: Array<[number, number]>, options = DEFAULT_SILENCE) {
  const detector = createSilenceDetector(options);
  let now = 5_000;
  const start = now;
  for (const [rms, ms] of steps) {
    for (let t = 0; t < ms; t += 100) {
      const decision: SilenceDecision = detector.push(rms, now);
      if (decision.stop) return { reason: decision.reason, at: now - start, detector };
      now += 100;
    }
  }
  return { reason: undefined, at: now - start, detector };
}

test("silence : pièce calme, la vendeuse parle puis se tait : arrêt après 1,2 s de silence", () => {
  const r = play([[0.002, 300], [0.1, 1000], [0.002, 3000]]);
  assert.equal(r.reason, "silence");
  assert.ok(r.at >= 2400 && r.at <= 2600, `arrêt à ${r.at} ms`);
});

test("silence : un silence court au milieu d'une phrase ne coupe pas", () => {
  const r = play([[0.002, 300], [0.1, 600], [0.002, 800], [0.1, 600], [0.002, 3000]]);
  assert.equal(r.reason, "silence");
  assert.ok(r.at > 2800, `arrêt trop tôt : ${r.at} ms`);
});

test("silence : marché bruyant, le seuil monte, le bruit seul ne déclenche pas la parole", () => {
  const noise = 0.03; // au-dessus du seuil de pièce calme (0,02)
  const r = play([[noise, 1800], [0.12, 1000], [noise, 3000]]);
  assert.equal(r.reason, "silence", "la parole (0,12) est entendue, puis le bruit seul compte comme silence");
  assert.ok(r.detector.threshold() > 0.02, "seuil relevé");
  assert.ok(r.detector.threshold() <= 0.06, "mais plafonné");
});

test("silence : bruit très fort, le seuil ne dépasse jamais le plafond", () => {
  const r = play([[0.5, 600]]);
  assert.equal(r.detector.threshold(), 0.06);
});

test("silence : personne ne parle : arrêt « no_speech » après 5 s", () => {
  const r = play([[0.002, 20_000]]);
  assert.equal(r.reason, "no_speech");
  assert.ok(r.at >= 5000 && r.at <= 5200, `arrêt à ${r.at} ms`);
});

test("silence : un claquement isolé n'est pas de la parole", () => {
  const r = play([[0.002, 300], [0.2, 100], [0.002, 20_000]]);
  assert.equal(r.reason, "no_speech");
  assert.ok(r.at > 5000, "pas d'arrêt rapide sur silence");
});

test("silence : parole continue : arrêt « max » à 12 s", () => {
  const r = play([[0.002, 300], [0.1, 20_000]]);
  assert.equal(r.reason, "max");
  assert.equal(MAX_RECORDING_MS, 12_000);
  assert.ok(r.at >= 12_000 && r.at <= 12_100, `arrêt à ${r.at} ms`);
});

test("silence : pendant la calibration, aucun arrêt, même en cas de grand bruit", () => {
  const r = play([[0.5, 300]]);
  assert.equal(r.reason, undefined);
});
