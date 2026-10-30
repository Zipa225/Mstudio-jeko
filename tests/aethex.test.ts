import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import {
  AethexError, audioExtension, createAethexVoice, describeAethexFailure, MAX_AUDIO_BYTES, MAX_TTS_CHARS, truncateForTts,
} from "../src/lib/aethex";

// Fausse clé de TEST : jamais une vraie clé.
const KEY = "ae_test_cle_factice_0123456789";

/** Un octet de WAV minimal valide : « RIFF....WAVE » + de quoi dépasser 12 octets. */
const WAV = (() => {
  const bytes = new Uint8Array(48);
  bytes.set([0x52, 0x49, 0x46, 0x46], 0);
  bytes.set([0x57, 0x41, 0x56, 0x45], 8);
  return bytes;
})();

interface Recorded {
  method: string;
  url: string;
  headers: IncomingMessage["headers"];
  body: Buffer;
}

type Handler = (req: Recorded, res: ServerResponse) => void;

const servers: Server[] = [];

async function fake(handler: Handler) {
  const requests: Recorded[] = [];
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const recorded: Recorded = { method: req.method ?? "", url: req.url ?? "", headers: req.headers, body: Buffer.concat(chunks) };
      requests.push(recorded);
      handler(recorded, res);
    });
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, requests };
}

afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

const sendJson = (res: ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(typeof body === "string" ? body : JSON.stringify(body));
};
const sendWav = (res: ServerResponse) => {
  res.writeHead(200, { "content-type": "audio/wav" });
  res.end(Buffer.from(WAV));
};

const audio = (n = 100) => new Uint8Array(n).buffer;

// --- Format audio -------------------------------------------------------------------

test("audioExtension : WAV, FLAC et Ogg/Opus acceptés, le reste refusé", () => {
  assert.equal(audioExtension("audio/wav"), "wav");
  assert.equal(audioExtension("audio/x-wav"), "wav");
  assert.equal(audioExtension("AUDIO/WAV; codecs=1"), "wav");
  assert.equal(audioExtension("audio/flac"), "flac");
  assert.equal(audioExtension("audio/ogg;codecs=opus"), "ogg");
  assert.equal(audioExtension("audio/webm"), undefined, "WebM n'est pas accepté par AethexAI");
  assert.equal(audioExtension("audio/mpeg"), undefined);
  assert.equal(audioExtension("text/plain"), undefined);
  assert.equal(audioExtension(""), undefined);
});

// --- Voix vers texte ----------------------------------------------------------------

test("transcribe : POST /transcribe, clé en en-tête, fichier + langue française, texte nettoyé", async () => {
  const { url, requests } = await fake((_req, res) => sendJson(res, 200, { status: "completed", text: "  Encaisse cinq mille francs  " }));
  const voice = createAethexVoice({ baseUrl: url, apiKey: KEY });
  const text = await voice.transcribe(audio(300), "audio/wav");
  assert.equal(text, "Encaisse cinq mille francs");

  assert.equal(requests.length, 1);
  const [req] = requests;
  assert.equal(req.method, "POST");
  assert.equal(req.url, "/transcribe");
  assert.equal(req.headers["x-api-key"], KEY);
  assert.match(String(req.headers["content-type"]), /^multipart\/form-data; boundary=/);

  const form = await new Response(new Uint8Array(req.body), { headers: { "content-type": String(req.headers["content-type"]) } }).formData();
  assert.equal(form.get("language"), "french");
  const file = form.get("file") as File;
  assert.equal(file.name, "voix.wav");
  assert.equal(file.type, "audio/wav");
  assert.equal(file.size, 300);
});

test("transcribe : l'adresse peut avoir un chemin et une barre finale", async () => {
  const { url, requests } = await fake((_req, res) => sendJson(res, 200, { text: "bonjour" }));
  const voice = createAethexVoice({ baseUrl: `${url}/v1/`, apiKey: KEY });
  assert.equal(await voice.transcribe(audio(), "audio/flac"), "bonjour");
  assert.equal(requests[0].url, "/v1/transcribe");
});

