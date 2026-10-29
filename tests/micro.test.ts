import test from "node:test";
import assert from "node:assert/strict";
import { POST as sttTest } from "../src/app/api/stt-test/route";
import { isMicProfile, MIC_PROFILES, saveMicProfile, savedMicProfile } from "../src/app/marchand/audio";
import { bestProfile, EXPECTED_PHRASE, phraseScore, scoreLabel } from "../src/app/micro/score";
import { AethexError } from "../src/lib/aethex";
import type { VoiceService } from "../src/lib/ports";
import { createRuntime, replaceRuntime } from "../src/lib/runtime";

// --- Noter une transcription -------------------------------------------------------------------

test("score : la phrase attendue, dite parfaitement, vaut 1", () => {
  assert.equal(phraseScore(EXPECTED_PHRASE), 1);
  assert.equal(phraseScore("encaisser cinq mille francs par wave"), 1);
  assert.equal(phraseScore("ENCAISSE CINQ MILLE FRANCS PAR WAVE !"), 1);
});

test("score : les nombres en chiffres et « WAF » comptent", () => {
  assert.equal(phraseScore("Encaisse 5000 francs par WAF"), 1);
  assert.equal(phraseScore("Tu veux encaisser 5000 francs par WIF, tu confirmes?"), 1, "« WIF » relevé lors d'un essai réel");
  assert.equal(phraseScore("Encaisse 5 000 francs par Wave"), 1);
  assert.equal(phraseScore("Encaisse 5 000 francs par Wave"), 1, "espace insécable");
  assert.equal(phraseScore("Encaisse 5 000 francs par Wave"), 1, "espace fine insécable");
  assert.equal(phraseScore("Encaisse 5000 F"), 4 / 6, "encaisse, cinq, mille, F");
});

test("score : 15 000 ou 50 000 ne valent pas 5 000", () => {
  assert.equal(phraseScore("Encaisse 15000 francs par Wave"), 4 / 6);
  assert.equal(phraseScore("Encaisse 50000 francs par Wave"), 4 / 6);
  assert.equal(phraseScore("Encaisse 5000 francs par Wave"), 1);
});

test("score : une lettre d'écart sur un mot de cinq lettres ou plus est tolérée, pas sur un mot court", () => {
  assert.equal(phraseScore("encaise cinq mille francs par wave"), 1, "une lettre de moins");
  assert.equal(phraseScore("enquaisse cinq mille francs par wave"), 5 / 6, "deux lettres d'écart : pas toléré");
  assert.equal(phraseScore("encaisse cinq mile francs par wave"), 1, "« mille » a cinq lettres : une lettre d'écart passe");
  assert.equal(phraseScore("encaisse cin mille francs par wave"), 5 / 6, "« cinq » a quatre lettres : pas flou");
  assert.equal(phraseScore("encaisse cinq mille francs pas wave"), 5 / 6);
});

test("score : une phrase sans rapport, vide ou partielle", () => {
  assert.equal(phraseScore("On teste ces leçons."), 0);
  assert.equal(phraseScore(""), 0);
  assert.equal(phraseScore("   "), 0);
  assert.equal(scoreLabel(4 / 6), "4 mots sur 6");
  assert.equal(scoreLabel(1), "6 mots sur 6");
  assert.equal(scoreLabel(0), "0 mots sur 6");
});

test("meilleur réglage : la transcription la plus proche gagne, le premier en cas d'égalité", () => {
  assert.equal(bestProfile([
    { profile: "standard", heard: "On teste ces leçons" },
    { profile: "sans_reduction", heard: "Encaisse 5000 francs par Wave" },
    { profile: "brut", heard: "Encaisse cinq mille" },
  ]), "sans_reduction");
  assert.equal(bestProfile([
    { profile: "standard", heard: "Encaisse cinq mille francs par Wave" },
    { profile: "brut", heard: "Encaisse cinq mille francs par Wave" },
  ]), "standard", "égalité : le premier essayé");
  assert.equal(bestProfile([
    { profile: "standard", heard: "On teste ces leçons" },
    { profile: "brut", heard: "" },
  ]), undefined, "aucun n'a rien compris");
  assert.equal(bestProfile([]), undefined);
});

// --- Les réglages de micro -------------------------------------------------------------------------

test("profils : trois réglages, du plus traité au brut", () => {
  assert.deepEqual(Object.keys(MIC_PROFILES), ["standard", "sans_reduction", "brut"]);
  const c = (p: keyof typeof MIC_PROFILES) => MIC_PROFILES[p].constraints as Record<string, unknown>;
  assert.deepEqual([c("standard").echoCancellation, c("standard").noiseSuppression, c("standard").autoGainControl], [true, true, true]);
  assert.deepEqual([c("sans_reduction").echoCancellation, c("sans_reduction").noiseSuppression, c("sans_reduction").autoGainControl], [true, false, true]);
  assert.deepEqual([c("brut").echoCancellation, c("brut").noiseSuppression, c("brut").autoGainControl], [false, false, false]);
  for (const p of Object.values(MIC_PROFILES)) assert.equal((p.constraints as Record<string, unknown>).channelCount, 1);
  assert.equal(MIC_PROFILES.brut.silence.threshold, 0.008, "sans gain automatique la voix est plus basse : seuil plus bas");
  assert.deepEqual(MIC_PROFILES.standard.silence, {});
});

test("profils : reconnaissance d'un nom valide", () => {
  for (const ok of ["standard", "sans_reduction", "brut"]) assert.equal(isMicProfile(ok), true, ok);
  for (const no of ["", "autre", "toString", "__proto__", "constructor", 3, undefined, null]) assert.equal(isMicProfile(no), false, String(no));
});

