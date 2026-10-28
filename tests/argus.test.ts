import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { createDialog } from "../src/lib/dialog";
import type { Cashier, RiskRequest } from "../src/lib/ports";
import { ArgusError, CLIENT_ACCOUNT_ID, createArgusRisk, describeArgusFailure, withFallback } from "../src/lib/riskArgus";
import { createLocalRisk } from "../src/lib/riskLocal";
import { createRuntime } from "../src/lib/runtime";
import { Store } from "../src/lib/store";

const KEY = "K-licence-secrete-123";
const NOON = new Date(Date.UTC(2026, 9, 27, 12, 0, 0));

// --- Un vrai serveur HTTP local qui joue Argus --------------------------------

interface Seen {
  method: string;
  url: string;
  headers: IncomingMessage["headers"];
  body: any;
}
interface Reply {
  status?: number;
  body?: unknown;
  raw?: string;
  delayMs?: number;
}

const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (closers.length) await closers.pop()!();
});

function fakeArgus(handler: (seen: Seen, count: number) => Reply = () => ({ body: decision("ALLOW", { risk_score: 5 }) })) {
  const seen: Seen[] = [];
  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      let body: any;
      try {
        body = JSON.parse(raw);
      } catch {
        body = undefined;
      }
      const entry: Seen = { method: req.method ?? "", url: req.url ?? "", headers: req.headers, body };
      seen.push(entry);
      const reply = handler(entry, seen.length);
      const send = () => {
        res.writeHead(reply.status ?? 200, { "content-type": "application/json" });
        res.end(reply.raw ?? JSON.stringify(reply.body ?? {}));
      };
      if (reply.delayMs) setTimeout(send, reply.delayMs);
      else send();
    });
  });
  return new Promise<{ url: string; seen: Seen[] }>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      closers.push(
        () =>
          new Promise<void>((done) => {
            server.closeAllConnections?.();
            server.close(() => done());
          }),
      );
      resolve({ url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, seen });
    });
  });
}

const FACTORS = [
  { feature_name: "amount_zscore_30d", feature_value: 4.7, impact: 12.3, rank: 1, label: "Montant très supérieur à l'habitude du compte" },
  { feature_name: "new_beneficiary", feature_value: 1, impact: 8.6, rank: 2, label: "Bénéficiaire jamais vu" },
];

const decision = (d: string, extra: Record<string, unknown> = {}) => ({
  id: "6f1c0b3a-1e2d-4c5f-9a8b-7c6d5e4f3a2b",
  transaction_id: "x",
  decision: d,
  risk_score: 72.4,
  decision_reason: "Montant inhabituel vers un bénéficiaire jamais vu en 90 jours.",
  model_version: "2026.08.1",
  processing_time_ms: 120,
  factors: FACTORS,
  ...extra,
});

const send = (over: Partial<RiskRequest> = {}): RiskRequest => ({
  kind: "send", amount: 150_000, beneficiaryAccount: "nom:kone", beneficiaryKnown: false, avgTicket: 4500, previousOps: 0, now: NOON, ...over,
});

const client = (url: string, over: Partial<Parameters<typeof createArgusRisk>[0]> = {}) =>
  createArgusRisk({ baseUrl: url, licenseKey: KEY, senderAccountId: "awa-1", deviceId: "dev-1", timeoutMs: 1500, ...over });

const failureOf = (promise: Promise<unknown>) =>
  promise.then(
    () => undefined,
    (e: unknown) => e as ArgusError,
  );

// --- Le contrat de l'appel ----------------------------------------------------

test("appel : POST /v1/transactions/score avec la clé de licence et les champs bruts d'un transfert", async () => {
  const argus = await fakeArgus();
  await client(argus.url).assess(send({ beneficiaryAccount: "0100000099" }));

  const call = argus.seen[0];
  assert.equal(call.method, "POST");
  assert.equal(call.url, "/v1/transactions/score");
  assert.equal(call.headers["x-license-key"], KEY);
  assert.match(String(call.headers["content-type"]), /application\/json/);
  assert.deepEqual(Object.keys(call.body).sort(), [
    "amount", "beneficiary_account_id", "currency", "device_id", "sender_account_id", "timestamp",
    "transaction_channel", "transaction_id", "transaction_type",
  ]);
  assert.equal(call.body.sender_account_id, "awa-1");
  assert.equal(call.body.beneficiary_account_id, "0100000099");
  assert.equal(call.body.amount, 150_000);
  assert.equal(call.body.currency, "XOF");
  assert.equal(call.body.timestamp, NOON.toISOString());
  assert.equal(call.body.transaction_channel, "app");
  assert.equal(call.body.transaction_type, "transfer");
  assert.equal(call.body.device_id, "dev-1");
});

