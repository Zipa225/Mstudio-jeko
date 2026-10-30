import test, { afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import { GET as health } from "../src/app/api/health/route";
import { POST as paid } from "../src/app/api/paid/route";
import { POST as tts } from "../src/app/api/tts/route";
import { POST as turn } from "../src/app/api/turn/route";
import { micErrorMessage, voiceModeFrom } from "../src/app/marchand/view";
import { AethexError, MAX_AUDIO_BYTES, MAX_TTS_CHARS } from "../src/lib/aethex";
import type { VoiceService } from "../src/lib/ports";
import { createRuntime, replaceRuntime, type RuntimeOptions } from "../src/lib/runtime";
import { normalize, phraseKeywords } from "../src/lib/text";

// Phrase de TEST, neutre : jamais la vraie phrase de la démonstration.
const PHRASE = "le manioc cuit doucement";
const LEAK_KEYS = phraseKeywords(PHRASE).filter((k) => k.length >= 6);
const leaks = (s: string) => LEAK_KEYS.some((k) => normalize(s).includes(k));
const NOON = new Date(Date.UTC(2026, 9, 27, 12, 0, 0));
const URL = "http://localhost/api/x";
const WAV = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45, 1, 2, 3, 4]);

interface StubVoice extends VoiceService {
  heard: Array<{ bytes: number; mime: string }>;
  spoken: string[];
}

function stubVoice(transcript: string | Error = "bonjour"): StubVoice {
  const stub: StubVoice = {
    heard: [],
    spoken: [],
    async transcribe(audio, mime) {
      stub.heard.push({ bytes: audio.byteLength, mime });
      if (transcript instanceof Error) throw transcript;
      return transcript;
    },
    async synthesize(text) {
      stub.spoken.push(text);
      return { audio: WAV.buffer.slice(0) as ArrayBuffer, contentType: "audio/wav" };
    },
  };
  return stub;
}

function fresh(options: RuntimeOptions = {}) {
  return replaceRuntime(createRuntime({ clock: () => NOON, secret: "secret-de-test", getPhrase: () => PHRASE, demoMode: true, ...options }));
}

async function read(res: Response) {
  const raw = await res.text();
  let body: any;
  try {
    body = JSON.parse(raw);
  } catch {
    body = undefined;
  }
  return { status: res.status, raw, body, headers: res.headers };
}

const postJson = (handler: (req: Request) => Promise<Response>, payload: unknown) =>
  handler(new Request(URL, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) }));

const say = async (text: string, sessionId = "awa") => read(await postJson(turn, { sessionId, text }));

function audioForm(fields: { sessionId?: string; audio?: Blob | string } = {}) {
  const form = new FormData();
  if (fields.sessionId !== undefined) form.set("sessionId", fields.sessionId);
  const audio = "audio" in fields ? fields.audio : new Blob([new Uint8Array(200)], { type: "audio/wav" });
  if (typeof audio === "string") form.set("audio", audio);
  else if (audio !== undefined) form.set("audio", audio, "voix.wav");
  return form;
}
const postAudio = async (form: FormData) => read(await turn(new Request(URL, { method: "POST", body: form })));

afterEach(() => mock.restoreAll());

// --- /api/turn en audio ---------------------------------------------------------------

test("turn audio : l'enregistrement est transcrit puis traité comme du texte", async () => {
  const voice = stubVoice("Encaisse cinq mille francs par Wave");
  fresh({ voice });
  const r = await postAudio(audioForm({ sessionId: "awa" }));
  assert.equal(r.status, 200);
  assert.equal(r.body.heard, "Encaisse cinq mille francs par Wave");
  assert.equal(r.body.reply, "Tu veux encaisser 5 000 francs par Wave. Tu confirmes ?");
  assert.equal(r.body.awaitingConfirm, true);
  assert.equal(r.headers.get("cache-control"), "no-store");
  assert.deepEqual(voice.heard, [{ bytes: 200, mime: "audio/wav" }]);
});

test("turn audio : le dialogue continue sur la même session, voix puis texte", async () => {
  fresh({ voice: stubVoice("Encaisse cinq mille francs par Wave") });
  await postAudio(audioForm({ sessionId: "awa" }));
  const ok = await say("oui");
  assert.equal(ok.body.reply, "C'est lancé. Le client peut scanner et payer.");
});

