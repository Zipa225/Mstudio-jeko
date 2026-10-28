import test, { afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import { GET as health } from "../src/app/api/health/route";
import { POST as paid } from "../src/app/api/paid/route";
import { POST as reset } from "../src/app/api/reset/route";
import { GET as state } from "../src/app/api/state/route";
import { POST as turn } from "../src/app/api/turn/route";
import { POST as webhook } from "../src/app/api/webhook/jeko/route";
import { signBody } from "../src/lib/jekoWebhook";
import { createRuntime, getRuntime, replaceRuntime, resetRuntime, type RuntimeOptions } from "../src/lib/runtime";
import { normalize, phraseKeywords } from "../src/lib/text";

// Phrase de TEST, neutre : jamais la vraie phrase de la démonstration.
const PHRASE = "le manioc cuit doucement";
const LEAK_KEYS = phraseKeywords(PHRASE).filter((k) => k.length >= 6);
const leaks = (s: string) => LEAK_KEYS.some((k) => normalize(s).includes(k));
const SECRET = "secret-de-test-serveur";
const NOON = new Date(Date.UTC(2026, 9, 27, 12, 0, 0));
const URL = "http://localhost/api/x";

function fresh(options: RuntimeOptions = {}) {
  return replaceRuntime(createRuntime({ clock: () => NOON, secret: SECRET, getPhrase: () => PHRASE, demoMode: true, ...options }));
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

const postJson = (handler: (req: Request) => Promise<Response>, payload: unknown, headers: Record<string, string> = {}) =>
  handler(new Request(URL, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(payload) }));

const say = async (text: string, sessionId = "awa") => read(await postJson(turn, { sessionId, text }));
const getState = async () => read(await state());

afterEach(() => mock.restoreAll());

// --- /api/turn --------------------------------------------------------------

test("turn : une phrase entre, la réponse sort, sans mise en cache", async () => {
  fresh();
  const r = await say("Encaisse cinq mille francs par Wave");
  assert.equal(r.status, 200);
  assert.equal(r.body.reply, "Tu veux encaisser 5 000 francs par Wave. Tu confirmes ?");
  assert.equal(r.body.speech, "Tu veux encaisser cinq mille francs par Wave. Tu confirmes ?");
  assert.equal(r.body.awaitingConfirm, true);
  assert.equal(r.body.heard, "Encaisse cinq mille francs par Wave");
  assert.equal(r.headers.get("cache-control"), "no-store");

  const ok = await say("oui");
  assert.equal(ok.body.reply, "C'est lancé. Le client peut scanner et payer.");
  assert.deepEqual(ok.body.payment, { id: ok.body.payment.id, amount: 5000, wallet: "wave" });
});

test("turn : les entrées invalides sont refusées proprement", async () => {
  fresh();
  const bad = async (payload: unknown, status: number, error: string) => {
    const r = await read(await postJson(turn, payload));
    assert.deepEqual([r.status, r.body?.error], [status, error], JSON.stringify(payload));
  };
  await bad({ text: "bonjour" }, 400, "invalid_session");
  await bad({ sessionId: "a b", text: "x" }, 400, "invalid_session");
  await bad({ sessionId: "é", text: "x" }, 400, "invalid_session");
  await bad({ sessionId: "a".repeat(65), text: "x" }, 400, "invalid_session");
  await bad({ sessionId: 12, text: "x" }, 400, "invalid_session");
  await bad({ sessionId: "awa" }, 400, "invalid_text");
  await bad({ sessionId: "awa", text: 5 }, 400, "invalid_text");
  await bad({ sessionId: "awa", text: "x".repeat(501) }, 400, "invalid_text");
  await bad([], 400, "invalid_json");
  await bad(null, 400, "invalid_json");

  const notJson = await read(await turn(new Request(URL, { method: "POST", headers: { "content-type": "application/json" }, body: "{pas du json" })));
  assert.deepEqual([notJson.status, notJson.body.error], [400, "invalid_json"]);
  const wrongType = await read(await turn(new Request(URL, { method: "POST", headers: { "content-type": "text/plain" }, body: "{}" })));
  assert.deepEqual([wrongType.status, wrongType.body.error], [415, "unsupported_media_type"]);
  const huge = await read(await postJson(turn, { sessionId: "awa", text: "x", padding: "y".repeat(11_000) }));
  assert.deepEqual([huge.status, huge.body.error], [413, "too_large"]);
});

test("turn : un texte vide est accepté, l'agent redemande", async () => {
  fresh();
  assert.match((await say("")).body.reply, /pas entendu/);
});

test("turn : l'envoi d'un enregistrement audio dit clairement que la voix n'est pas encore branchée", async () => {
  fresh();
  const form = new FormData();
  form.set("sessionId", "awa");
  form.set("audio", new Blob(["x"], { type: "audio/wav" }));
  const r = await read(await turn(new Request(URL, { method: "POST", body: form })));
  assert.deepEqual([r.status, r.body.error], [501, "voice_not_available"]);
});

test("turn : sessions indépendantes", async () => {
  fresh();
  await say("Encaisse 5000 francs", "s1");
  assert.match((await say("oui", "s2")).body.reply, /rien à confirmer/);
  assert.ok((await say("oui", "s1")).body.payment);
});

test("une erreur inattendue donne un message générique, jamais le détail", async () => {
  const rt = fresh();
  replaceRuntime({ ...rt, dialog: { handleTurn: () => { throw new Error("détail interne confidentiel"); } } });
  const r = await say("bonjour");
  assert.deepEqual([r.status, r.body], [500, { error: "internal_error" }]);
  assert.ok(!r.raw.includes("confidentiel"));
});

// --- La contrainte, vue depuis les routes -----------------------------------

test("contrainte via les routes : réponse identique, phrase retirée de ce qui s'affiche, alerte chez l'analyste", async () => {
  const logged: string[] = [];
  for (const m of ["log", "info", "warn", "error", "debug"] as const) {
    mock.method(console, m, (...args: unknown[]) => { logged.push(args.map(String).join(" ")); });
  }

  fresh();
  await say("Envoie cent cinquante mille francs à Koné", "normal");
  const ok = await say("oui", "normal");
  await say("Envoie cent cinquante mille francs à Koné", "forcee");
  const duress = await say(`oui, c'est bon, ${PHRASE}`, "forcee");

  assert.equal(duress.status, 200);
  const { heard: h1, ...okBody } = ok.body;
  const { heard: h2, ...duressBody } = duress.body;
  assert.deepEqual(duressBody, okBody, "même réponse qu'un succès normal");
  assert.equal(h2, "Oui", "l'écran n'affiche pas la phrase");
  assert.equal(h1, "oui");

  const s = await getState();
  const alert = s.body.alerts.find((a: any) => a.type === "duress");
  assert.deepEqual([alert.level, alert.title], ["critical", "Contrainte signalée"]);
  assert.equal(s.body.counts.held, 1);
  assert.equal(s.body.criticalAlerts, 1);

  for (const text of [ok.raw, duress.raw, s.raw, logged.join("\n")]) assert.equal(leaks(text), false);
});

// --- /api/state -------------------------------------------------------------

test("state : l'état complet pour l'écran analyste", async () => {
  const rt = fresh();
  const s = await getState();
  assert.equal(s.status, 200);
  assert.equal(s.headers.get("cache-control"), "no-store");
  assert.deepEqual(Object.keys(s.body).sort(), [
    "alerts", "ceiling", "counts", "criticalAlerts", "demoMode", "duress", "merchant", "now", "operations", "thresholds",
  ]);
  assert.equal(s.body.now, NOON.getTime());
  assert.equal(s.body.ceiling, 200_000);
  assert.deepEqual(s.body.thresholds, { verify: 35, block: 65 });
  assert.equal(s.body.duress, "active");
  assert.equal(s.body.demoMode, true);
  assert.equal(s.body.counts.paid, 10);
  assert.equal(s.body.operations.length, 10);
  assert.deepEqual(Object.keys(s.body.merchant).sort(), ["name", "shop"], "pas de contacts ni de numéros");
  assert.ok(!s.raw.includes(rt.mock.webhookSecret), "la clé de signature ne sort jamais");
  assert.equal(leaks(s.raw), false);
});

test("state : les plus récents d'abord, limités à 40 opérations et 20 alertes", async () => {
  const rt = fresh();
  for (let i = 0; i < 60; i++) {
    rt.store.addOperation({ kind: "collect", amount: 1000 + i, status: "paid", score: 0, decision: "accept", factors: [], verifiedByVoice: false });
  }
  for (let i = 0; i < 25; i++) rt.store.addAlert({ level: "info", type: "verified", title: `alerte ${i}`, detail: "d" });
  const s = await getState();
  assert.equal(s.body.operations.length, 40);
  assert.equal(s.body.operations[0].amount, 1059, "la dernière ajoutée en premier");
  assert.equal(s.body.alerts.length, 20);
  assert.equal(s.body.alerts[0].title, "alerte 24");
  assert.equal(s.body.counts.paid, 70, "les compteurs portent sur tout, pas seulement sur la liste");
});

// --- /api/health ------------------------------------------------------------

test("health : dit ce qui est configuré, jamais les valeurs", async () => {
  const saved = process.env.AETHEX_API_KEY;
  process.env.AETHEX_API_KEY = "ae_live_valeur_secrete_de_test";
  try {
    fresh();
    const h = await read(await health());
    assert.deepEqual(h.body, { ok: true, aethex: true, duress: "active", argus: "local", voice: "aethex", demoMode: true });
    assert.ok(!h.raw.includes("ae_live_valeur_secrete_de_test"));
    assert.equal(leaks(h.raw), false);

    delete process.env.AETHEX_API_KEY;
    assert.equal((await read(await health())).body.aethex, false);
  } finally {
    if (saved === undefined) delete process.env.AETHEX_API_KEY;
    else process.env.AETHEX_API_KEY = saved;
  }
});

test("health : Argus configuré passe en mode api, sans jamais révéler l'adresse ni la clé", async () => {
  const names = ["ARGUS_URL", "ARGUS_LICENSE_KEY", "ARGUS_MODE"] as const;
  const saved = Object.fromEntries(names.map((n) => [n, process.env[n]]));
  process.env.ARGUS_URL = "http://127.0.0.1:9";
  process.env.ARGUS_LICENSE_KEY = "licence_secrete_de_test";
  delete process.env.ARGUS_MODE;
  try {
    fresh();
    const api = await read(await health());
    assert.equal(api.body.argus, "api");
    assert.ok(!api.raw.includes("licence_secrete_de_test"));
    assert.ok(!api.raw.includes("127.0.0.1"));

    process.env.ARGUS_MODE = "local";
    fresh();
    assert.equal((await read(await health())).body.argus, "local", "ARGUS_MODE=local impose le calcul local");
  } finally {
    for (const n of names) {
      if (saved[n] === undefined) delete process.env[n];
      else process.env[n] = saved[n];
    }
  }
});

test("health : état de la détection de contrainte (désactivée, faible, active)", async () => {
  fresh({ getPhrase: () => "" });
  assert.equal((await read(await health())).body.duress, "disabled");
  fresh({ getPhrase: () => "la marmite" });
  assert.equal((await read(await health())).body.duress, "weak");
  fresh();
  assert.equal((await read(await health())).body.duress, "active");
});

// --- /api/reset -------------------------------------------------------------

test("reset : refusé hors mode démonstration, rien n'est effacé", async () => {
  const rt = fresh({ demoMode: false });
  await say("Encaisse 5000 francs");
  const r = await read(await reset());
  assert.deepEqual([r.status, r.body], [403, { error: "demo_only" }]);
  assert.equal(getRuntime(), rt);
  assert.equal(getRuntime().store.operations.length, 11);
});

test("reset : remet tout à zéro en gardant les réglages (phrase, mode démo)", async () => {
  const before = fresh();
  await say("Envoie cent cinquante mille francs à Koné");
  await say(`oui ${PHRASE}`);
  await say("Encaisse 5000 francs");

  const r = await read(await reset());
  assert.deepEqual([r.status, r.body], [200, { ok: true }]);
  assert.notEqual(getRuntime(), before);

  const s = await getState();
  assert.equal(s.body.operations.length, 10);
  assert.equal(s.body.alerts.length, 0);
  assert.equal(s.body.duress, "active", "les réglages sont conservés");
  assert.match((await say("oui")).body.reply, /rien à confirmer/, "la commande en cours a disparu");

  await say("Envoie cent cinquante mille francs à Koné");
  await say(`oui ${PHRASE}`);
  assert.equal((await getState()).body.counts.held, 1, "la contrainte fonctionne encore après la remise à zéro");
});

// --- /api/paid : le client paie, le webhook est vérifié ---------------------

test("paid : le client paie, le webhook signé est vérifié, puis « Paiement reçu » est annoncé", async () => {
  fresh();
  await say("Encaisse cinq mille francs par Wave");
  const payment = (await say("oui")).body.payment;

  const r = await read(await postJson(paid, { paymentId: payment.id }));
  assert.equal(r.status, 200);
  assert.equal(r.body.reply, "Paiement reçu. 5 000 francs par Wave.");
  assert.equal(r.body.speech, "Paiement reçu. cinq mille francs par Wave.");
  assert.equal(r.body.tone, "success", "l'écran de la vendeuse affiche un succès");

  const s = await getState();
  assert.equal(s.body.counts.paid, 11);
  assert.equal(s.body.counts.awaiting_payment, 0);

  const again = await read(await postJson(paid, { paymentId: payment.id }));
  assert.deepEqual([again.status, again.body.error], [409, "already_paid"]);
});

test("paid : refusé hors démo, identifiant invalide ou inconnu, corps illisible", async () => {
  fresh({ demoMode: false });
  assert.equal((await read(await postJson(paid, { paymentId: "pr_x" }))).status, 403);

  fresh();
  const code = async (payload: unknown) => (await read(await postJson(paid, payload))).status;
  assert.equal(await code({ paymentId: "pr_inconnu" }), 404);
  assert.equal(await code({ paymentId: "a b" }), 400);
  assert.equal(await code({ paymentId: 5 }), 400);
  assert.equal(await code({}), 400);
  const wrongType = await paid(new Request(URL, { method: "POST", headers: { "content-type": "text/plain" }, body: "x" }));
  assert.equal(wrongType.status, 415);
});

test("paid : un encaissement retenu sous contrainte ne peut pas être payé", async () => {
  fresh();
  await say("Encaisse 5000 francs");
  const fake = (await say(`oui ${PHRASE}`)).body.payment;
  assert.ok(fake.id);
  assert.equal((await read(await postJson(paid, { paymentId: fake.id }))).status, 404);
  assert.equal((await getState()).body.counts.paid, 10);
});

// --- /api/webhook/jeko ------------------------------------------------------

const postWebhook = (rawBody: string, headers: Record<string, string>) =>
  webhook(new Request(URL, { method: "POST", headers, body: rawBody }));

test("webhook : un message signé par Jèko est accepté, un second envoi est signalé comme doublon", async () => {
  const rt = fresh();
  await say("Encaisse cinq mille francs par Wave");
  const payment = (await say("oui")).body.payment;
  const delivery = rt.mock.simulateClientPayment(payment.id);

  const first = await read(await postWebhook(delivery.rawBody, delivery.headers));
  assert.deepEqual([first.status, first.body], [200, { ok: true, duplicate: false }]);
  assert.equal((await getState()).body.counts.paid, 11);

  const second = await read(await postWebhook(delivery.rawBody, delivery.headers));
  assert.deepEqual([second.status, second.body], [200, { ok: true, duplicate: true }]);
  assert.equal((await getState()).body.counts.paid, 11);
});

test("webhook : signature fausse ou corps modifié, refusé avec une alerte", async () => {
  const rt = fresh();
  await say("Encaisse cinq mille francs par Wave");
  const payment = (await say("oui")).body.payment;
  const delivery = rt.mock.simulateClientPayment(payment.id);

  const tampered = delivery.rawBody.replace('"amount":5000', '"amount":50');
  const r = await read(await postWebhook(tampered, delivery.headers));
  assert.deepEqual([r.status, r.body], [401, { ok: false, reason: "bad_signature" }]);

  const none = { ...delivery.headers };
  delete none["Jeko-Signature"];
  assert.equal((await read(await postWebhook(delivery.rawBody, none))).status, 401);

  const s = await getState();
  assert.equal(s.body.counts.awaiting_payment, 1);
  assert.ok(s.body.alerts.some((a: any) => a.type === "webhook" && a.level === "warning"));
});

test("webhook : le corps est lu tel quel, caractère pour caractère (espaces et accents compris)", async () => {
  const rt = fresh();
  await say("Encaisse cinq mille francs par Wave");
  const payment = (await say("oui")).body.payment;
  const payload = JSON.parse(rt.mock.simulateClientPayment(payment.id).rawBody);
  payload.counterpartLabel = "Aïssata Koné  (client)";
  const rawBody = JSON.stringify(payload, null, 2);
  const headers = {
    "content-type": "application/json",
    "jeko-event": "TRANSACTION_COMPLETED",
    "jeko-signature": signBody(rawBody, SECRET),
    "jeko-webhook-version": "1",
  };
  assert.equal((await postWebhook(`${rawBody} `, headers)).status, 401, "un espace de plus invalide la signature");
  assert.equal((await read(await postWebhook(rawBody, headers))).status, 200);
});

test("webhook : un corps trop gros est refusé avant tout traitement", async () => {
  fresh();
  const r = await read(await postWebhook("x".repeat(70_000), {}));
  assert.deepEqual([r.status, r.body.error], [413, "too_large"]);
});

// --- Assemblage -------------------------------------------------------------

test("runtime : une seule instance partagée, remise à zéro avec les mêmes réglages", () => {
  const rt = fresh();
  assert.equal(getRuntime(), rt);
  assert.equal(getRuntime(), getRuntime());
  const next = resetRuntime();
  assert.notEqual(next, rt);
  assert.equal(getRuntime(), next);
  assert.equal(next.options, rt.options);
  assert.notEqual(next.store, rt.store);
});

test("runtime : sans clé configurée, chaque démarrage a sa propre clé de signature aléatoire", () => {
  const saved = process.env.JEKO_WEBHOOK_SECRET;
  delete process.env.JEKO_WEBHOOK_SECRET;
  try {
    const a = createRuntime().mock.webhookSecret;
    const b = createRuntime().mock.webhookSecret;
    assert.match(a, /^[0-9a-f]{64}$/);
    assert.notEqual(a, b);
  } finally {
    if (saved !== undefined) process.env.JEKO_WEBHOOK_SECRET = saved;
  }
});

// --- La démonstration de bout en bout ---------------------------------------

test("démo complète par les routes : encaisser, contrainte, refus, support", async () => {
  fresh();

  // 1. Encaissement de 5 000 francs, le client paie, la voix annonce le paiement.
  assert.equal((await say("Encaisse cinq mille francs par Wave")).body.awaitingConfirm, true);
  const payment = (await say("oui")).body.payment;
  assert.equal((await read(await postJson(paid, { paymentId: payment.id }))).body.reply, "Paiement reçu. 5 000 francs par Wave.");

  // 2. Transfert de 150 000 francs : vérification parlée, puis la phrase secrète.
  const ask = await say("Envoie cent cinquante mille francs à Koné");
  assert.match(ask.body.reply, /^Attention\./);
  assert.match(ask.body.reply, /nouveau numéro/);
  const forced = await say(`Oui, c'est bon, ${PHRASE}`);
  assert.equal(forced.body.reply, "C'est envoyé. 150 000 francs à Koné.");
  assert.equal(forced.body.heard, "Oui");

  // 3. Le grand écran : la bannière « Contrainte signalée », le score et ses raisons, aucun transfert.
  const s = await getState();
  const alert = s.body.alerts.find((a: any) => a.level === "critical");
  assert.equal(alert.title, "Contrainte signalée");
  assert.equal(alert.score, 60);
  assert.ok(alert.factors.length >= 3);
  assert.equal(getRuntime().mock.listTransfers().length, 0, "aucune somme n'est partie");

  // 4. Transfert de 250 000 francs : refus poli et alerte de rappel.
  assert.match((await say("Envoie deux cent cinquante mille francs à Koné")).body.reply, /Un conseiller Jèko va te rappeler/);
  const after = await getState();
  assert.equal(after.body.counts.blocked, 1);
  assert.ok(after.body.alerts.some((a: any) => a.type === "blocked"));

  // 5. Question de support.
  assert.match((await say("J'ai atteint la limite de 200 000, comment augmenter mon plafond ?")).body.reply, /conseiller Jèko/);

  // La phrase secrète n'apparaît nulle part dans l'état final.
  assert.equal(leaks(after.raw), false);
});