test("appel : un encaissement est un cash_in, du client vers le compte d'Awa", async () => {
  const argus = await fakeArgus();
  await client(argus.url).assess(send({ kind: "collect", amount: 5000 }));
  const body = argus.seen[0].body;
  assert.equal(body.transaction_type, "cash_in");
  assert.equal(body.sender_account_id, CLIENT_ACCOUNT_ID);
  assert.equal(body.beneficiary_account_id, "awa-1");
  assert.equal(body.amount, 5000);
});

test("appel : un identifiant unique par tentative (Argus est idempotent, un rejeu donnerait 409)", async () => {
  const argus = await fakeArgus();
  const risk = client(argus.url);
  for (let i = 0; i < 4; i++) await risk.assess(send());
  const ids = argus.seen.map((s) => s.body.transaction_id as string);
  assert.equal(new Set(ids).size, 4);
  assert.ok(ids.every((id) => id.startsWith("VOIX-") && id.length <= 128));
});

test("appel : l'adresse peut avoir une barre finale ou un préfixe", async () => {
  const argus = await fakeArgus();
  await client(`${argus.url}/`).assess(send());
  await client(`${argus.url}/api/`).assess(send());
  assert.deepEqual(argus.seen.map((s) => s.url), ["/v1/transactions/score", "/api/v1/transactions/score"]);
});