test("transcribe : un texte vide est une réponse valide (personne n'a parlé)", async () => {
  const { url } = await fake((_req, res) => sendJson(res, 200, { status: "completed", text: "" }));
  assert.equal(await createAethexVoice({ baseUrl: url, apiKey: KEY }).transcribe(audio(), "audio/wav"), "");
});

test("transcribe : les erreurs d'AethexAI deviennent des erreurs typées, sans la clé", async () => {
  for (const status of [400, 401, 402, 403, 413, 422, 429, 500, 503]) {
    const { url } = await fake((_req, res) => sendJson(res, status, { detail: `refus ${KEY}` }));
    const voice = createAethexVoice({ baseUrl: url, apiKey: KEY });
    const error = await voice.transcribe(audio(), "audio/wav").then(() => undefined, (e: unknown) => e);
    assert.ok(error instanceof AethexError, `statut ${status}`);
    assert.equal(error.kind, "http");
    assert.equal(error.status, status);
    assert.ok(!error.message.includes(KEY), "la clé n'apparaît pas dans le message");
    assert.ok(!describeAethexFailure(error).includes(KEY));
  }
});

test("transcribe : réponse illisible (JSON cassé, texte absent, statut échoué)", async () => {
  for (const body of ["pas du json", "null", "{}", JSON.stringify({ text: 12 }), JSON.stringify({ status: "failed", text: "x" })]) {
    const { url } = await fake((_req, res) => sendJson(res, 200, body));
    const error = await createAethexVoice({ baseUrl: url, apiKey: KEY }).transcribe(audio(), "audio/wav").then(() => undefined, (e: unknown) => e);
    assert.ok(error instanceof AethexError, body);
    assert.equal(error.kind, "invalid", body);
  }
});

test("transcribe : audio refusé avant tout envoi (format, vide, trop gros)", async () => {
  const { url, requests } = await fake((_req, res) => sendJson(res, 200, { text: "x" }));
  const voice = createAethexVoice({ baseUrl: url, apiKey: KEY });
  const cases: Array<[ArrayBuffer, string]> = [
    [audio(), "audio/webm"],
    [audio(), "text/plain"],
    [new ArrayBuffer(0), "audio/wav"],
    [new ArrayBuffer(MAX_AUDIO_BYTES + 1), "audio/wav"],
  ];
  for (const [data, mime] of cases) {
    const error = await voice.transcribe(data, mime).then(() => undefined, (e: unknown) => e);
    assert.ok(error instanceof AethexError);
    assert.equal(error.kind, "rejected");
  }
  assert.equal(requests.length, 0, "rien n'est parti vers AethexAI");
});

test("transcribe : délai dépassé", async () => {
  const { url } = await fake(() => undefined); // ne répond jamais
  const voice = createAethexVoice({ baseUrl: url, apiKey: KEY, timeoutMs: 150 });
  const error = await voice.transcribe(audio(), "audio/wav").then(() => undefined, (e: unknown) => e);
  assert.ok(error instanceof AethexError);
  assert.equal(error.kind, "timeout");
  assert.equal(describeAethexFailure(error), "AethexAI n'a pas répondu à temps");
});

test("transcribe : serveur injoignable", async () => {
  const { url } = await fake((_req, res) => sendJson(res, 200, {}));
  const closed = url;
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  const error = await createAethexVoice({ baseUrl: closed, apiKey: KEY }).transcribe(audio(), "audio/wav").then(() => undefined, (e: unknown) => e);
  assert.ok(error instanceof AethexError);
  assert.equal(error.kind, "network");
  assert.ok(!error.message.includes(KEY));
});

// --- Texte vers voix ------------------------------------------------------------------