test("turn audio : aucune opération d'argent sans confirmation, même par la voix", async () => {
  fresh({ voice: stubVoice("Encaisse cinq mille francs par Wave") });
  const first = await postAudio(audioForm({ sessionId: "awa" }));
  assert.equal(first.body.payment, undefined, "pas de paiement tant que la vendeuse n'a pas dit oui");
});

test("turn audio : la phrase de contrainte dite au micro n'est jamais renvoyée à l'écran", async () => {
  const logged: string[] = [];
  for (const m of ["log", "info", "warn", "error", "debug"] as const) {
    mock.method(console, m, (...args: unknown[]) => { logged.push(args.map(String).join(" ")); });
  }
  fresh({ voice: stubVoice(`oui, c'est bon, ${PHRASE}`) });
  await say("Envoie cent cinquante mille francs à Koné", "forcee");
  const r = await postAudio(audioForm({ sessionId: "forcee" }));
  assert.equal(r.status, 200);
  assert.equal(r.body.heard, "Oui");
  assert.equal(leaks(r.raw), false);
  assert.equal(leaks(logged.join("\n")), false);
});

test("turn audio : un échec de transcription donne un message générique, sans détail", async () => {
  fresh({ voice: stubVoice(new AethexError("http", "AethexAI a répondu avec le code 401 clé=ae_secrete", 401)) });
  const r = await postAudio(audioForm({ sessionId: "awa" }));
  assert.equal(r.status, 502);
  assert.equal(r.body.error, "stt_failed");
  assert.match(r.body.message, /pas pu comprendre/);
  assert.ok(!r.raw.includes("ae_secrete"));
  assert.ok(!r.raw.includes("401"));
});

test("turn audio : sans voix serveur, 501 (la page se rabat sur la voix du navigateur)", async () => {
  fresh({ voice: null });
  const r = await postAudio(audioForm({ sessionId: "awa" }));
  assert.equal(r.status, 501);
  assert.equal(r.body.error, "voice_not_available");
});

test("turn audio : entrées invalides", async () => {
  const voice = stubVoice();
  fresh({ voice });
  const cases: Array<[FormData, number, string]> = [
    [audioForm({}), 400, "invalid_session"],
    [audioForm({ sessionId: "a b" }), 400, "invalid_session"],
    [audioForm({ sessionId: "awa", audio: undefined }), 400, "no_audio"],
    [audioForm({ sessionId: "awa", audio: "du texte" }), 400, "no_audio"],
    [audioForm({ sessionId: "awa", audio: new Blob(["x"], { type: "audio/webm" }) }), 415, "unsupported_media_type"],
    [audioForm({ sessionId: "awa", audio: new Blob([new Uint8Array(MAX_AUDIO_BYTES + 1)], { type: "audio/wav" }) }), 413, "too_large"],
  ];
  for (const [form, status, error] of cases) {
    const r = await postAudio(form);
    assert.deepEqual([r.status, r.body?.error], [status, error]);
  }
  assert.equal(voice.heard.length, 0, "AethexAI n'est jamais appelé pour une entrée invalide");
});

test("turn audio : déclaration de taille excessive refusée avant lecture", async () => {
  fresh({ voice: stubVoice() });
  const res = await turn(new Request(URL, {
    method: "POST",
    headers: { "content-type": "multipart/form-data; boundary=x", "content-length": String(MAX_AUDIO_BYTES + 200_000) },
    body: "--x--",
  }));
  assert.equal(res.status, 413);
});

test("turn audio : corps multipart illisible", async () => {
  fresh({ voice: stubVoice() });
  const res = await turn(new Request(URL, {
    method: "POST",
    headers: { "content-type": "multipart/form-data; boundary=x" },
    body: "ceci n'est pas du multipart",
  }));
  assert.equal(res.status, 400);
});

test("turn audio : le texte transcrit est borné à 500 caractères", async () => {
  fresh({ voice: stubVoice("bonjour ".repeat(200)) });
  const r = await postAudio(audioForm({ sessionId: "awa" }));
  assert.equal(r.status, 200);
  assert.ok(r.body.heard.length <= 520);
});

// --- /api/tts ------------------------------------------------------------------------------

