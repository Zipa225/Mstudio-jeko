import test from "node:test";
import assert from "node:assert/strict";
import { GET as health } from "../src/app/api/health/route";
import { GET as state } from "../src/app/api/state/route";
import { POST as turn } from "../src/app/api/turn/route";
import { duressNotice } from "../src/app/analyste/view";
import { duressStatus, publicTranscript } from "../src/lib/duress";
import { createRuntime, replaceRuntime } from "../src/lib/runtime";
import { containsFuzzyPhrase, isTriggerWord } from "../src/lib/text";

// Mot de TEST, jamais le vrai mot de la démonstration.
const WORD = "Manioc";
const NOON = new Date(Date.UTC(2026, 9, 29, 12, 0, 0));
const leaks = (s: string) => /manioc/i.test(s);

// --- Ce qu'est un mot déclencheur ------------------------------------------------------------

test("mot déclencheur : un seul mot d'au moins cinq lettres", () => {
  for (const ok of ["Manioc", "manioc", "Marmité", "MARMITE", "  marmite  ", "Manioc !"]) assert.equal(isTriggerWord(ok), true, ok);
  for (const no of ["oui", "feu", "four", "", "   ", "la marmite", "le manioc cuit", "manioc manioc"]) assert.equal(isTriggerWord(no), false, no);
});

test("statut : « word » pour un mot seul, les phrases gardent leur règle", () => {
  assert.equal(duressStatus("Manioc"), "word");
  assert.equal(duressStatus("la marmite"), "weak", "deux mots dont un seul compte : toujours refusé");
  assert.equal(duressStatus("le feu"), "weak");
  assert.equal(duressStatus("four"), "weak", "un mot de moins de cinq lettres reste refusé");
  assert.equal(duressStatus("le manioc cuit doucement"), "active");
  assert.equal(duressStatus(undefined), "disabled");
  assert.equal(duressStatus(""), "disabled");
});

test("détection : le mot, dans n'importe quelle phrase, à une lettre près", () => {
  for (const yes of [
    "manioc", "Oui, c'est bon, manioc", "MANIOC ! oui", "oui d'accord, merci manioc et bonne journée",
    "le maniok", "du manioc.", "oui, le maniocs", "oui, maniac", "oui, manio",
  ]) assert.equal(containsFuzzyPhrase(yes, WORD), true, yes);
  for (const no of ["", "oui c'est bon", "Je veux envoyer de l'argent", "manger du riz", "la maniere", "oui le maniaca", "oui le canoe"]) {
    assert.equal(containsFuzzyPhrase(no, WORD), false, no);
  }
});

test("écran du marchand : le mot n'est jamais affiché", () => {
  assert.equal(publicTranscript("Oui, c'est bon, manioc", WORD), "Oui");
  assert.equal(publicTranscript("manioc", WORD), "…");
  assert.equal(publicTranscript("oui c'est bon", WORD), "oui c'est bon");
});

test("écran analyste : l'avertissement du mot unique ne révèle pas le mot", () => {
  const notice = duressNotice("word")!;
  assert.match(notice, /Mot déclencheur unique/);
  assert.match(notice, /même par hasard/);
  assert.equal(leaks(notice), false);
  assert.equal(duressNotice("active"), undefined);
});

// --- La scène, par les routes ---------------------------------------------------------------------

const post = (payload: unknown) =>
  turn(new Request("http://localhost/api/turn", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) }));

async function read(res: Response) {
  const raw = await res.text();
  return { status: res.status, raw, body: JSON.parse(raw) };
}

const fresh = () =>
  replaceRuntime(createRuntime({
    clock: () => NOON, secret: "s", getPhrase: () => WORD, demoMode: true, voice: null,
    jeko: { mode: "mock", baseUrl: "https://x.test", apiKey: undefined, apiKeyId: undefined, storeId: undefined, publicBaseUrl: "http://localhost:3000", timeoutMs: 1000 },
  }));

const say = async (text: string, sessionId: string) => read(await post({ sessionId, text }));

test("scène : le mot dans une phrase de confirmation retient l'opération et affiche un succès", async () => {
  const rt = fresh();
  await say("Envoie cent cinquante mille francs à Koné", "normal");
  const ok = await say("oui", "normal");
  await say("Envoie cent cinquante mille francs à Koné", "forcee");
  const forced = await say("Oui, c'est bon, que le manioc me protège", "forcee");

  const { heard: h1, ...okBody } = ok.body;
  const { heard: h2, ...forcedBody } = forced.body;
  assert.deepEqual(forcedBody, okBody, "même réponse qu'un succès normal");
  assert.equal(h1, "oui");
  assert.equal(h2, "Oui", "l'écran n'affiche pas la phrase");

  const s = await read(await state());
  assert.equal(s.body.duress, "word");
  assert.equal(s.body.counts.held, 1);
  const alert = s.body.alerts.find((a: any) => a.type === "duress");
  assert.deepEqual([alert.level, alert.title], ["critical", "Contrainte signalée"]);
  assert.equal(rt.store.operations.filter((o) => o.status === "executed").length, 1, "seul le transfert normal a eu lieu");
  for (const text of [forced.raw, s.raw]) assert.equal(leaks(text), false);
});

test("scène : un oui normal exécute toujours, sans le mot rien ne se déclenche", async () => {
  const rt = fresh();
  await say("Envoie cent cinquante mille francs à Koné", "a");
  const r = await say("Oui, d'accord, vas-y", "a");
  assert.equal(r.body.heard, "Oui, d'accord, vas-y");
  assert.equal(rt.store.alerts.some((a) => a.type === "duress"), false);
  assert.equal(rt.store.operations.at(-1)!.status, "executed");
});

test("scène : le mot dit sans rien à confirmer alerte discrètement, sans rien exécuter", async () => {
  const rt = fresh();
  const r = await say("manioc", "b");
  assert.equal(leaks(r.raw), false);
  const alert = rt.store.alerts.find((a) => a.type === "duress")!;
  assert.equal(alert.title, "Code de contrainte reçu");
  assert.equal(alert.level, "critical");
  assert.equal(rt.store.operations.filter((o) => o.status === "executed").length, 0);
});

test("santé : duress « word » avec un mot seul, sans jamais révéler le mot", async () => {
  fresh();
  const h = await read(await health());
  assert.equal(h.body.duress, "word");
  assert.equal(leaks(h.raw), false);
});
