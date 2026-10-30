import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createDialog } from "../src/lib/dialog";
import { createDuressGuard } from "../src/lib/duress";
import { DEMO_STORE, JekoApiError, JekoMock, MIN_AMOUNT_CENTS, type WebhookDelivery } from "../src/lib/jekoMock";
import {
  createWebhookReceiver, signBody, verifySignature, type TransactionCompletedPayload,
} from "../src/lib/jekoWebhook";
import { Store } from "../src/lib/store";

const SECRET = "secret-de-test";
const NOON = new Date(Date.UTC(2026, 9, 27, 12, 0, 0));

function setup(secret = SECRET, phrase?: string) {
  const store = new Store(() => NOON);
  const mock = new JekoMock({ secret, clock: () => NOON });
  const receive = createWebhookReceiver({ store, secret });
  const dialog = createDialog({ store, cashier: mock, guard: phrase ? createDuressGuard(store, () => phrase) : undefined });
  const say = (text: string) => dialog.handleTurn("s", text);
  /** Encaissement confirmé : l'opération attend le paiement du client. */
  const startCollect = (text = "Encaisse cinq mille francs par Wave") => {
    say(text);
    return say("oui").payment!;
  };
  const op = () => store.operations.at(-1)!;
  return { store, mock, receive, say, startCollect, op };
}

/** Un webhook signé avec la bonne clé, dont on choisit le contenu. */
function signed(secret: string, payload: unknown, headers: Record<string, string> = {}): WebhookDelivery {
  const rawBody = typeof payload === "string" ? payload : JSON.stringify(payload);
  return {
    rawBody,
    headers: {
      "Jeko-Event": "TRANSACTION_COMPLETED",
      "Jeko-Signature": signBody(rawBody, secret),
      "Jeko-Webhook-Version": "1",
      ...headers,
    },
  };
}

const parse = (d: WebhookDelivery) => JSON.parse(d.rawBody) as TransactionCompletedPayload;

// --- Demande de paiement : montants en centimes -----------------------------

test("demande de paiement : montants en centimes (FCFA x 100), devise XOF, magasin connu", () => {
  const { mock } = setup();
  const req = mock.createPaymentRequest({ amount: 5000, wallet: "wave" });
  assert.equal(req.amountCents, 500_000);
  assert.equal(req.currency, "XOF");
  assert.equal(req.storeId, DEMO_STORE.id);
  assert.deepEqual(req.paymentDetails, { paymentMethod: "wave" });
  assert.equal(req.status, "pending");
  assert.match(req.id, /^pr_/);
  assert.equal(req.reference, req.id, "la référence permet de retrouver l'opération");
  assert.equal(mock.createPaymentRequest({ amount: 5 }).amountCents, 500, "5 FCFA s'écrit 500");
  assert.deepEqual(mock.createPaymentRequest({ amount: 5 }).paymentDetails, {});
});

test("magasins : GET /partner_api/stores", () => {
  const { mock } = setup();
  assert.deepEqual(mock.listStores(), [DEMO_STORE]);
});

test("appel brut POST /partner_api/payment_requests : les mêmes champs que l'API réelle", () => {
  const { mock } = setup();
  const req = mock.postPaymentRequest({
    storeId: DEMO_STORE.id, amountCents: 1_500_000, currency: "XOF", reference: "PAY-001", paymentDetails: { paymentMethod: "orange" },
  });
  assert.equal(req.reference, "PAY-001");
  assert.equal(req.amountCents, 1_500_000);
  assert.equal(mock.getPaymentRequest(req.id), req);
});

test("demande de paiement : refus du minimum, des montants invalides, d'un magasin ou d'une devise inconnus", () => {
  const { mock } = setup();
  const body = { storeId: DEMO_STORE.id, amountCents: 500, currency: "XOF", reference: "r", paymentDetails: {} };
  assert.equal(mock.postPaymentRequest(body).amountCents, MIN_AMOUNT_CENTS, "pile le minimum : accepté");
  const code = (b: object) => {
    try {
      mock.postPaymentRequest({ ...body, ...b });
    } catch (e) {
      return e instanceof JekoApiError ? e.code : "autre erreur";
    }
    return "accepté";
  };
  assert.equal(code({ amountCents: 499 }), "amount_too_small");
  assert.equal(code({ amountCents: 0 }), "invalid_amount");
  assert.equal(code({ amountCents: -500 }), "invalid_amount");
  assert.equal(code({ amountCents: 500.5 }), "invalid_amount");
  assert.equal(code({ storeId: "inconnu" }), "unknown_store");
  assert.equal(code({ currency: "EUR" }), "invalid_currency");
  assert.throws(() => mock.createPaymentRequest({ amount: 4 }), JekoApiError);
});