test("tts : ne prononce que les phrases produites par le serveur", async () => {
  const voice = stubVoice();
  fresh({ voice });
  const turnResult = await say("Encaisse cinq mille francs par Wave");

  const ok = await postJson(tts, { text: turnResult.body.speech });
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get("content-type"), "audio/wav");
  assert.equal(ok.headers.get("cache-control"), "no-store");
  assert.deepEqual(Array.from(new Uint8Array(await ok.arrayBuffer())), Array.from(WAV));
  assert.deepEqual(voice.spoken, [turnResult.body.speech]);

  const intruder = await read(await postJson(tts, { text: "Phrase inventée par quelqu'un d'autre" }));
  assert.deepEqual([intruder.status, intruder.body.error], [403, "not_allowed"]);
  assert.equal(voice.spoken.length, 1, "aucun crédit consommé pour un texte non autorisé");
});

test("tts : l'annonce de paiement reçu est autorisée", async () => {
  const voice = stubVoice();
  fresh({ voice });
  await say("Encaisse cinq mille francs par Wave");
  const launched = await say("oui");
  const done = await read(await postJson(paid, { paymentId: launched.body.payment.id }));
  assert.equal(done.status, 200);
  const spoken = await postJson(tts, { text: done.body.speech });
  assert.equal(spoken.status, 200);
});

test("tts : validation des entrées", async () => {
  const voice = stubVoice();
  fresh({ voice });
  for (const [payload, error] of [
    [{}, "invalid_text"], [{ text: 5 }, "invalid_text"], [{ text: "" }, "invalid_text"], [{ text: "   " }, "invalid_text"],
    [{ text: "x".repeat(MAX_TTS_CHARS + 1) }, "invalid_text"],
  ] as const) {
    const r = await read(await postJson(tts, payload));
    assert.deepEqual([r.status, r.body.error], [400, error], JSON.stringify(payload).slice(0, 40));
  }
  const wrong = await tts(new Request(URL, { method: "POST", headers: { "content-type": "text/plain" }, body: "x" }));
  assert.equal(wrong.status, 415);
  assert.equal(voice.spoken.length, 0);
});

test("tts : sans voix serveur, 501", async () => {
  fresh({ voice: null });
  const r = await read(await postJson(tts, { text: "bonjour" }));
  assert.deepEqual([r.status, r.body.error], [501, "voice_not_available"]);
});

test("tts : échec d'AethexAI : 502 générique", async () => {
  const voice = stubVoice();
  voice.synthesize = async () => {
    throw new AethexError("http", "code 402 clé=ae_secrete", 402);
  };
  fresh({ voice });
  const speech = (await say("Encaisse cinq mille francs par Wave")).body.speech;
  const r = await read(await postJson(tts, { text: speech }));
  assert.deepEqual([r.status, r.body.error], [502, "tts_failed"]);
  assert.ok(!r.raw.includes("ae_secrete"));
});

test("tts : la liste des phrases autorisées est bornée", async () => {
  const rt = fresh({ voice: stubVoice() });
  for (let i = 0; i < 300; i++) rt.allowSpeech(`phrase numéro ${i}`);
  assert.equal(rt.isAllowedSpeech("phrase numéro 299"), true);
  assert.equal(rt.isAllowedSpeech("phrase numéro 0"), false, "les plus anciennes sont oubliées");
});

// --- Aides de l'écran -----------------------------------------------------------------------------

test("écran : source de la voix et message d'erreur du micro", () => {
  assert.equal(voiceModeFrom({ voice: "aethex" }), "aethex");
  assert.equal(voiceModeFrom({ voice: "browser" }), "browser");
  assert.equal(voiceModeFrom({}), "browser");
  assert.equal(voiceModeFrom(undefined), "browser");

  assert.match(micErrorMessage("NotAllowedError", true), /Autorise le micro/);
  assert.match(micErrorMessage("NotFoundError", true), /Aucun micro/);
  assert.match(micErrorMessage("NotReadableError", true), /autre application/);
  assert.match(micErrorMessage("AutreErreur", true), /pas disponible/);
  assert.match(micErrorMessage("NotAllowedError", false), /HTTPS/, "hors connexion sécurisée, on explique HTTPS en premier");
});

// --- /api/health ------------------------------------------------------------------------------

test("health : voice vaut « aethex » avec une voix serveur, « browser » sinon", async () => {
  fresh({ voice: stubVoice() });
  assert.equal((await read(await health())).body.voice, "aethex");
  fresh({ voice: null });
  assert.equal((await read(await health())).body.voice, "browser");
});
