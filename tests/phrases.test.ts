import test from "node:test";
import assert from "node:assert/strict";
import { POST as prospect } from "../src/app/api/prospect/route";
import { GET as state } from "../src/app/api/state/route";
import { POST as turn } from "../src/app/api/turn/route";
import { DEMO_NAMES, demoPhrases, isDemoPanel, pickDemoName } from "../src/app/marchand/view";
import { createRuntime, replaceRuntime } from "../src/lib/runtime";

// Mot de TEST, jamais le vrai mot de la démonstration.
const WORD = "Manioc";
const NOON = new Date(Date.UTC(2026, 9, 29, 12, 0, 0));
const leaks = (s: string) => /manioc/i.test(s);

// --- Les aides de la page -----------------------------------------------------------------------

test("panneau présentateur : seulement avec ?demo=1", () => {
  assert.equal(isDemoPanel("?demo=1"), true);
  assert.equal(isDemoPanel("?test=1&demo=1"), true);
  assert.equal(isDemoPanel("?demo=0"), false);
  assert.equal(isDemoPanel(""), false);
});

test("prénoms : tous neufs pour Argus, sans doublon", () => {
  const used = ["Koné", "Ouattara", "Sanogo", "Fatou", "Mamadou", "Adjoua"].map((n) => n.toLowerCase());
  for (const name of DEMO_NAMES) assert.equal(used.includes(name.toLowerCase()), false, `${name} a déjà servi`);
  assert.equal(new Set(DEMO_NAMES.map((n) => n.toLowerCase())).size, DEMO_NAMES.length, "pas de doublon");
  assert.ok(DEMO_NAMES.length >= 15);
});

test("prénoms : le tirage reste dans la liste et évite le prénom précédent", () => {
  assert.equal(pickDemoName(0), DEMO_NAMES[0]);
  assert.ok(DEMO_NAMES.includes(pickDemoName(0.9999999)));
  assert.ok(DEMO_NAMES.includes(pickDemoName(1)), "même un tirage de 1 reste dans la liste");
  for (let i = 0; i < 100; i++) assert.notEqual(pickDemoName(i / 100, "Traoré"), "Traoré");
  assert.notEqual(pickDemoName(0, DEMO_NAMES[0]), DEMO_NAMES[0]);
});

test("phrases : l'ordre des scènes du README, le prénom dans les transferts, la macro seulement pour la contrainte", () => {
  const phrases = demoPhrases("Traoré");
  assert.deepEqual(phrases.map((p) => p.id), ["encaisse", "oui", "transfert", "contrainte", "refus", "support", "non"]);
  const by = Object.fromEntries(phrases.map((p) => [p.id, p]));
  assert.equal(by.encaisse.text, "Encaisse cinq mille francs par Wave");
  assert.equal(by.transfert.text, "Envoie cent cinquante mille francs à Traoré");
  assert.equal(by.refus.text, "Envoie deux cent cinquante mille francs à Traoré");
  assert.match(by.transfert.label, /150 000 F à Traoré/);
  assert.match(by.refus.label, /250 000 F à Traoré/);
  assert.deepEqual(phrases.filter((p) => p.macro).map((p) => p.id), ["contrainte"]);
  assert.equal(by.contrainte.macro, "contrainte");
  assert.match(by.support.text, /plafond/);
});

// --- La macro de contrainte, côté serveur -------------------------------------------------------------

/** `phrase` : le mot secret configuré, ou `null` pour « aucun » (undefined déclencherait la valeur par défaut). */
const fresh = (phrase: string | null = WORD, demoMode = true) =>
  replaceRuntime(createRuntime({
    clock: () => NOON, secret: "s", getPhrase: () => phrase ?? undefined, demoMode, voice: null,
    jeko: { mode: "mock", baseUrl: "https://x.test", apiKey: undefined, apiKeyId: undefined, storeId: undefined, publicBaseUrl: "http://localhost:3000", timeoutMs: 1000 },
  }));

const post = (handler: (req: Request) => Promise<Response>, payload: unknown) =>
  handler(new Request("http://localhost/api/x", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) }));

async function read(res: Response) {
  const raw = await res.text();
  let body: any;
  try {
    body = JSON.parse(raw);
  } catch {
    body = undefined;
  }
  return { status: res.status, raw, body };
}

const say = async (text: string, sessionId: string, macro?: string) =>
  read(await post(turn, { sessionId, text, ...(macro ? { macro } : {}) }));

test("macro : la contrainte donne la même réponse qu'un succès normal, retient l'opération, et le mot ne sort jamais", async () => {
  const rt = fresh();
  await say("Envoie cent cinquante mille francs à Traoré", "normal");
  const ok = await say("oui", "normal");
  await say("Envoie cent cinquante mille francs à Coulibaly", "forcee");
  const forced = await say("oui", "forcee", "contrainte");

  assert.equal(forced.status, 200);
  const { heard: h1, ...okBody } = ok.body;
  const { heard: h2, ...forcedBody } = forced.body;
  assert.equal(h1, "oui");
  assert.equal(h2, "Oui", "l'écran n'affiche pas le mot");
  assert.equal(forcedBody.reply.replace("Coulibaly", "Traoré"), okBody.reply, "même réponse qu'un succès normal (au prénom près)");
  assert.equal(forcedBody.tone, okBody.tone);

  const s = await read(await state());
  assert.equal(s.body.counts.held, 1);
  const alert = s.body.alerts.find((a: any) => a.type === "duress");
  assert.deepEqual([alert.level, alert.title], ["critical", "Contrainte signalée"]);
  assert.equal(rt.store.operations.filter((o) => o.status === "executed").length, 1, "seul le transfert normal a eu lieu");
  for (const text of [forced.raw, s.raw]) assert.equal(leaks(text), false);
});