test("transfert : montant en centimes aussi, journal des transferts", () => {
  const { mock } = setup();
  const t = mock.createTransfer({ amount: 150_000, to: "Koné" });
  assert.equal(t.amountCents, 15_000_000);
  assert.deepEqual([t.currency, t.to, t.status], ["XOF", "Koné", "completed"]);
  assert.match(t.id, /^tr_/);
  assert.deepEqual(mock.listTransfers(), [t]);
});

// --- Le webhook est au format exact de Jèko ---------------------------------

test("webhook TRANSACTION_COMPLETED : les champs exacts donnés par Jèko", () => {
  const { mock } = setup();
  const delivery = mock.simulateClientPayment(mock.createPaymentRequest({ amount: 5000, wallet: "orange" }).id);
  const p = parse(delivery);

  assert.deepEqual(Object.keys(p).sort(), [
    "amount", "businessName", "counterpartIdentifier", "counterpartLabel", "executedAt", "fees", "id",
    "paymentMethod", "status", "storeId", "storeName", "transactionDetails", "transactionType",
  ]);
  assert.deepEqual(Object.keys(p.transactionDetails).sort(), ["id", "paymentLinkId", "reference"]);
  assert.deepEqual(p.amount, { amount: 5000, currency: "XOF" });
  assert.deepEqual(p.fees, { amount: 75, currency: "XOF" });
  assert.equal(p.status, "success");
  assert.equal(p.transactionType, "payment");
  assert.equal(p.paymentMethod, "orange");
  assert.equal(p.storeId, DEMO_STORE.id);
  assert.match(p.id, /^txn_/);
  assert.equal(p.executedAt, "2026-10-27 12:00:00");
  assert.equal(p.transactionDetails.paymentLinkId, null);
});

test("webhook : le montant est en FCFA et les frais de l'exemple de Jèko sont retrouvés (1 000 donne 15)", () => {
  const { mock } = setup();
  const p = parse(mock.simulateClientPayment(mock.createPaymentRequest({ amount: 1000 }).id));
  assert.deepEqual([p.amount.amount, p.fees.amount], [1000, 15]);
});

test("webhook : en-têtes Jeko-Event, Jeko-Webhook-Version et Jeko-Signature (HMAC-SHA256 hexadécimal du corps brut)", () => {
  const { mock } = setup();
  const d = mock.simulateClientPayment(mock.createPaymentRequest({ amount: 5000 }).id);
  assert.equal(d.headers["Jeko-Event"], "TRANSACTION_COMPLETED");
  assert.equal(d.headers["Jeko-Webhook-Version"], "1");
  assert.match(d.headers["Jeko-Signature"], /^[0-9a-f]{64}$/);
  const independent = createHmac("sha256", SECRET).update(d.rawBody).digest("hex");
  assert.equal(d.headers["Jeko-Signature"], independent, "calcul indépendant identique");
});

test("le client ne peut payer qu'une fois, et seulement une demande qui existe", () => {
  const { mock } = setup();
  const id = mock.createPaymentRequest({ amount: 5000 }).id;
  mock.simulateClientPayment(id);
  assert.throws(() => mock.simulateClientPayment(id), (e: unknown) => e instanceof JekoApiError && e.code === "already_paid");
  assert.throws(() => mock.simulateClientPayment("pr_inconnu"), (e: unknown) => e instanceof JekoApiError && e.code === "unknown_payment_request");
});

// --- Le récepteur : « Paiement reçu » seulement après vérification ----------

test("signature valide : le paiement est enregistré, puis seulement alors « Paiement reçu » est annoncé", () => {
  const env = setup();
  const payment = env.startCollect();
  assert.equal(env.op().status, "awaiting_payment");

  const outcome = env.receive(env.mock.simulateClientPayment(payment.id));
  assert.equal(outcome.ok, true);
  assert.ok(outcome.ok && !outcome.duplicate);
  assert.ok(outcome.ok && outcome.announcement);
  assert.equal(outcome.ok && outcome.announcement?.reply, "Paiement reçu. 5 000 francs par Wave.");
  assert.equal(outcome.ok && outcome.announcement?.speech, "Paiement reçu. cinq mille francs par Wave.");
  assert.equal(outcome.ok && outcome.announcement?.tone, "success", "l'écran affiche un succès");
  assert.equal(env.op().status, "paid");
  assert.deepEqual(env.store.paidToday(NOON), { total: 50_000, count: 11 }, "les 45 000 d'exemple plus les 5 000");
});

test("signature fausse ou modifiée : refusée, rien n'est enregistré, aucune annonce", () => {
  const env = setup();
  const delivery = env.mock.simulateClientPayment(env.startCollect().id);
  const tampered = { ...delivery, rawBody: delivery.rawBody.replace('"amount":5000', '"amount":500000') };
  assert.notEqual(tampered.rawBody, delivery.rawBody);

  const outcome = env.receive(tampered);
  assert.deepEqual(outcome, { ok: false, status: 401, reason: "bad_signature" });
  assert.equal(env.op().status, "awaiting_payment");
  const alert = env.store.alerts.at(-1)!;
  assert.deepEqual([alert.level, alert.type], ["warning", "webhook"]);
  assert.match(alert.detail, /signature/);
  assert.ok(!alert.detail.includes(delivery.rawBody), "le contenu du message n'est pas recopié dans l'alerte");
});

