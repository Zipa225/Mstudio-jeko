import test from "node:test";
import assert from "node:assert/strict";
import { POST as sttTest } from "../src/app/api/stt-test/route";
import {
  CLIPPING_LIMIT, isMicProfile, LEVEL_MESSAGE, levelVerdict, MIC_PROFILES, openMic, saveMicDevice, saveMicProfile, saveSttEngine,
  savedMicDevice, savedMicProfile, savedSttEngine,
} from "../src/app/marchand/audio";
import { saturationAdvice } from "../src/app/marchand/view";
import { bestProfile, chooseEngine, EXPECTED_PHRASE, phraseScore, scoreLabel } from "../src/app/micro/score";
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

test("meilleur réglage : à score égal, un son saturé ne passe jamais devant un son propre", () => {
  const same = "Encaisse cinq mille francs par Wave";
  assert.equal(bestProfile([
    { profile: "standard", heard: same, saturated: true },
    { profile: "sans_reduction", heard: same },
    { profile: "brut", heard: same },
  ]), "sans_reduction");
  assert.equal(bestProfile([
    { profile: "standard", heard: same, saturated: true },
    { profile: "brut", heard: same, saturated: true },
  ]), "standard", "tous saturés : le premier");
  assert.equal(bestProfile([
    { profile: "standard", heard: same, saturated: true },
    { profile: "brut", heard: "Encaisse 5000 francs" },
  ]), "standard", "un meilleur score l'emporte, même saturé : le texte compris prime");
  assert.equal(bestProfile([
    { profile: "standard", heard: same },
    { profile: "brut", heard: same },
  ]), "standard", "propres tous les deux : le premier");
});

test("moteur : AethexAI, sauf si le navigateur a STRICTEMENT mieux compris", () => {
  const aethex = [
    { profile: "standard" as const, heard: "Je suis ok 5000 fois par 8" },
    { profile: "brut" as const, heard: "C'est qu'il faut par où" },
  ];
  assert.equal(chooseEngine(aethex, "Encaisse 5000 francs par Wave"), "navigateur");
  assert.equal(chooseEngine(aethex, "Encaisse cinq mille"), "aethex", "3 mots contre 3 : égalité");
  assert.equal(chooseEngine(aethex, "Encaisse 5000 francs"), "navigateur", "4 mots contre 3 : mieux");
  assert.equal(chooseEngine(aethex, "Je suis ok 5000 fois par 8"), "aethex", "égalité : AethexAI");
  assert.equal(chooseEngine(aethex, "bonjour"), "aethex");
  assert.equal(chooseEngine(aethex, undefined), "aethex", "pas d'essai du navigateur");
  assert.equal(chooseEngine([], "Encaisse 5000 francs par Wave"), "navigateur", "AethexAI n'a rien donné");
  assert.equal(chooseEngine([], "on teste ces leçons"), "aethex", "le navigateur n'a rien compris non plus");
});

test("moteur : le choix se mémorise, valeur inconnue ou stockage absent donnent AethexAI", () => {
  const g = globalThis as unknown as { localStorage?: unknown };
  const saved = g.localStorage;
  try {
    g.localStorage = undefined;
    assert.equal(savedSttEngine(), "aethex");
    assert.doesNotThrow(() => saveSttEngine("navigateur"));
    const memory = new Map<string, string>();
    g.localStorage = { getItem: (k: string) => memory.get(k) ?? null, setItem: (k: string, v: string) => void memory.set(k, v) };
    assert.equal(savedSttEngine(), "aethex");
    saveSttEngine("navigateur");
    assert.equal(savedSttEngine(), "navigateur");
    saveSttEngine("aethex");
    assert.equal(savedSttEngine(), "aethex");
    memory.set("jeko-micro-moteur", "n'importe quoi");
    assert.equal(savedSttEngine(), "aethex");
    g.localStorage = { getItem: () => { throw new Error("bloqué"); }, setItem: () => { throw new Error("bloqué"); } };
    assert.equal(savedSttEngine(), "aethex");
    assert.doesNotThrow(() => saveSttEngine("navigateur"));
  } finally {
    g.localStorage = saved;
  }
});

