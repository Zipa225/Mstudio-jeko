import test, { afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { GET as health } from "../src/app/api/health/route";
import { POST as paid } from "../src/app/api/paid/route";
import { GET as payment } from "../src/app/api/payment/route";
import { POST as turn } from "../src/app/api/turn/route";
import { POST as webhook } from "../src/app/api/webhook/jeko/route";
import { canSimulateClientPayment, jekoModeFrom, payLink } from "../src/app/marchand/view";
import { loadConfig, type JekoConfig } from "../src/lib/config";
import {
  createJekoLive, DEFAULT_WALLET, describeJekoFailure, JekoHttpError, MIN_LIVE_AMOUNT,
} from "../src/lib/jekoLive";
import { signBody, type TransactionCompletedPayload } from "../src/lib/jekoWebhook";
import { createRuntime, replaceRuntime, type RuntimeOptions } from "../src/lib/runtime";
import { normalize, phraseKeywords } from "../src/lib/text";

// Fausses clés de TEST : jamais de vraies clés.
const KEY = "jk_test_cle_factice_0123456789";
const KEY_ID = "jk_test_id_factice_abcdef";
const SECRET = "secret-webhook-de-test";
const STORE = "store-de-test";
const PUBLIC_URL = "https://demo.example.org";
const PHRASE = "le manioc cuit doucement";
const LEAK_KEYS = phraseKeywords(PHRASE).filter((k) => k.length >= 6);
const leaks = (s: string) => LEAK_KEYS.some((k) => normalize(s).includes(k));
const NOON = new Date(Date.UTC(2026, 9, 27, 12, 0, 0));
const URL_ = "http://localhost/api/x";

interface Recorded {
  method: string;
  url: string;
  headers: IncomingMessage["headers"];
  body: Buffer;
  json?: any;
}
type Handler = (req: Recorded, res: ServerResponse) => void;

const servers: Server[] = [];

async function fake(handler: Handler) {
  const requests: Recorded[] = [];
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const body = Buffer.concat(chunks);
      let json: any;
      try {
        json = JSON.parse(body.toString());
      } catch {
        json = undefined;
      }
      const recorded: Recorded = { method: req.method ?? "", url: req.url ?? "", headers: req.headers, body, json };
      requests.push(recorded);
      handler(recorded, res);
    });
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, requests };
}

