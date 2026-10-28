import test from "node:test";
import assert from "node:assert/strict";
import {
  createSilenceDetector, DEFAULT_SILENCE, encodeWav, MAX_RECORDING_MS, mixToMono, resample, rmsOf, type SilenceDecision,
} from "../src/app/marchand/audio";

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