test("saturation : un son déformé n'est pas envoyé, le gain automatique est coupé", () => {
  const sat = { clipped: 0.2 };
  for (const profile of ["standard", "sans_reduction"] as const) {
    const a = saturationAdvice(profile, sat)!;
    assert.equal(a.nextProfile, "sans_gain", profile);
    assert.match(a.message, /sature/);
    assert.match(a.message, /gain automatique/);
  }
  for (const profile of ["sans_gain", "brut"] as const) {
    const a = saturationAdvice(profile, sat)!;
    assert.equal(a.nextProfile, undefined, "déjà sans gain automatique : on ne change pas de réglage");
    assert.match(a.message, /baisse le volume du micro/);
  }
});

test("saturation : un son propre, ou à la limite exacte, est envoyé", () => {
  assert.equal(saturationAdvice("standard", { clipped: 0 }), undefined);
  assert.equal(saturationAdvice("standard", { clipped: CLIPPING_LIMIT }), undefined, "à la limite : pas encore saturé");
  assert.ok(saturationAdvice("standard", { clipped: CLIPPING_LIMIT + 0.001 }));
  assert.equal(saturationAdvice("brut", { clipped: Number.NaN }), undefined, "mesure illisible : on envoie plutôt que de bloquer");
});

test("niveau : le verdict d'un micro selon ce qu'il capte", () => {
  assert.equal(levelVerdict(0, 500), "attente", "début : on attend que la personne parle");
  assert.equal(levelVerdict(0.001, 2999), "attente");
  assert.equal(levelVerdict(0, 3000), "silence", "3 s sans rien : le micro ne capte rien");
  assert.equal(levelVerdict(0.0039, 5000), "silence");
  assert.equal(levelVerdict(0.004, 5000), "faible", "un souffle mais presque rien");
  assert.equal(levelVerdict(0.0199, 5000), "faible");
  assert.equal(levelVerdict(0.02, 100), "ok", "dès que la voix passe, inutile d'attendre");
  assert.equal(levelVerdict(0.5, 5000), "ok");
  assert.equal(levelVerdict(0.979, 5000), "ok");
  assert.equal(levelVerdict(0.98, 100), "sature");
  assert.equal(levelVerdict(1, 5000), "sature");
  for (const verdict of ["attente", "silence", "faible", "ok", "sature"] as const) assert.ok(LEVEL_MESSAGE[verdict].length > 20, verdict);
  assert.match(LEVEL_MESSAGE.silence, /Paramètres, Système, Son, Entrée/);
});

test("micro choisi : se mémorise, se retire, et un stockage absent ne casse rien", () => {
  const g = globalThis as unknown as { localStorage?: unknown };
  const saved = g.localStorage;
  try {
    g.localStorage = undefined;
    assert.equal(savedMicDevice(), undefined);
    assert.doesNotThrow(() => saveMicDevice("abc"));
    const memory = new Map<string, string>();
    g.localStorage = {
      getItem: (k: string) => memory.get(k) ?? null,
      setItem: (k: string, v: string) => void memory.set(k, v),
      removeItem: (k: string) => void memory.delete(k),
    };
    assert.equal(savedMicDevice(), undefined);
    saveMicDevice("micro-ecouteurs");
    assert.equal(savedMicDevice(), "micro-ecouteurs");
    saveMicDevice(undefined);
    assert.equal(savedMicDevice(), undefined, "retiré : on revient au micro du système");
    g.localStorage = { getItem: () => { throw new Error("bloqué"); }, setItem: () => { throw new Error("bloqué"); }, removeItem: () => { throw new Error("bloqué"); } };
    assert.equal(savedMicDevice(), undefined);
    assert.doesNotThrow(() => saveMicDevice(undefined));
  } finally {
    g.localStorage = saved;
  }
});