test("mémorisation : le profil retenu se relit, un stockage absent ou une valeur fausse donnent « standard »", () => {
  const g = globalThis as unknown as { localStorage?: unknown };
  const saved = g.localStorage;
  try {
    g.localStorage = undefined;
    assert.equal(savedMicProfile(), "standard", "pas de stockage");
    assert.doesNotThrow(() => saveMicProfile("brut"));

    const memory = new Map<string, string>();
    g.localStorage = { getItem: (k: string) => memory.get(k) ?? null, setItem: (k: string, v: string) => void memory.set(k, v) };
    assert.equal(savedMicProfile(), "standard", "rien d'enregistré");
    saveMicProfile("brut");
    assert.equal(savedMicProfile(), "brut");
    saveMicProfile("sans_reduction");
    assert.equal(savedMicProfile(), "sans_reduction");
    memory.set("jeko-micro-profil", "n'importe quoi");
    assert.equal(savedMicProfile(), "standard", "valeur inconnue");

    g.localStorage = { getItem: () => { throw new Error("bloqué"); }, setItem: () => { throw new Error("bloqué"); } };
    assert.equal(savedMicProfile(), "standard");
    assert.doesNotThrow(() => saveMicProfile("brut"));
  } finally {
    g.localStorage = saved;
  }
});

// --- La route de transcription seule ----------------------------------------------------------------

const NOON = new Date(Date.UTC(2026, 9, 29, 12, 0, 0));
const WORD = "Manioc";
const URL_ = "http://localhost/api/stt-test";

function stub(transcript: string | Error): VoiceService & { calls: number } {
  const s = {
    calls: 0,
    async transcribe() {
      s.calls++;
      if (transcript instanceof Error) throw transcript;
      return transcript;
    },
    async synthesize() {
      return { audio: new ArrayBuffer(16), contentType: "audio/wav" };
    },
  };
  return s;
}

const fresh = (voice: VoiceService | null, demoMode = true) =>
  replaceRuntime(createRuntime({
    clock: () => NOON, secret: "s", getPhrase: () => WORD, demoMode, voice,
    jeko: { mode: "mock", baseUrl: "https://x.test", apiKey: undefined, apiKeyId: undefined, storeId: undefined, publicBaseUrl: "http://localhost:3000", timeoutMs: 1000 },
  }));

const upload = (audio?: Blob | string) => {
  const form = new FormData();
  if (typeof audio === "string") form.set("audio", audio);
  else if (audio) form.set("audio", audio, "voix.wav");
  return sttTest(new Request(URL_, { method: "POST", body: form }));
};
const wav = () => new Blob([new Uint8Array(200)], { type: "audio/wav" });
const read = async (res: Response) => ({ status: res.status, body: (await res.json()) as any });

test("route : renvoie seulement le texte compris, sans lancer le dialogue", async () => {
  const voice = stub("Encaisse 5000 francs par WAF");
  const rt = fresh(voice);
  const r = await read(await upload(wav()));
  assert.deepEqual([r.status, r.body], [200, { text: "Encaisse 5000 francs par WAF" }]);
  assert.equal(voice.calls, 1);
  assert.equal(rt.store.operations.length, 10, "aucune opération créée (seulement les 10 d'exemple)");
  assert.equal(rt.store.alerts.length, 0);
});

test("route : le mot secret, s'il est dit pendant un test, n'est pas renvoyé et ne crée aucune alerte", async () => {
  const rt = fresh(stub("Oui, c'est bon, manioc"));
  const r = await read(await upload(wav()));
  assert.equal(r.body.text, "Oui");
  assert.equal(JSON.stringify(r.body).toLowerCase().includes("manioc"), false);
  assert.equal(rt.store.alerts.length, 0, "ce n'est pas un tour de dialogue : pas de contrainte déclenchée");
});

test("route : réservée à la démonstration, et à la voix serveur", async () => {
  fresh(stub("x"), false);
  const refused = await read(await upload(wav()));
  assert.deepEqual([refused.status, refused.body.error], [403, "demo_only"]);
  fresh(null);
  const r = await read(await upload(wav()));
  assert.deepEqual([r.status, r.body.error], [501, "voice_not_available"]);
});

test("route : entrées invalides, rien n'est envoyé à AethexAI", async () => {
  const voice = stub("x");
  fresh(voice);
  assert.equal((await upload()).status, 400, "pas d'audio");
  assert.equal((await upload("du texte")).status, 400, "pas un fichier");
  assert.equal((await upload(new Blob(["x"], { type: "audio/webm" }))).status, 415, "format refusé");
  assert.equal((await upload(new Blob([new Uint8Array(8 * 1024 * 1024 + 1)], { type: "audio/wav" }))).status, 413, "trop gros");
  const json = await sttTest(new Request(URL_, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }));
  assert.equal(json.status, 415);
  const big = await sttTest(new Request(URL_, { method: "POST", headers: { "content-type": "multipart/form-data; boundary=x", "content-length": String(9 * 1024 * 1024) }, body: "--x--" }));
  assert.equal(big.status, 413);
  const broken = await sttTest(new Request(URL_, { method: "POST", headers: { "content-type": "multipart/form-data; boundary=x" }, body: "pas du multipart" }));
  assert.equal(broken.status, 400);
  assert.equal(voice.calls, 0);
});

test("route : un échec d'AethexAI donne un message générique, sans détail ni clé", async () => {
  fresh(stub(new AethexError("http", "code 401 clé=ae_secrete", 401)));
  const res = await upload(wav());
  const text = await res.text();
  assert.equal(res.status, 502);
  assert.equal(text.includes("ae_secrete") || text.includes("401"), false);
});