test("signatures invalides : absente, vide, mal formée, de mauvaise longueur, d'une autre clé", () => {
  const env = setup();
  const delivery = env.mock.simulateClientPayment(env.startCollect().id);
  const good = delivery.headers["Jeko-Signature"];
  const bad: Array<string | undefined> = [
    undefined, "", "   ", "abc", "z".repeat(64), "0".repeat(64), good.slice(1), `${good}0`,
    signBody(delivery.rawBody, "autre-cle"), good.replace(/.$/, good.endsWith("0") ? "1" : "0"),
  ];
  for (const signature of bad) {
    const headers: Record<string, string | undefined> = { ...delivery.headers, "Jeko-Signature": signature };
    const outcome = env.receive({ rawBody: delivery.rawBody, headers });
    assert.deepEqual(outcome, { ok: false, status: 401, reason: "bad_signature" }, JSON.stringify(signature));
  }
  assert.equal(env.op().status, "awaiting_payment");
  const noHeader = { ...delivery.headers };
  delete noHeader["Jeko-Signature"];
  assert.equal(env.receive({ rawBody: delivery.rawBody, headers: noHeader }).ok, false);
});

test("noms d'en-têtes insensibles à la casse (le serveur les reçoit en minuscules)", () => {
  const env = setup();
  const d = env.mock.simulateClientPayment(env.startCollect().id);
  const lower = Object.fromEntries(Object.entries(d.headers).map(([k, v]) => [k.toLowerCase(), v]));
  assert.equal(env.receive({ rawBody: d.rawBody, headers: lower }).ok, true);
});

test("version ou événement inattendus : refusés, même avec une bonne signature", () => {
  const env = setup();
  const payment = env.startCollect();
  const base = parse(env.mock.simulateClientPayment(payment.id));
  assert.deepEqual(env.receive(signed(SECRET, base, { "Jeko-Webhook-Version": "2" })), { ok: false, status: 400, reason: "unsupported_version" });
  assert.deepEqual(env.receive(signed(SECRET, base, { "Jeko-Event": "TRANSACTION_FAILED" })), { ok: false, status: 400, reason: "unsupported_event" });
  assert.equal(env.op().status, "awaiting_payment");
});

test("contenu invalide : refusé, même avec une bonne signature", () => {
  const env = setup();
  env.startCollect();
  for (const body of ["pas du json", "[]", "null", "{}", '{"id":"x"}', '{"id":"x","amount":{"amount":"5000","currency":"XOF"},"status":"success"}']) {
    assert.deepEqual(env.receive(signed(SECRET, body)), { ok: false, status: 400, reason: "bad_payload" }, body);
  }
  assert.equal(env.op().status, "awaiting_payment");
});

test("demande inconnue : refusée", () => {
  const env = setup();
  const payment = env.startCollect();
  const p = parse(env.mock.simulateClientPayment(payment.id));
  p.transactionDetails.reference = "pr_inconnu";
  assert.deepEqual(env.receive(signed(SECRET, p)), { ok: false, status: 404, reason: "unknown_payment" });
  assert.equal(env.op().status, "awaiting_payment");
});

test("montant ou devise différents de la demande : refusés avec une alerte, même avec une bonne signature", () => {
  const env = setup();
  const payment = env.startCollect();
  const base = parse(env.mock.simulateClientPayment(payment.id));

  const other = { ...base, amount: { amount: 6000, currency: "XOF" } };
  assert.deepEqual(env.receive(signed(SECRET, other)), { ok: false, status: 409, reason: "amount_mismatch" });
  const euro = { ...base, amount: { amount: 5000, currency: "EUR" } };
  assert.deepEqual(env.receive(signed(SECRET, euro)), { ok: false, status: 409, reason: "amount_mismatch" });

  assert.equal(env.op().status, "awaiting_payment");
  const alert = env.store.alerts.at(-1)!;
  assert.deepEqual([alert.level, alert.type, alert.operationId], ["warning", "webhook", env.op().id]);
  assert.match(alert.detail, /montant/);
});

test("paiement non abouti : rien n'est enregistré", () => {
  const env = setup();
  const payment = env.startCollect();
  const failed = { ...parse(env.mock.simulateClientPayment(payment.id)), status: "failed" };
  assert.deepEqual(env.receive(signed(SECRET, failed)), { ok: false, status: 409, reason: "not_success" });
  assert.equal(env.op().status, "awaiting_payment");
});