test("openMic : le micro choisi est demandé en exact, et s'il a disparu on prend celui du système", async () => {
  const g = globalThis as unknown as { localStorage?: unknown; navigator?: unknown };
  const savedStorage = g.localStorage;
  const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const calls: unknown[] = [];
  const memory = new Map<string, string>([["jeko-micro-appareil", "ecouteurs-debranches"]]);
  g.localStorage = {
    getItem: (k: string) => memory.get(k) ?? null,
    setItem: (k: string, v: string) => void memory.set(k, v),
    removeItem: (k: string) => void memory.delete(k),
  };
  const stream = { id: "flux" } as unknown as MediaStream;
  try {
    const install = (getUserMedia: (c: any) => Promise<MediaStream>) =>
      Object.defineProperty(globalThis, "navigator", { value: { mediaDevices: { getUserMedia } }, configurable: true, writable: true });

    // 1. Le micro choisi existe : demandé avec deviceId exact, contraintes du profil conservées.
    install(async (c) => { calls.push(c); return stream; });
    assert.equal(await openMic("sans_gain"), stream);
    assert.deepEqual((calls[0] as any).audio.deviceId, { exact: "ecouteurs-debranches" });
    assert.equal((calls[0] as any).audio.autoGainControl, false);
    assert.equal((calls[0] as any).audio.noiseSuppression, true);

    // 2. Il a disparu : on prend celui du système et on oublie le micro enregistré.
    calls.length = 0;
    install(async (c) => { calls.push(c); if (c.audio.deviceId) throw Object.assign(new Error("absent"), { name: "OverconstrainedError" }); return stream; });
    assert.equal(await openMic("standard"), stream);
    assert.equal(calls.length, 2);
    assert.equal((calls[1] as any).audio.deviceId, undefined, "deuxième essai sans micro imposé");
    assert.equal(savedMicDevice(), undefined, "le micro disparu est oublié");

    // 3. Une autre erreur (permission refusée) n'est jamais avalée.
    memory.set("jeko-micro-appareil", "autre");
    install(async () => { throw Object.assign(new Error("refus"), { name: "NotAllowedError" }); });
    await assert.rejects(() => openMic("standard"), { name: "NotAllowedError" });
    assert.equal(savedMicDevice(), "autre", "refus de permission : le choix n'est pas effacé");

    // 4. Un micro passé explicitement (page de test) ne touche pas au micro enregistré.
    calls.length = 0;
    install(async (c) => { calls.push(c); throw Object.assign(new Error("absent"), { name: "NotFoundError" }); });
    await assert.rejects(() => openMic("standard", "essai"));
    assert.equal(savedMicDevice(), "autre");

    // 5. Sans micro choisi : une seule demande, sans deviceId.
    memory.clear();
    calls.length = 0;
    install(async (c) => { calls.push(c); return stream; });
    await openMic("brut");
    assert.equal(calls.length, 1);
    assert.equal((calls[0] as any).audio.deviceId, undefined);
  } finally {
    g.localStorage = savedStorage;
    if (navigatorDescriptor) Object.defineProperty(globalThis, "navigator", navigatorDescriptor);
  }
});

// --- Les réglages de micro -------------------------------------------------------------------------

test("profils : quatre réglages, du plus traité au brut", () => {
  assert.deepEqual(Object.keys(MIC_PROFILES), ["standard", "sans_reduction", "sans_gain", "brut"]);
  const c = (p: keyof typeof MIC_PROFILES) => MIC_PROFILES[p].constraints as Record<string, unknown>;
  assert.deepEqual([c("standard").echoCancellation, c("standard").noiseSuppression, c("standard").autoGainControl], [true, true, true]);
  assert.deepEqual([c("sans_reduction").echoCancellation, c("sans_reduction").noiseSuppression, c("sans_reduction").autoGainControl], [true, false, true]);
  assert.deepEqual([c("sans_gain").echoCancellation, c("sans_gain").noiseSuppression, c("sans_gain").autoGainControl], [false, true, false], "évite le gain automatique qui sature");
  assert.deepEqual([c("brut").echoCancellation, c("brut").noiseSuppression, c("brut").autoGainControl], [false, false, false]);
  assert.equal(MIC_PROFILES.sans_gain.silence.threshold, 0.008);
  for (const p of Object.values(MIC_PROFILES)) assert.equal((p.constraints as Record<string, unknown>).channelCount, 1);
  assert.equal(MIC_PROFILES.brut.silence.threshold, 0.008, "sans gain automatique la voix est plus basse : seuil plus bas");
  assert.deepEqual(MIC_PROFILES.standard.silence, {});
});

test("profils : reconnaissance d'un nom valide", () => {
  for (const ok of ["standard", "sans_reduction", "sans_gain", "brut"]) assert.equal(isMicProfile(ok), true, ok);
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