afterEach(async () => {
  mock.restoreAll();
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

const sendJson = (res: ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(typeof body === "string" ? body : JSON.stringify(body));
};

/** Un faux Jèko qui accepte les demandes de paiement et renvoie un lien https. */
const accepting: Handler = (req, res) =>
  sendJson(res, 200, { id: "jeko-interne", reference: req.json?.reference, redirectUrl: "https://pay.jeko.africa/checkout/a1b2c3d4e5f6" });

const own = async <T>(p: Promise<T>) => p.then(() => undefined, (e: unknown) => e);

function client(url: string, extra: Partial<Parameters<typeof createJekoLive>[0]> = {}) {
  return createJekoLive({ baseUrl: url, apiKey: KEY, apiKeyId: KEY_ID, storeId: STORE, publicBaseUrl: PUBLIC_URL, ...extra });
}

// --- Le client -------------------------------------------------------------------------

test("demande de paiement : POST /partner_api/payment_requests, en-têtes, corps au format de Jèko", async () => {
  const { url, requests } = await fake(accepting);
  const launched = await client(url, { newReference: () => "pr_abcd1234" }).createPaymentRequest({ amount: 5000, wallet: "orange" });

  assert.deepEqual(launched, { id: "pr_abcd1234", payUrl: "https://pay.jeko.africa/checkout/a1b2c3d4e5f6" });
  assert.equal(requests.length, 1);
  const [req] = requests;
  assert.equal(req.method, "POST");
  assert.equal(req.url, "/partner_api/payment_requests");
  assert.equal(req.headers["x-api-key"], KEY);
  assert.equal(req.headers["x-api-key-id"], KEY_ID);
  assert.match(String(req.headers["content-type"]), /^application\/json/);
  assert.deepEqual(req.json, {
    storeId: STORE,
    amountCents: 500_000,
    currency: "XOF",
    reference: "pr_abcd1234",
    paymentDetails: {
      type: "redirect",
      data: { paymentMethod: "orange", successUrl: `${PUBLIC_URL}/?paiement=ok`, errorUrl: `${PUBLIC_URL}/?paiement=erreur` },
    },
  });
});

test("demande de paiement : sans moyen précisé, Wave ; chaque demande a sa référence", async () => {
  const { url, requests } = await fake(accepting);
  const jeko = client(url);
  const a = await jeko.createPaymentRequest({ amount: 5 });
  const b = await jeko.createPaymentRequest({ amount: 5 });
  assert.equal(DEFAULT_WALLET, "wave");
  assert.equal(requests[0].json.paymentDetails.data.paymentMethod, "wave");
  assert.equal(requests[0].json.amountCents, 500, "5 FCFA = 500 centimes, le minimum");
  assert.match(a.id, /^pr_[0-9a-f]{8}$/);
  assert.notEqual(a.id, b.id);
  assert.equal(requests[0].json.reference, a.id);
});

test("demande de paiement : l'adresse de Jèko peut avoir un chemin et une barre finale", async () => {
  const { url, requests } = await fake(accepting);
  await client(`${url}/v1/`).createPaymentRequest({ amount: 100 });
  assert.equal(requests[0].url, "/v1/partner_api/payment_requests");
});

test("demande de paiement : montants refusés avant tout envoi", async () => {
  const { url, requests } = await fake(accepting);
  const jeko = client(url);
  for (const amount of [0, -5, 4, 4.99, 12.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    const error = await own(jeko.createPaymentRequest({ amount }));
    assert.ok(error instanceof JekoHttpError, String(amount));
    assert.equal(error.kind, "rejected");
  }
  assert.equal(MIN_LIVE_AMOUNT, 5);
  assert.equal(requests.length, 0, "rien n'est parti vers Jèko");
});

test("demande de paiement : erreurs de Jèko typées, sans la clé", async () => {
  for (const status of [400, 401, 403, 404, 422, 429, 500, 503]) {
    const { url } = await fake((_req, res) => sendJson(res, status, { message: `refus ${KEY} ${KEY_ID}` }));
    const error = await own(client(url).createPaymentRequest({ amount: 1000 }));
    assert.ok(error instanceof JekoHttpError, `statut ${status}`);
    assert.equal(error.kind, "http");
    assert.equal(error.status, status);
    for (const text of [error.message, describeJekoFailure(error)]) {
      assert.ok(!text.includes(KEY) && !text.includes(KEY_ID));
    }
  }
});

test("demande de paiement : réponse sans lien https utilisable", async () => {
  const bodies = [
    "pas du json", "null", "{}", JSON.stringify({ redirectUrl: 12 }), JSON.stringify({ redirectUrl: "pas une adresse" }),
    JSON.stringify({ redirectUrl: "http://pay.jeko.africa/x" }), JSON.stringify({ redirectUrl: "javascript:alert(1)" }),
    JSON.stringify({ redirectUrl: "data:text/html,<script>1</script>" }),
  ];
  for (const body of bodies) {
    const { url } = await fake((_req, res) => sendJson(res, 200, body));
    const error = await own(client(url).createPaymentRequest({ amount: 1000 }));
    assert.ok(error instanceof JekoHttpError, body);
    assert.equal(error.kind, "invalid", body);
  }
});

test("demande de paiement : délai dépassé, serveur injoignable", async () => {
  const slow = await fake(() => undefined); // ne répond jamais
  const timeout = await own(client(slow.url, { timeoutMs: 150 }).createPaymentRequest({ amount: 1000 }));
  assert.ok(timeout instanceof JekoHttpError);
  assert.equal(timeout.kind, "timeout");
  assert.equal(describeJekoFailure(timeout), "Jèko n'a pas répondu à temps");

  const closed = await fake(accepting);
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  const network = await own(client(closed.url).createPaymentRequest({ amount: 1000 }));
  assert.ok(network instanceof JekoHttpError);
  assert.equal(network.kind, "network");
  assert.ok(!network.message.includes(KEY));
});

test("transferts : simulés, aucun appel à Jèko, aucun argent ne bouge", async () => {
  const { url, requests } = await fake(accepting);
  const transfer = await client(url).createTransfer({ amount: 5000, to: "Fatou" });
  assert.match(transfer.id, /^tr_[0-9a-f]{8}$/);
  assert.equal(requests.length, 0);
});

test("lien factice : même forme qu'un vrai lien, mais différent", async () => {
  const { url } = await fake(accepting);
  const jeko = client(url);
  const before = new URL(jeko.decoyPayUrl!("pr_12345678"));
  assert.equal(before.origin, "https://pay.jeko.africa", "sans modèle : adresse générique de Jèko");

  const real = new URL((await jeko.createPaymentRequest({ amount: 1000 })).payUrl as string);
  const decoy = new URL(jeko.decoyPayUrl!("pr_12345678"));
  assert.equal(decoy.protocol, "https:");
  assert.equal(decoy.origin, real.origin);
  assert.equal(decoy.pathname.split("/").length, real.pathname.split("/").length, "même nombre de segments");
  assert.ok(decoy.pathname.split("/").at(-1)!.length >= real.pathname.split("/").at(-1)!.length);
  assert.notEqual(decoy.toString(), real.toString());
  assert.notEqual(decoy.toString(), new URL(jeko.decoyPayUrl!("pr_12345678")).toString(), "jamais deux fois le même");
});

test("boutiques : GET /partner_api/stores avec les deux clés", async () => {
  const { url, requests } = await fake((_req, res) => sendJson(res, 200, [{ id: "s1", name: "Ma boutique" }]));
  assert.deepEqual(await client(url).listStores(), [{ id: "s1", name: "Ma boutique" }]);
  assert.equal(requests[0].method, "GET");
  assert.equal(requests[0].url, "/partner_api/stores");
  assert.equal(requests[0].headers["x-api-key"], KEY);
  assert.equal(requests[0].headers["x-api-key-id"], KEY_ID);

  const refused = await fake((_req, res) => sendJson(res, 401, {}));
  const error = await own(client(refused.url).listStores());
  assert.ok(error instanceof JekoHttpError);
  assert.equal(describeJekoFailure(error), "Les clés Jèko sont refusées");
});

test("describeJekoFailure : un message clair par cause", () => {
  assert.equal(describeJekoFailure(new JekoHttpError("http", "x", 403)), "Les clés Jèko sont refusées");
  assert.match(describeJekoFailure(new JekoHttpError("http", "x", 404)), /JEKO_STORE_ID/);
  assert.match(describeJekoFailure(new JekoHttpError("http", "x", 429)), /Limite/);
  assert.match(describeJekoFailure(new JekoHttpError("http", "x", 422)), /422/);
  assert.match(describeJekoFailure(new JekoHttpError("http", "x", 500)), /500/);
  assert.equal(describeJekoFailure(new JekoHttpError("invalid", "x")), "Jèko a renvoyé une réponse illisible");
  assert.equal(describeJekoFailure(new JekoHttpError("network", "x")), "Jèko est injoignable");
  assert.equal(describeJekoFailure(new Error("autre")), "Jèko est injoignable");
});

test("createJekoLive : configuration invalide refusée", () => {
  const ok = { baseUrl: "https://api.jeko.africa", apiKey: KEY, apiKeyId: KEY_ID, storeId: STORE, publicBaseUrl: PUBLIC_URL };
  assert.doesNotThrow(() => createJekoLive(ok));
  assert.throws(() => createJekoLive({ ...ok, baseUrl: "pas une adresse" }), /invalide/);
  assert.throws(() => createJekoLive({ ...ok, baseUrl: "ftp://exemple.org" }), /invalide/);
  assert.throws(() => createJekoLive({ ...ok, publicBaseUrl: "n'importe quoi" }), /invalide/);
  assert.throws(() => createJekoLive({ ...ok, apiKey: "" }), /manquantes/);
  assert.throws(() => createJekoLive({ ...ok, apiKeyId: "" }), /manquantes/);
  assert.throws(() => createJekoLive({ ...ok, storeId: "" }), /boutique/);
});

// --- Configuration -----------------------------------------------------------------------

test("config : la vraie caisse exige JEKO_MODE=live ET les trois valeurs", () => {
  const full = { JEKO_MODE: "live", JEKO_API_KEY: KEY, JEKO_API_KEY_ID: KEY_ID, JEKO_STORE_ID: STORE };
  assert.equal(loadConfig(full).jeko.mode, "live");
  assert.equal(loadConfig({ ...full, JEKO_MODE: "LIVE" }).jeko.mode, "live");
  assert.equal(loadConfig({}).jeko.mode, "mock");
  assert.equal(loadConfig({ ...full, JEKO_MODE: "mock" }).jeko.mode, "mock");
  assert.equal(loadConfig({ ...full, JEKO_MODE: undefined }).jeko.mode, "mock", "les clés seules ne suffisent pas");
  for (const missing of ["JEKO_API_KEY", "JEKO_API_KEY_ID", "JEKO_STORE_ID"]) {
    assert.equal(loadConfig({ ...full, [missing]: "  " }).jeko.mode, "mock", missing);
  }
  const jeko = loadConfig({}).jeko;
  assert.equal(jeko.baseUrl, "https://api.jeko.africa");
  assert.equal(jeko.publicBaseUrl, "http://localhost:3000");
  assert.equal(jeko.timeoutMs, 8000);
  assert.equal(loadConfig({ JEKO_TIMEOUT_MS: "1" }).jeko.timeoutMs, 500);
  assert.equal(loadConfig({ JEKO_TIMEOUT_MS: "999999" }).jeko.timeoutMs, 20_000);
  assert.equal(loadConfig({ PUBLIC_BASE_URL: "https://x.example.org" }).jeko.publicBaseUrl, "https://x.example.org");
});

// --- Application complète avec la vraie caisse (faux Jèko en HTTP) ----------------------------------

const postJson = (handler: (req: Request) => Promise<Response>, payload: unknown) =>
  handler(new Request(URL_, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) }));

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

const say = async (text: string, sessionId = "awa") => read(await postJson(turn, { sessionId, text }));
const status = async (id: string) => read(await payment(new Request(`http://localhost/api/payment?id=${encodeURIComponent(id)}`)));

async function liveApp(handler: Handler, options: RuntimeOptions = {}) {
  const jeko = await fake(handler);
  const config: JekoConfig = {
    mode: "live", baseUrl: jeko.url, apiKey: KEY, apiKeyId: KEY_ID, storeId: STORE, publicBaseUrl: PUBLIC_URL, timeoutMs: 2000,
  };
  const rt = replaceRuntime(createRuntime({ clock: () => NOON, secret: SECRET, getPhrase: () => PHRASE, demoMode: true, jeko: config, ...options }));
  return { rt, jeko };
}

function webhookFor(reference: string, amount: number, overrides: Partial<TransactionCompletedPayload> = {}) {
  const payload: TransactionCompletedPayload = {
    id: "txn_test", amount: { amount, currency: "XOF" }, fees: { amount: 0, currency: "XOF" }, status: "success",
    counterpartLabel: "Client", counterpartIdentifier: "+2250100000000", paymentMethod: "wave", transactionType: "payment",
    businessName: "Marché", storeId: STORE, storeName: "Boutique", executedAt: "2026-10-27 12:01:00",
    transactionDetails: { id: "d1", reference, paymentLinkId: null }, ...overrides,
  };
  const rawBody = JSON.stringify(payload);
  return new Request(URL_, {
    method: "POST",
    headers: {
      "content-type": "application/json", "jeko-event": "TRANSACTION_COMPLETED", "jeko-webhook-version": "1",
      "jeko-signature": signBody(rawBody, SECRET),
    },
    body: rawBody,
  });
}

test("vraie caisse : encaissement de bout en bout, de la voix au webhook signé", async () => {
  const { rt, jeko } = await liveApp(accepting);
  assert.equal(rt.cashierMode, "live");

  const ask = await say("Encaisse cinq mille francs par Wave");
  assert.equal(ask.body.awaitingConfirm, true);
  assert.equal(jeko.requests.length, 0, "rien n'est envoyé à Jèko avant le oui");

  const ok = await say("oui");
  assert.equal(ok.body.reply, "C'est lancé. Le client peut scanner et payer.");
  assert.equal(ok.body.tone, "success");
  const { id, url, amount, wallet } = ok.body.payment;
  assert.deepEqual([amount, wallet], [5000, "wave"]);
  assert.match(id, /^pr_[0-9a-f]{8}$/);
  assert.equal(url, "https://pay.jeko.africa/checkout/a1b2c3d4e5f6");
  assert.equal(jeko.requests.length, 1);
  assert.equal(jeko.requests[0].json.reference, id, "notre référence est celle que Jèko nous ramènera");
  assert.equal(jeko.requests[0].json.amountCents, 500_000);

  const op = rt.store.operations.find((o) => o.paymentId === id)!;
  assert.equal(op.status, "awaiting_payment");
  assert.deepEqual((await status(id)).body, { status: "waiting" });

  // Le vrai Jèko prévient : webhook signé avec la bonne référence et le bon montant.
  const received = await read(await webhook(webhookFor(id, 5000)));
  assert.deepEqual([received.status, received.body], [200, { ok: true, duplicate: false }]);
  assert.equal(op.status, "paid");

  const done = await status(id);
  assert.equal(done.body.status, "paid");
  assert.equal(done.body.reply, "Paiement reçu. 5 000 francs par Wave.");
  assert.ok(rt.isAllowedSpeech(done.body.speech), "l'annonce peut être prononcée par la voix");
});

test("vraie caisse : un faux webhook ne déclenche jamais « Paiement reçu »", async () => {
  const { rt } = await liveApp(accepting);
  await say("Encaisse cinq mille francs par Wave");
  const { id } = (await say("oui")).body.payment;

  const raw = await webhookFor(id, 5000).text();
  const badSignature = new Request(URL_, {
    method: "POST",
    headers: { "content-type": "application/json", "jeko-event": "TRANSACTION_COMPLETED", "jeko-webhook-version": "1", "jeko-signature": signBody(raw, "autre-secret") },
    body: raw,
  });
  assert.equal((await webhook(badSignature)).status, 401);
  assert.equal((await webhook(webhookFor(id, 100))).status, 409, "montant différent");
  assert.equal((await status(id)).body.status, "waiting");
  assert.equal(rt.store.operations.find((o) => o.paymentId === id)!.status, "awaiting_payment");
});

test("vraie caisse : le bouton « le client a payé » est refusé (le webhook fait foi)", async () => {
  const { jeko } = await liveApp(accepting);
  await say("Encaisse cinq mille francs par Wave");
  const { id } = (await say("oui")).body.payment;
  const r = await read(await postJson(paid, { paymentId: id }));
  assert.deepEqual([r.status, r.body.error], [409, "live_mode"]);
  assert.equal((await status(id)).body.status, "waiting");
  assert.equal(jeko.requests.length, 1);
});

test("vraie caisse : Jèko en panne, l'opération échoue proprement, sans fuite", async () => {
  const { rt } = await liveApp((_req, res) => sendJson(res, 503, { message: `panne ${KEY}` }));
  await say("Encaisse cinq mille francs par Wave");
  const r = await say("oui");
  assert.equal(r.body.reply, "Je n'ai pas pu faire l'opération. Réessaie dans un instant.");
  assert.equal(r.body.tone, "refusal");
  assert.equal(r.body.payment, undefined);
  assert.ok(!r.raw.includes(KEY));
  const op = rt.store.operations.at(-1)!;
  assert.equal(op.status, "failed");
  assert.equal(op.paymentId, undefined);
  assert.equal(rt.store.alerts.at(-1)!.type, "failed");
  assert.ok(!JSON.stringify(rt.store.alerts).includes(KEY));
});

test("vraie caisse : un double « oui » en même temps ne crée qu'une seule demande de paiement", async () => {
  const { jeko } = await liveApp((req, res) => setTimeout(() => accepting(req, res), 100));
  await say("Encaisse cinq mille francs par Wave");
  const [a, b] = await Promise.all([say("oui"), say("oui")]);
  assert.equal(jeko.requests.length, 1);
  assert.equal([a, b].filter((r) => r.body.payment).length, 1);
  assert.ok([a, b].some((r) => r.body.reply === "Il n'y a rien à confirmer pour le moment."));
});

test("vraie caisse : les tours d'une même session passent dans l'ordre, la phrase suivante attend la caisse", async () => {
  await liveApp((req, res) => setTimeout(() => accepting(req, res), 150));
  await say("Encaisse cinq mille francs par Wave");
  const order: string[] = [];
  const first = say("oui").then(() => order.push("oui"));
  const second = say("Encaisse mille francs par Wave").then(() => order.push("suivante"));
  await Promise.all([first, second]);
  assert.deepEqual(order, ["oui", "suivante"]);
});

test("vraie caisse : un transfert est simulé, jamais envoyé à Jèko", async () => {
  const { rt, jeko } = await liveApp(accepting);
  await say("Envoie cinq mille francs à Fatou");
  const r = await say("oui");
  assert.equal(r.body.tone, "success");
  assert.match(r.body.reply, /C'est envoyé/);
  assert.equal(jeko.requests.length, 0, "aucun appel à Jèko : aucun argent ne bouge");
  assert.equal(rt.store.operations.at(-1)!.status, "executed");
});

test("vraie caisse : la contrainte donne une réponse de même forme, sans rien envoyer à Jèko", async () => {
  const { rt, jeko } = await liveApp(accepting);
  await say("Encaisse cinq mille francs par Wave", "normal");
  const normal = (await say("oui", "normal")).body;
  const callsAfterNormal = jeko.requests.length;
  assert.equal(callsAfterNormal, 1);

  await say("Encaisse cinq mille francs par Wave", "forcee");
  const forced = (await say(`oui, c'est bon, ${PHRASE}`, "forcee")).body;
  assert.equal(jeko.requests.length, callsAfterNormal, "aucune demande de paiement réelle sous contrainte");

  assert.equal(forced.reply, normal.reply);
  assert.equal(forced.speech, normal.speech);
  assert.equal(forced.tone, normal.tone);
  assert.deepEqual(Object.keys(forced.payment).sort(), Object.keys(normal.payment).sort(), "mêmes champs, lien compris");
  assert.equal(new URL(forced.payment.url).origin, new URL(normal.payment.url).origin);
  assert.equal(new URL(forced.payment.url).protocol, "https:");
  assert.notEqual(forced.payment.url, normal.payment.url);
  assert.match(forced.payment.id, /^pr_[0-9a-f]{8}$/);

  const held = rt.store.operations.find((o) => o.status === "held")!;
  assert.ok(held, "l'opération est retenue");
  assert.equal(held.paymentId, undefined);
  assert.equal((await status(forced.payment.id)).body.status, "waiting", "le faux identifiant ne devient jamais « payé »");
  assert.equal(rt.store.alerts.some((a) => a.title === "Contrainte signalée"), true);
  assert.equal(leaks(JSON.stringify(forced)), false);
});

test("/api/payment : identifiant invalide ou inconnu", async () => {
  await liveApp(accepting);
  assert.equal((await status("a b")).status, 400);
  assert.equal((await status("x".repeat(65))).status, 400);
  assert.equal((await read(await payment(new Request("http://localhost/api/payment")))).status, 400);
  const unknown = await status("pr_inconnu");
  assert.deepEqual([unknown.status, unknown.body], [200, { status: "waiting" }]);
});

test("health : jeko vaut « live » avec la vraie caisse, « mock » sinon ; la clé de signature est signalée", async () => {
  await liveApp(accepting);
  const live = await read(await health());
  assert.equal(live.body.jeko, "live");
  assert.equal(live.body.jekoWebhook, true);
  for (const secret of [KEY, KEY_ID, SECRET]) assert.ok(!live.raw.includes(secret));

  replaceRuntime(createRuntime({ clock: () => NOON, demoMode: true, jeko: { ...loadConfig({}).jeko } }));
  const mockApp = await read(await health());
  assert.equal(mockApp.body.jeko, "mock");
});

test("écran : lien de paiement https seulement, bouton de simulation absent avec la vraie caisse", () => {
  const withUrl = (url?: string) => ({ payment: { id: "pr_1", amount: 5000, ...(url ? { url } : {}) } });
  assert.equal(payLink(withUrl("https://pay.jeko.africa/x")), "https://pay.jeko.africa/x");
  for (const bad of ["http://pay.jeko.africa/x", "javascript:alert(1)", "data:text/html,x", "pas une adresse", ""]) {
    assert.equal(payLink(withUrl(bad)), undefined, bad);
  }
  assert.equal(payLink(withUrl()), undefined);
  assert.equal(payLink({}), undefined);
  assert.equal(payLink(undefined), undefined);

  assert.equal(canSimulateClientPayment(withUrl(), true), true);
  assert.equal(canSimulateClientPayment(withUrl(), true, false), true);
  assert.equal(canSimulateClientPayment(withUrl(), true, true), false, "vraie caisse : le client paie pour de vrai");
  assert.equal(canSimulateClientPayment(withUrl(), false), false);

  assert.equal(jekoModeFrom({ jeko: "live" }), "live");
  assert.equal(jekoModeFrom({ jeko: "mock" }), "mock");
  assert.equal(jekoModeFrom({}), "mock");
  assert.equal(jekoModeFrom(undefined), "mock");
});

test("vraie caisse demandée mais clés absentes : on reste sur la fausse caisse", async () => {
  const rt = createRuntime({ jeko: { ...loadConfig({}).jeko, mode: "live" } });
  assert.equal(rt.cashierMode, "mock");
});