test("même webhook reçu deux fois : accepté sans rien refaire, une seule annonce", () => {
  const env = setup();
  const d = env.mock.simulateClientPayment(env.startCollect().id);
  const first = env.receive(d);
  const second = env.receive(d);
  assert.ok(first.ok && !first.duplicate && first.announcement);
  assert.ok(second.ok && second.duplicate && !second.announcement);
  assert.equal(env.op().status, "paid");
  assert.equal(env.store.paidToday(NOON).count, 11, "le paiement n'est compté qu'une fois");
});

test("une opération annulée, retenue ou jamais confirmée ne peut pas être payée par un webhook", () => {
  const env = setup();
  env.say("Encaisse 5000 francs");
  env.say("non");
  const fake = {
    id: "txn_1", amount: { amount: 5000, currency: "XOF" }, fees: { amount: 75, currency: "XOF" }, status: "success",
    transactionDetails: { id: "d", reference: "pr_nimporte", paymentLinkId: null },
  };
  assert.equal(env.receive(signed(SECRET, fake)).ok, false);
  assert.equal(env.op().status, "cancelled");
});

test("sous contrainte, le faux identifiant de paiement n'existe pas côté caisse et aucun webhook ne le valide", () => {
  const phrase = "le manioc cuit doucement";
  const env = setup(SECRET, phrase);
  env.say("Encaisse cinq mille francs par Wave");
  const reply = env.say(`oui ${phrase}`);
  const fakeId = reply.payment!.id;

  assert.equal(env.op().status, "held");
  assert.equal(env.mock.getPaymentRequest(fakeId), undefined, "la caisse ne connaît pas ce paiement");
  assert.throws(() => env.mock.simulateClientPayment(fakeId), JekoApiError);

  const forged = {
    id: "txn_1", amount: { amount: 5000, currency: "XOF" }, fees: { amount: 75, currency: "XOF" }, status: "success",
    transactionDetails: { id: "d", reference: fakeId, paymentLinkId: null },
  };
  assert.deepEqual(env.receive(signed(SECRET, forged)), { ok: false, status: 404, reason: "unknown_payment" });
  assert.equal(env.op().status, "held");
});

// --- Clé de signature -------------------------------------------------------

test("clé de signature : celle qu'on donne, sinon une clé aléatoire propre à chaque démarrage", () => {
  const saved = process.env.JEKO_WEBHOOK_SECRET;
  delete process.env.JEKO_WEBHOOK_SECRET;
  try {
    assert.equal(new JekoMock({ secret: "ma-cle" }).webhookSecret, "ma-cle");
    const a = new JekoMock().webhookSecret;
    const b = new JekoMock().webhookSecret;
    assert.match(a, /^[0-9a-f]{64}$/);
    assert.notEqual(a, b, "aucune clé n'est écrite en dur");
    process.env.JEKO_WEBHOOK_SECRET = "depuis-la-config";
    assert.equal(new JekoMock().webhookSecret, "depuis-la-config");
  } finally {
    if (saved === undefined) delete process.env.JEKO_WEBHOOK_SECRET;
    else process.env.JEKO_WEBHOOK_SECRET = saved;
  }
});

test("sans clé, le récepteur refuse de démarrer plutôt que d'accepter n'importe quoi", () => {
  assert.throws(() => createWebhookReceiver({ store: new Store(() => NOON), secret: "" }), /manquante/);
  assert.equal(verifySignature("corps", signBody("corps", ""), ""), false);
});

test("vérification de signature : bonne clé acceptée, autre clé refusée, jamais d'exception", () => {
  const body = '{"a":1}';
  const sig = signBody(body, SECRET);
  assert.equal(verifySignature(body, sig, SECRET), true);
  assert.equal(verifySignature(body, sig.toUpperCase(), SECRET), true, "l'hexadécimal est insensible à la casse");
  assert.equal(verifySignature(body, ` ${sig} `, SECRET), true);
  assert.equal(verifySignature(`${body} `, sig, SECRET), false, "un espace de plus change tout");
  assert.equal(verifySignature(body, sig, "autre"), false);
  for (const odd of ["", "x", sig.slice(2), `${sig}00`, "\u0000".repeat(64), "é".repeat(64)]) {
    assert.doesNotThrow(() => verifySignature(body, odd, SECRET));
    assert.equal(verifySignature(body, odd, SECRET), false);
  }
});

test("la comparaison des signatures se fait à temps constant", () => {
  const source = readFileSync(join(__dirname, "..", "src", "lib", "jekoWebhook.ts"), "utf8");
  assert.ok(source.includes("timingSafeEqual("), "timingSafeEqual doit servir à comparer");
  assert.ok(!/signature\s*[!=]==/.test(source) && !/given\s*[!=]==/.test(source), "pas de comparaison directe de chaînes");
});