test("synthesize : POST /tts en JSON, voix demandée, WAV renvoyé", async () => {
  const { url, requests } = await fake((_req, res) => sendWav(res));
  const voice = createAethexVoice({ baseUrl: url, apiKey: KEY, voiceId: "voix-test" });
  const out = await voice.synthesize("  Tu confirmes ?  ");
  assert.equal(out.contentType, "audio/wav");
  assert.deepEqual(Array.from(new Uint8Array(out.audio)), Array.from(WAV));

  const [req] = requests;
  assert.equal(req.method, "POST");
  assert.equal(req.url, "/tts");
  assert.equal(req.headers["x-api-key"], KEY);
  assert.match(String(req.headers["content-type"]), /^application\/json/);
  assert.deepEqual(JSON.parse(req.body.toString()), { text: "Tu confirmes ?", language: "french", streaming: false, voice_id: "voix-test" });
});

test("synthesize : sans identifiant de voix, la voix par défaut d'AethexAI est utilisée", async () => {
  const { url, requests } = await fake((_req, res) => sendWav(res));
  await createAethexVoice({ baseUrl: url, apiKey: KEY }).synthesize("Bonjour");
  assert.equal("voice_id" in JSON.parse(requests[0].body.toString()), false);
});

test("synthesize : voix inconnue (404) : on réessaie sans voice_id, et on s'en souvient", async () => {
  const { url, requests } = await fake((req, res) => {
    const body = JSON.parse(req.body.toString());
    if (body.voice_id) sendJson(res, 404, { detail: "voice not found" });
    else sendWav(res);
  });
  const voice = createAethexVoice({ baseUrl: url, apiKey: KEY, voiceId: "voix-fantome" });
  await voice.synthesize("Premier message");
  assert.equal(requests.length, 2);
  assert.equal(JSON.parse(requests[0].body.toString()).voice_id, "voix-fantome");
  assert.equal("voice_id" in JSON.parse(requests[1].body.toString()), false);

  await voice.synthesize("Deuxième message");
  assert.equal(requests.length, 3, "une seule requête : la voix inconnue n'est plus redemandée");
  assert.equal("voice_id" in JSON.parse(requests[2].body.toString()), false);
});

test("synthesize : 404 sans voix demandée : erreur normale", async () => {
  const { url } = await fake((_req, res) => sendJson(res, 404, {}));
  const error = await createAethexVoice({ baseUrl: url, apiKey: KEY }).synthesize("x").then(() => undefined, (e: unknown) => e);
  assert.ok(error instanceof AethexError);
  assert.equal(error.status, 404);
});

test("synthesize : la même phrase n'est payée qu'une fois (cache)", async () => {
  const { url, requests } = await fake((_req, res) => sendWav(res));
  const voice = createAethexVoice({ baseUrl: url, apiKey: KEY });
  const a = await voice.synthesize("Tu confirmes ?");
  const b = await voice.synthesize("Tu confirmes ?");
  assert.equal(requests.length, 1);
  assert.deepEqual(Array.from(new Uint8Array(b.audio)), Array.from(new Uint8Array(a.audio)));
  assert.notEqual(a.audio, b.audio, "chaque appel reçoit sa propre copie");
  await voice.synthesize("Autre phrase");
  assert.equal(requests.length, 2);
});

test("synthesize : le cache ne garde que les 100 dernières phrases", async () => {
  const { url, requests } = await fake((_req, res) => sendWav(res));
  const voice = createAethexVoice({ baseUrl: url, apiKey: KEY });
  for (let i = 0; i < 101; i++) await voice.synthesize(`phrase ${i}`);
  assert.equal(requests.length, 101);
  await voice.synthesize("phrase 100");
  assert.equal(requests.length, 101, "la plus récente est en cache");
  await voice.synthesize("phrase 0");
  assert.equal(requests.length, 102, "la plus ancienne a été oubliée");
});