test("création : adresse ou clé invalides refusées sans jamais répéter la clé", () => {
  assert.throws(() => createArgusRisk({ baseUrl: "pas une url", licenseKey: KEY, senderAccountId: "a", deviceId: "d" }), /Adresse d'Argus invalide/);
  assert.throws(() => createArgusRisk({ baseUrl: "ftp://exemple.invalid", licenseKey: KEY, senderAccountId: "a", deviceId: "d" }), /Adresse d'Argus invalide/);
  assert.throws(() => createArgusRisk({ baseUrl: "http://localhost:4040", licenseKey: "", senderAccountId: "a", deviceId: "d" }), /Clé de licence Argus manquante/);
});

// --- La réponse ---------------------------------------------------------------

test("réponse : les quatre décisions d'Argus, QUARANTINE comme BLOCK (décision D1)", async () => {
  for (const [argusDecision, ours] of [["ALLOW", "accept"], ["VERIFY", "verify"], ["QUARANTINE", "block"], ["BLOCK", "block"]] as const) {
    const argus = await fakeArgus(() => ({ body: decision(argusDecision) }));
    const a = await client(argus.url).assess(send());
    assert.equal(a.decision, ours, argusDecision);
    assert.equal(a.source, "argus");
  }
});

test("réponse : score arrondi et borné, raison, version du modèle", async () => {
  const argus = await fakeArgus((_s, n) => ({ body: n === 1 ? decision("VERIFY") : n === 2 ? decision("BLOCK", { risk_score: 150 }) : decision("ALLOW", { risk_score: -5 }) }));
  const risk = client(argus.url);
  const a = await risk.assess(send());
  assert.equal(a.score, 72);
  assert.equal(a.decisionReason, "Montant inhabituel vers un bénéficiaire jamais vu en 90 jours.");
  assert.equal(a.modelVersion, "2026.08.1");
  assert.equal((await risk.assess(send())).score, 100);
  assert.equal((await risk.assess(send())).score, 0);
});

test("réponse : les facteurs gardent leur libellé, leurs points arrondis et leur rang", async () => {
  const argus = await fakeArgus(() => ({ body: decision("VERIFY") }));
  const a = await client(argus.url).assess(send());
  assert.deepEqual(a.factors, [
    { id: "amount_zscore_30d", label: "Montant très supérieur à l'habitude du compte", points: 12, detail: "Valeur : 4.7" },
    { id: "new_beneficiary", label: "Bénéficiaire jamais vu", points: 9, detail: "Valeur : 1" },
  ]);
});

test("réponse : seuls les facteurs qui aggravent le risque comptent, triés par rang, six au plus", async () => {
  const many = Array.from({ length: 9 }, (_v, i) => ({ feature_name: `f${i}`, feature_value: i, impact: 10 - i * 0.1, rank: 9 - i, label: `Facteur ${i}` }));
  const noisy = [
    { feature_name: "negatif", feature_value: 0, impact: -4, rank: 1 },
    { feature_name: "quasi_nul", feature_value: 0, impact: 0.2, rank: 2 },
    { impact: 5, rank: 3 },
    { feature_name: "sans_libelle", feature_value: "x", impact: 3, rank: 0 },
  ];
  const argus = await fakeArgus((_s, n) => ({ body: decision("VERIFY", { factors: n === 1 ? many : noisy }) }));
  const risk = client(argus.url);
  const a = await risk.assess(send());
  assert.equal(a.factors.length, 6);
  assert.deepEqual(a.factors.map((f) => f.id), ["f8", "f7", "f6", "f5", "f4", "f3"], "rang 1 en premier");
  const b = await risk.assess(send());
  assert.deepEqual(b.factors, [{ id: "sans_libelle", label: "sans_libelle", points: 3, detail: "Valeur : x" }]);
});

test("réponse : sans facteurs ni raison, l'examen reste valable", async () => {
  const argus = await fakeArgus(() => ({ body: { decision: "ALLOW", risk_score: 3 } }));
  const a = await client(argus.url).assess(send());
  assert.deepEqual(a, { score: 3, decision: "accept", factors: [], source: "argus" });
});

test("repli fail-closed d'Argus (moteur ML en panne) : réponse 200 en QUARANTINE, traitée comme un refus", async () => {
  const argus = await fakeArgus(() => ({ body: decision("QUARANTINE", { ml_score: null, model_version: "fail-closed", risk_score: 60 }) }));
  const a = await client(argus.url).assess(send({ kind: "collect", amount: 5000 }));
  assert.equal(a.decision, "block");
  assert.equal(a.modelVersion, "fail-closed");
});

// --- Les pannes ---------------------------------------------------------------

test("réponses illisibles : décision inconnue, score absent ou faux, corps vide ou pas du JSON", async () => {
  const bodies: Reply[] = [
    { body: decision("MAYBE") },
    { body: { decision: "ALLOW" } },
    { body: { decision: "ALLOW", risk_score: "haut" } },
    { body: { decision: "ALLOW", risk_score: null } },
    { raw: "pas du json" },
    { raw: "null" },
    { raw: "[]" },
    { body: {} },
  ];
  const argus = await fakeArgus((_s, n) => bodies[n - 1]);
  const risk = client(argus.url);
  for (let i = 0; i < bodies.length; i++) {
    const error = await failureOf(risk.assess(send()));
    assert.ok(error instanceof ArgusError, `cas ${i}`);
    assert.equal(error.kind, "invalid", `cas ${i}`);
  }
});

test("codes HTTP d'erreur : licence refusée, doublon, panne", async () => {
  const argus = await fakeArgus((_s, n) => ({ status: [401, 409, 500][n - 1], body: { code: "ERREUR" } }));
  const risk = client(argus.url);
  for (const status of [401, 409, 500]) {
    const error = await failureOf(risk.assess(send()));
    assert.ok(error instanceof ArgusError);
    assert.deepEqual([error.kind, error.status], ["http", status]);
  }
});

test("délai dépassé : l'appel est coupé au bout du délai prévu", async () => {
  const argus = await fakeArgus(() => ({ body: decision("ALLOW"), delayMs: 1500 }));
  const started = Date.now();
  const error = await failureOf(client(argus.url, { timeoutMs: 120 }).assess(send()));
  assert.ok(error instanceof ArgusError);
  assert.equal(error.kind, "timeout");
  assert.ok(Date.now() - started < 1000, "pas d'attente jusqu'à la réponse tardive");
});

test("serveur éteint : Argus injoignable", async () => {
  const error = await failureOf(client("http://127.0.0.1:1").assess(send()));
  assert.ok(error instanceof ArgusError);
  assert.equal(error.kind, "network");
});

test("les erreurs ne contiennent ni la clé de licence ni l'adresse d'Argus", async () => {
  const argus = await fakeArgus((_s, n) => ({ status: n === 1 ? 401 : 200, raw: n === 1 ? "{}" : "illisible", delayMs: n === 3 ? 800 : 0 }));
  const errors = [
    await failureOf(client(argus.url).assess(send())),
    await failureOf(client(argus.url).assess(send())),
    await failureOf(client(argus.url, { timeoutMs: 100 }).assess(send())),
    await failureOf(client("http://127.0.0.1:1").assess(send())),
  ];
  for (const error of errors) {
    assert.ok(error);
    const text = `${error.message} ${error.stack?.split("\n")[0]} ${describeArgusFailure(error)}`;
    assert.ok(!text.includes(KEY), "la clé");
    assert.ok(!text.includes("127.0.0.1"), "l'adresse");
  }
});

test("pourquoi on est passé au secours : phrases sans détail sensible", () => {
  assert.equal(describeArgusFailure(new ArgusError("timeout", "x")), "Argus n'a pas répondu à temps");
  assert.equal(describeArgusFailure(new ArgusError("http", "x", 401)), "Argus a refusé la demande (code 401)");
  assert.equal(describeArgusFailure(new ArgusError("invalid", "x")), "Argus a renvoyé une réponse illisible");
  assert.equal(describeArgusFailure(new ArgusError("network", "x")), "Argus est injoignable");
  assert.equal(describeArgusFailure(new Error("autre")), "Argus est injoignable");
});

// --- Le secours local ---------------------------------------------------------

test("secours : si Argus répond, sa réponse est gardée et personne n'est prévenu", async () => {
  const argus = await fakeArgus(() => ({ body: decision("VERIFY") }));
  const reasons: string[] = [];
  const risk = withFallback(client(argus.url), createLocalRisk(), (r) => reasons.push(r));
  const a = await risk.assess(send());
  assert.deepEqual([a.source, a.decision, a.degraded], ["argus", "verify", undefined]);
  assert.deepEqual(reasons, []);
});

test("secours : si Argus échoue, le calcul local prend le relais, marqué dégradé, et on est prévenu une fois", async () => {
  const reasons: string[] = [];
  const risk = withFallback(client("http://127.0.0.1:1"), createLocalRisk(), (r) => reasons.push(r));
  const a = await risk.assess(send());
  const local = createLocalRisk().assess(send());
  assert.deepEqual([a.source, a.degraded], ["local", true]);
  assert.deepEqual([a.score, a.decision, a.factors], [local.score, local.decision, local.factors]);
  assert.deepEqual(reasons, ["Argus est injoignable"]);
  assert.ok(!reasons.join().includes(KEY));
});

// --- Le dialogue avec Argus ---------------------------------------------------

function dialogWith(url: string, over: Partial<Parameters<typeof createArgusRisk>[0]> = {}) {
  const store = new Store(() => NOON);
  const calls = { collect: [] as unknown[], transfer: [] as Array<{ amount: number; to: string }> };
  const cashier: Cashier = {
    createPaymentRequest: (a) => (calls.collect.push(a), { id: "pr_1" }),
    createTransfer: (a) => (calls.transfer.push(a), { id: "tr_1" }),
  };
  const dialog = createDialog({ store, cashier, risk: client(url, over) });
  return { store, calls, say: (text: string, sid = "s") => dialog.handleTurn(sid, text), last: () => store.operations.at(-1)! };
}

test("dialogue : le doute d'Argus est dit à voix haute, avec sa raison, avant le oui", async () => {
  const argus = await fakeArgus(() => ({ body: decision("VERIFY") }));
  const { say, calls, last } = dialogWith(argus.url);

  const ask = await say("Envoie cent cinquante mille francs à Koné");
  assert.equal(ask.tone, "verify");
  assert.equal(ask.awaitingConfirm, true);
  assert.equal(ask.reply, "Attention. Montant inhabituel vers un bénéficiaire jamais vu en 90 jours. Tu envoies 150 000 francs à Koné. C'est bien toi qui décides ?");
  assert.deepEqual([last().riskSource, last().modelVersion, last().score, last().decision], ["argus", "2026.08.1", 72, "verify"]);
  assert.equal(last().factors.length, 2);
  assert.equal(calls.transfer.length, 0, "rien ne part avant le oui");

  assert.equal((await say("oui")).reply, "C'est envoyé. 150 000 francs à Koné.");
  assert.deepEqual(calls.transfer, [{ amount: 150_000, to: "Koné" }]);
});

test("dialogue : la décision d'Argus l'emporte sur le calcul local", async () => {
  const block = await fakeArgus(() => ({ body: decision("BLOCK") }));
  const a = dialogWith(block.url);
  const refused = await a.say("Envoie 5000 à Fatou");
  assert.equal(refused.tone, "refusal");
  assert.equal(a.last().status, "blocked");
  assert.equal(a.store.alerts.at(-1)!.type, "blocked");
  assert.match((await a.say("oui")).reply, /rien à confirmer/);
  assert.equal(a.calls.transfer.length, 0);

  const allow = await fakeArgus(() => ({ body: decision("ALLOW", { risk_score: 4 }) }));
  const b = dialogWith(allow.url);
  const ok = await b.say("Envoie deux cent cinquante mille francs à Koné");
  assert.equal(ok.tone, "ask", "le calcul local aurait bloqué : Argus décide");
  assert.equal(ok.awaitingConfirm, true);
});

test("dialogue : toutes les opérations sont envoyées à Argus, avec le bon compte bénéficiaire", async () => {
  const argus = await fakeArgus();
  const { say } = dialogWith(argus.url);
  await say("Envoie 5000 à Fatou");
  await say("non");
  await say("Envoie 5000 à Koné");
  await say("non");
  await say("Envoie 5000 au 07 01 02 03 04");
  await say("non");
  await say("Encaisse 5000 francs par Wave");

  const [fatou, kone, phone, collect] = argus.seen.map((s) => s.body);
  assert.equal(fatou.beneficiary_account_id, "0100000001", "un contact connu garde son numéro");
  assert.equal(kone.beneficiary_account_id, "nom:kone", "un nom inconnu donne toujours le même compte");
  assert.equal(phone.beneficiary_account_id, "0701020304");
  assert.deepEqual([collect.transaction_type, collect.sender_account_id], ["cash_in", CLIENT_ACCOUNT_ID]);
  assert.equal(argus.seen.length, 4);
});

test("dialogue : les tours d'une même session s'enchaînent, un oui n'arrive jamais avant la fin de l'examen", async () => {
  const argus = await fakeArgus(() => ({ body: decision("VERIFY"), delayMs: 150 }));
  const { say, calls } = dialogWith(argus.url);

  const [ask, confirm] = await Promise.all([say("Envoie dix mille francs à Koné"), say("oui")]);
  assert.equal(ask.awaitingConfirm, true);
  assert.equal(confirm.tone, "success", "le oui est traité après l'examen, pas avant");
  assert.equal(calls.transfer.length, 1, "une seule exécution");
  assert.equal(argus.seen.length, 1);
});

test("dialogue : deux sessions ne se mélangent pas", async () => {
  const argus = await fakeArgus(() => ({ body: decision("ALLOW", { risk_score: 4 }), delayMs: 80 }));
  const { say, calls } = dialogWith(argus.url);
  const [a, b] = await Promise.all([say("Envoie 5000 à Fatou", "s1"), say("Envoie 6000 à Fatou", "s2")]);
  assert.match(a.reply, /5 000 francs/);
  assert.match(b.reply, /6 000 francs/);
  assert.match((await say("oui", "s3")).reply, /rien à confirmer/);
  await say("oui", "s1");
  assert.deepEqual(calls.transfer, [{ amount: 5000, to: "Fatou" }]);
});

test("dialogue : sans moteur imposé il reste synchrone, comme avant", () => {
  const store = new Store(() => NOON);
  const cashier: Cashier = { createPaymentRequest: () => ({ id: "pr" }), createTransfer: () => ({ id: "tr" }) };
  const result = createDialog({ store, cashier }).handleTurn("s", "bonjour");
  assert.ok(!(result instanceof Promise));
  assert.equal(result.tone, "info");
});

// --- Le mode dégradé dans l'application ---------------------------------------

test("application : Argus injoignable, le calcul local prend le relais et Karim est prévenu une fois par minute", async () => {
  let now = NOON;
  const rt = createRuntime({
    clock: () => now,
    getPhrase: () => "",
    demoMode: true,
    argus: { mode: "api", url: "http://127.0.0.1:1", licenseKey: KEY, senderAccountId: "awa-1", deviceId: "dev-1", timeoutMs: 300 },
  });
  assert.equal(rt.riskMode, "api");

  const first = await rt.dialog.handleTurn("s", "Encaisse cinq mille francs par Wave");
  assert.equal(first.awaitingConfirm, true, "le service continue");
  const op = rt.store.operations.at(-1)!;
  assert.deepEqual([op.riskSource, op.degraded, op.status], ["local", true, "to_confirm"]);
  assert.deepEqual(rt.store.alerts.map((a) => [a.type, a.level]), [["degraded", "warning"]]);
  assert.match(rt.store.alerts[0].detail, /Argus est injoignable/);

  await rt.dialog.handleTurn("s", "en fait encaisse 6000 francs");
  assert.equal(rt.store.alerts.filter((a) => a.type === "degraded").length, 1, "pas d'inondation d'alertes");

  now = new Date(NOON.getTime() + 61_000);
  await rt.dialog.handleTurn("s", "en fait encaisse 7000 francs");
  assert.equal(rt.store.alerts.filter((a) => a.type === "degraded").length, 2, "une nouvelle alerte après une minute");

  const dump = JSON.stringify({ operations: rt.store.operations, alerts: rt.store.alerts });
  assert.ok(!dump.includes(KEY), "la clé n'est nulle part dans l'état");
  assert.ok(!dump.includes("127.0.0.1"));
});

test("application : avec Argus qui répond, aucune alerte de mode dégradé", async () => {
  const argus = await fakeArgus(() => ({ body: decision("ALLOW", { risk_score: 4 }) }));
  const rt = createRuntime({
    clock: () => NOON, getPhrase: () => "", demoMode: true,
    argus: { mode: "api", url: argus.url, licenseKey: KEY, senderAccountId: "awa-1", deviceId: "dev-1", timeoutMs: 1500 },
  });
  await rt.dialog.handleTurn("s", "Encaisse cinq mille francs par Wave");
  assert.deepEqual([rt.store.operations.at(-1)!.riskSource, rt.store.operations.at(-1)!.degraded], ["argus", undefined]);
  assert.equal(rt.store.alerts.length, 0);
});

test("application : en mode local, le dialogue est synchrone et Argus n'est jamais appelé", async () => {
  const argus = await fakeArgus();
  const rt = createRuntime({
    clock: () => NOON, getPhrase: () => "", demoMode: true,
    argus: { mode: "local", url: argus.url, licenseKey: KEY, senderAccountId: "awa-1", deviceId: "dev-1", timeoutMs: 1500 },
  });
  assert.equal(rt.riskMode, "local");
  const result = rt.dialog.handleTurn("s", "Encaisse cinq mille francs par Wave");
  assert.ok(!(result instanceof Promise));
  assert.equal(argus.seen.length, 0);
});

test("application : la contrainte fonctionne avec Argus, et Argus n'apprend jamais la phrase", async () => {
  const phrase = "le manioc cuit doucement";
  const argus = await fakeArgus(() => ({ body: decision("VERIFY") }));
  const rt = createRuntime({
    clock: () => NOON, getPhrase: () => phrase, demoMode: true,
    argus: { mode: "api", url: argus.url, licenseKey: KEY, senderAccountId: "awa-1", deviceId: "dev-1", timeoutMs: 1500 },
  });
  await rt.dialog.handleTurn("s", "Envoie cent cinquante mille francs à Koné");
  const forced = await rt.dialog.handleTurn("s", `oui, c'est bon, ${phrase}`);
  assert.equal(forced.reply, "C'est envoyé. 150 000 francs à Koné.");
  assert.equal(rt.store.operations.at(-1)!.status, "held");
  assert.equal(rt.store.alerts.at(-1)!.title, "Contrainte signalée");
  assert.equal(rt.mock.listTransfers().length, 0, "aucune somme n'est partie");
  assert.ok(!JSON.stringify(argus.seen).toLowerCase().includes("manioc"), "Argus ne reçoit jamais ce que dit la vendeuse");
});