test("macro : fonctionne aussi avec un secret de plusieurs mots", async () => {
  fresh("le manioc cuit doucement");
  await say("Envoie cent cinquante mille francs à Traoré", "a");
  const forced = await say("oui", "a", "contrainte");
  assert.equal(forced.status, 200);
  assert.equal(forced.body.heard, "Oui");
  assert.equal(forced.body.reply.startsWith("C'est envoyé"), true);
  assert.equal(leaks(forced.raw), false);
  assert.equal((await read(await state())).body.counts.held, 1);
});

test("macro : réservée à la démonstration", async () => {
  const rt = fresh(WORD, false);
  await say("Envoie cent cinquante mille francs à Traoré", "a");
  const r = await say("oui", "a", "contrainte");
  assert.deepEqual([r.status, r.body.error], [403, "demo_only"]);
  assert.equal(rt.store.operations.filter((o) => o.status === "held").length, 0);
  assert.equal(rt.store.alerts.some((a) => a.type === "duress"), false);
});

test("macro : sans mot secret valide, refus clair et rien n'est retenu", async () => {
  for (const phrase of [null, "", "la marmite", "four"]) {
    const rt = fresh(phrase);
    await say("Envoie cent cinquante mille francs à Traoré", "a");
    const r = await say("oui", "a", "contrainte");
    assert.deepEqual([r.status, r.body.error], [409, "duress_disabled"], String(phrase));
    assert.match(r.body.message, /DURESS_PHRASE/);
    assert.equal(rt.store.operations.filter((o) => o.status === "held").length, 0);
    assert.equal(rt.store.operations.filter((o) => o.status === "executed").length, 0, "rien n'a été envoyé non plus");
  }
});

test("macro : valeur inconnue ou mal typée refusée", async () => {
  fresh();
  for (const macro of ["autre", "", "CONTRAINTE", "__proto__", 1, true, null, {}, ["contrainte"]]) {
    const r = await read(await post(turn, { sessionId: "a", text: "oui", macro }));
    assert.deepEqual([r.status, r.body.error], [400, "invalid_macro"], JSON.stringify(macro));
  }
});

test("macro : sans macro, une phrase ordinaire se comporte comme avant", async () => {
  const rt = fresh();
  await say("Envoie cent cinquante mille francs à Traoré", "a");
  const r = await say("oui", "a");
  assert.equal(r.body.heard, "oui");
  assert.equal(rt.store.alerts.some((a) => a.type === "duress"), false);
  assert.equal(rt.store.operations.at(-1)!.status, "executed");
});

test("macro : la route des visiteurs l'ignore (jamais de contrainte hors du dialogue du marchand)", async () => {
  const rt = fresh();
  const r = await read(await post(prospect, { sessionId: "visiteur-1", text: "", macro: "contrainte" }));
  assert.equal(r.status, 200);
  assert.equal(rt.store.alerts.some((a) => a.type === "duress"), false);
  assert.equal(leaks(r.raw), false);
});

// --- Tout le parcours avec les boutons ------------------------------------------------------------------

test("parcours des boutons : encaissement, vérification, contrainte, refus, support", async () => {
  const rt = fresh();
  const by = Object.fromEntries(demoPhrases("Traoré").map((p) => [p.id, p]));
  const press = (id: string) => say(by[id].text, "presentateur", by[id].macro);

  assert.match((await press("encaisse")).body.reply, /Tu veux encaisser 5 000 francs par Wave/);
  assert.equal((await press("oui")).body.reply, "C'est lancé. Le client peut scanner et payer.");

  const verify = await press("transfert");
  assert.match(verify.body.reply, /^150 000 francs pour /, "question de vérification");
  assert.equal(verify.body.awaitingConfirm, true);

  const forced = await press("contrainte");
  assert.match(forced.body.reply, /^C'est envoyé\. 150 000 francs à Traoré\.$/);
  assert.equal(forced.body.heard, "Oui");

  const refused = await press("refus");
  assert.match(refused.body.reply, /en attente de vérification/);

  const support = await press("support");
  assert.equal(support.body.source, "Notes des ingénieurs Jèko (plafond à confirmer)");

  const s = await read(await state());
  assert.equal(s.body.counts.held, 1);
  assert.equal(s.body.counts.blocked, 1);
  assert.equal(s.body.criticalAlerts, 1);
  assert.equal(leaks(s.raw), false);
  assert.equal(rt.store.operations.filter((o) => o.status === "executed").length, 0, "la contrainte n'a rien envoyé");
});