test("synthesize : un texte trop long est coupé à 650 caractères au plus", async () => {
  const { url, requests } = await fake((_req, res) => sendWav(res));
  const long = Array.from({ length: 80 }, (_v, i) => `Phrase numéro ${i}.`).join(" ");
  assert.ok(long.length > MAX_TTS_CHARS);
  await createAethexVoice({ baseUrl: url, apiKey: KEY }).synthesize(long);
  const sent: string = JSON.parse(requests[0].body.toString()).text;
  assert.ok(sent.length <= MAX_TTS_CHARS);
  assert.ok(sent.endsWith("."), "coupé à une fin de phrase");
});

test("synthesize : réponse qui n'est pas un WAV, texte vide, erreur HTTP", async () => {
  const notWav = await fake((_req, res) => {
    res.writeHead(200, { "content-type": "audio/wav" });
    res.end("<html>je ne suis pas un wav, pas du tout</html>");
  });
  const e1 = await createAethexVoice({ baseUrl: notWav.url, apiKey: KEY }).synthesize("x").then(() => undefined, (e: unknown) => e);
  assert.ok(e1 instanceof AethexError);
  assert.equal(e1.kind, "invalid");

  const empty = await fake((_req, res) => sendWav(res));
  const e2 = await createAethexVoice({ baseUrl: empty.url, apiKey: KEY }).synthesize("   ").then(() => undefined, (e: unknown) => e);
  assert.ok(e2 instanceof AethexError);
  assert.equal(e2.kind, "rejected");
  assert.equal(empty.requests.length, 0);

  const down = await fake((_req, res) => sendJson(res, 503, {}));
  const e3 = await createAethexVoice({ baseUrl: down.url, apiKey: KEY }).synthesize("x").then(() => undefined, (e: unknown) => e);
  assert.ok(e3 instanceof AethexError);
  assert.equal(e3.status, 503);
});

// --- Utilitaires -----------------------------------------------------------------------

test("truncateForTts : coupe proprement", () => {
  assert.equal(truncateForTts("court"), "court");
  const sentences = "Une phrase. ".repeat(100);
  const out = truncateForTts(sentences);
  assert.ok(out.length <= MAX_TTS_CHARS);
  assert.ok(out.endsWith("phrase."));

  const words = "mot ".repeat(400);
  const w = truncateForTts(words);
  assert.ok(w.length <= MAX_TTS_CHARS);
  assert.ok(w.endsWith("mot"), "coupé sur un espace");

  const solid = "a".repeat(1000);
  assert.equal(truncateForTts(solid).length, MAX_TTS_CHARS, "sans espace : coupe franche");
  assert.equal(truncateForTts("abcdefghij", 5), "abcde");
});

test("createAethexVoice : configuration invalide refusée", () => {
  assert.throws(() => createAethexVoice({ baseUrl: "pas une adresse", apiKey: KEY }), /invalide/);
  assert.throws(() => createAethexVoice({ baseUrl: "ftp://exemple.org", apiKey: KEY }), /invalide/);
  assert.throws(() => createAethexVoice({ baseUrl: "https://exemple.org", apiKey: "" }), /manquante/);
});

test("describeAethexFailure : messages clairs pour chaque cause", () => {
  assert.equal(describeAethexFailure(new AethexError("http", "x", 401)), "La clé AethexAI est refusée");
  assert.equal(describeAethexFailure(new AethexError("http", "x", 403)), "La clé AethexAI est refusée");
  assert.match(describeAethexFailure(new AethexError("http", "x", 402)), /Crédits/);
  assert.match(describeAethexFailure(new AethexError("http", "x", 429)), /Crédits/);
  assert.equal(describeAethexFailure(new AethexError("http", "x", 503)), "AethexAI est momentanément indisponible");
  assert.match(describeAethexFailure(new AethexError("http", "x", 418)), /418/);
  assert.equal(describeAethexFailure(new AethexError("invalid", "x")), "AethexAI a renvoyé une réponse illisible");
  assert.equal(describeAethexFailure(new AethexError("network", "x")), "AethexAI est injoignable");
  assert.equal(describeAethexFailure(new Error("autre")), "AethexAI est injoignable");
});
