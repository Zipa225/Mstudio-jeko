import test, { afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import { GET as history } from "../src/app/api/history/route";
import { POST as unblock } from "../src/app/api/unblock/route";
import { POST as turn } from "../src/app/api/turn/route";
import { createDialog } from "../src/lib/dialog";
import { buildHistory, merchantState } from "../src/lib/history";
import {
  checkKyc, checkUnblock, DEMO_KYC, KYC_MAX_ATTEMPTS, parseBirthDate, parseIdLast4,
} from "../src/lib/kyc";
import type { Cashier } from "../src/lib/ports";
import { createRuntime, getRuntime, replaceRuntime } from "../src/lib/runtime";
import { Store } from "../src/lib/store";

const NOON = new Date(Date.UTC(2026, 9, 29, 12, 0, 0));
const GOOD = { birthDate: "14/03/1988", idLast4: "4821" };
const BAD = { birthDate: "01/01/2000", idLast4: "0000" };

function setup() {
  const store = new Store(() => NOON, true);
  const calls = { collect: 0, transfer: [] as Array<{ amount: number; to: string }> };
  const cashier: Cashier = {
    createPaymentRequest() {
      calls.collect++;
      return { id: "pr_1" };
    },
    createTransfer(args) {
      calls.transfer.push(args);
      return { id: "tr_1" };
    },
  };
  const dialog = createDialog({ store, cashier });
  const say = (text: string, session = "s") => dialog.handleTurn(session, text);
  const blocked = () => {
    say("Envoie deux cent cinquante mille francs à Koné");
    return store.operations[store.operations.length - 1];
  };
  return { store, calls, dialog, say, blocked };
}

afterEach(() => mock.restoreAll());

// --- Les deux informations du KYC statique --------------------------------------------------------------

test("kyc : la date de naissance se lit de plusieurs façons, jamais une date impossible", () => {
  for (const t of ["14/03/1988", "14-03-1988", "14.03.1988", "14 03 1988", "1988-03-14", " 14/3/1988 ", "1988-3-14"]) {
    assert.equal(parseBirthDate(t), "1988-03-14", t);
  }
  for (const t of ["31/02/1988", "00/03/1988", "14/13/1988", "14/03/88", "hier", "", "14031988", undefined, 14031988, null]) {
    assert.equal(parseBirthDate(t), undefined, String(t));
  }
});

test("kyc : quatre chiffres exactement, espaces tolérés", () => {
  assert.equal(parseIdLast4("4821"), "4821");
  assert.equal(parseIdLast4(" 48 21 "), "4821");
  for (const t of ["482", "48211", "48a1", "", undefined, 4821]) assert.equal(parseIdLast4(t), undefined, String(t));
});

test("kyc : les deux informations doivent être justes", () => {
  assert.equal(checkKyc(GOOD, DEMO_KYC), true);
  assert.equal(checkKyc({ ...GOOD, idLast4: "4822" }, DEMO_KYC), false, "pièce fausse");
  assert.equal(checkKyc({ ...GOOD, birthDate: "15/03/1988" }, DEMO_KYC), false, "date fausse");
  assert.equal(checkKyc({ birthDate: GOOD.birthDate }, DEMO_KYC), false, "pièce absente");
  assert.equal(checkKyc({}, DEMO_KYC), false);
});

// --- Compter les essais ----------------------------------------------------------------------------------

test("déblocage : trois réponses fausses bloquent pour de bon et préviennent l'analyste", () => {
  const { store, blocked } = setup();
  const op = blocked();
  assert.equal(op.status, "blocked");

  const first = checkUnblock(store, op.id, BAD);
  assert.deepEqual(first, { ok: false, reason: "wrong", attemptsLeft: KYC_MAX_ATTEMPTS - 1 });
  const second = checkUnblock(store, op.id, BAD);
  assert.deepEqual(second, { ok: false, reason: "wrong", attemptsLeft: KYC_MAX_ATTEMPTS - 2 });
  const alertsBefore = store.alerts.length;
  const third = checkUnblock(store, op.id, BAD);
  assert.deepEqual(third, { ok: false, reason: "locked", attemptsLeft: 0 });
  assert.equal(store.alerts.length, alertsBefore + 1);
  assert.match(store.alerts.at(-1)!.title, /trop d'essais/);

  // Même avec les bonnes informations, c'est fini : un conseiller doit s'en charger.
  assert.deepEqual(checkUnblock(store, op.id, GOOD), { ok: false, reason: "locked", attemptsLeft: 0 });
  assert.equal(store.getOperation(op.id)!.status, "blocked");
  assert.equal(buildHistory(store)[0].unlockable, false);
});

test("déblocage : une opération qui n'est pas bloquée ne se débloque pas", () => {
  const { store, say } = setup();
  say("Encaisse cinq mille francs par Wave");
  const op = store.operations.at(-1)!;
  assert.equal(op.status, "to_confirm");
  assert.deepEqual(checkUnblock(store, op.id, GOOD), { ok: false, reason: "not_blocked", attemptsLeft: 0 });
  assert.deepEqual(checkUnblock(store, "inconnue", GOOD), { ok: false, reason: "not_blocked", attemptsLeft: 0 });
});

// --- Dans le dialogue : la relecture et le oui restent obligatoires ------------------------------------

test("dialogue : débloquer relit l'opération, et rien ne part avant le oui", () => {
  const { store, calls, dialog, blocked } = setup();
  const op = blocked();
  assert.equal(calls.transfer.length, 0);

  assert.equal(checkUnblock(store, op.id, GOOD).ok, true);
  const r = dialog.resumeBlocked("s", op.id);
  assert.equal(r.reply, "Identité vérifiée. Tu envoies 250 000 francs à Koné. Tu confirmes ?");
  assert.equal(r.speech, "Identité vérifiée. Tu envoies deux cent cinquante mille francs à Koné. Tu confirmes ?");
  assert.equal(r.awaitingConfirm, true);
  assert.equal(store.getOperation(op.id)!.status, "to_confirm");
  assert.equal(calls.transfer.length, 0, "le déblocage n'envoie rien");
  assert.equal(store.alerts.at(-1)!.type, "unblocked");

  const done = dialog.handleTurn("s", "oui");
  assert.equal(done.reply, "C'est envoyé. 250 000 francs à Koné.");
  assert.deepEqual(calls.transfer, [{ amount: 250_000, to: "Koné" }]);
  assert.equal(store.getOperation(op.id)!.status, "executed");
});

test("dialogue : après le déblocage, « non » annule", () => {
  const { store, calls, dialog, blocked } = setup();
  const op = blocked();
  dialog.resumeBlocked("s", op.id);
  assert.equal(dialog.handleTurn("s", "non").reply, "D'accord, j'annule.");
  assert.equal(store.getOperation(op.id)!.status, "cancelled");
  assert.equal(calls.transfer.length, 0);
});

test("dialogue : on ne débloque qu'une opération réellement bloquée, et une seule fois", () => {
  const { dialog, store, calls, blocked } = setup();
  const op = blocked();
  dialog.resumeBlocked("s", op.id);
  dialog.handleTurn("s", "oui");
  const again = dialog.resumeBlocked("s", op.id);
  assert.equal(again.reply, "Cette opération n'est plus à débloquer.");
  assert.equal(again.awaitingConfirm, false);
  assert.equal(calls.transfer.length, 1, "un seul transfert");
  assert.equal(dialog.resumeBlocked("s", "inconnue").awaitingConfirm, false);
  assert.equal(store.operations.filter((o) => o.status === "executed").length, 1);
});

test("dialogue : débloquer abandonne la confirmation qui était en cours dans la session", () => {
  const { store, say, dialog, blocked } = setup();
  const op = blocked();
  say("Encaisse cinq mille francs par Wave");
  const pending = store.operations.at(-1)!;
  assert.equal(pending.status, "to_confirm");
  dialog.resumeBlocked("s", op.id);
  assert.equal(pending.status, "cancelled", "on ne confirme qu'une chose à la fois");
});

test("dialogue : la phrase de contrainte garde la main après un déblocage", () => {
  const calls = { transfer: 0 };
  const cashier: Cashier = {
    createPaymentRequest: () => ({ id: "pr_1" }),
    createTransfer() {
      calls.transfer++;
      return { id: "tr_1" };
    },
  };
  const rt = replaceRuntime(createRuntime({ clock: () => NOON, getPhrase: () => "le manioc cuit doucement", demoMode: true, cashier }));
  const say = (text: string) => rt.dialog.handleTurn("s", text) as { reply: string };
  say("Envoie deux cent cinquante mille francs à Koné");
  const op = rt.store.operations.at(-1)!;
  rt.dialog.resumeBlocked("s", op.id);
  const forced = say("Oui, c'est bon, le manioc cuit doucement");
  assert.equal(forced.reply, "C'est envoyé. 250 000 francs à Koné.", "la réponse est celle d'un succès");
  assert.equal(rt.store.getOperation(op.id)!.status, "held");
  assert.equal(calls.transfer, 0, "rien n'est parti");
});

// --- L'historique de la commerçante ----------------------------------------------------------------------

test("historique : les statuts en mots simples, et la contrainte ne se voit pas", () => {
  assert.deepEqual(merchantState({ kind: "collect", status: "paid" }), { state: "done", label: "Payé" });
  assert.deepEqual(merchantState({ kind: "send", status: "executed" }), { state: "done", label: "Envoyé" });
  assert.deepEqual(merchantState({ kind: "collect", status: "awaiting_payment" }), { state: "waiting", label: "En attente du client" });
  assert.deepEqual(merchantState({ kind: "send", status: "blocked" }), { state: "blocked", label: "Bloquée" });
  assert.deepEqual(merchantState({ kind: "send", status: "cancelled" }), { state: "cancelled", label: "Annulée" });
  // Retenue sous contrainte : exactement ce que la commerçante a vu à l'écran sur le moment.
  assert.deepEqual(merchantState({ kind: "send", status: "held" }), merchantState({ kind: "send", status: "executed" }));
  assert.deepEqual(merchantState({ kind: "collect", status: "held" }), merchantState({ kind: "collect", status: "awaiting_payment" }));
});

test("historique : le plus récent d'abord, sans score ni raison", () => {
  const { store, say, blocked } = setup();
  const op = blocked();
  say("Encaisse cinq mille francs par Wave");
  const list = buildHistory(store);
  assert.equal(list[0].kind, "collect");
  assert.equal(list[0].label, "À confirmer");
  assert.equal(list[1].id, op.id);
  assert.deepEqual([list[1].state, list[1].unlockable, list[1].who], ["blocked", true, "Koné"]);
  for (const item of list) {
    for (const key of ["score", "factors", "decision", "riskSource", "modelVersion", "degraded"]) assert.ok(!(key in item), key);
  }
  assert.equal(buildHistory(store, 3).length, 3);
});

// --- Les routes ------------------------------------------------------------------------------------------

const URL = "http://localhost/api/x";
const post = (handler: (req: Request) => Promise<Response>, payload: unknown) =>
  handler(new Request(URL, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) }));
const read = async (res: Response) => {
  const raw = await res.text();
  return { status: res.status, raw, body: raw ? JSON.parse(raw) : undefined };
};
const fresh = (demoMode = true) =>
  replaceRuntime(createRuntime({ clock: () => NOON, secret: "secret-de-test", getPhrase: () => "le manioc cuit doucement", demoMode }));
const say = async (text: string, sessionId = "awa") => read(await post(turn, { sessionId, text }));
const blockedId = async () => {
  await say("Envoie deux cent cinquante mille francs à Koné");
  return getRuntime().store.operations.at(-1)!.id;
};

test("/api/history : la liste de la commerçante, sans secret, avec le rappel de démonstration", async () => {
  fresh();
  await say("Envoie deux cent cinquante mille francs à Koné");
  const r = await read(await history());
  assert.equal(r.status, 200);
  assert.equal(r.body.items[0].label, "Bloquée");
  assert.equal(r.body.items[0].unlockable, true);
  assert.equal(r.body.kycHint, "14/03/1988 et 4821");
  assert.ok(!/score|factors|decision/.test(r.raw), "ni score ni raison d'Argus");

  fresh(false);
  assert.equal((await read(await history())).body.kycHint, undefined, "hors démonstration : aucun rappel des informations");
});

test("/api/unblock : mauvaises entrées", async () => {
  fresh();
  const id = await blockedId();
  assert.equal((await read(await post(unblock, { sessionId: "a b", operationId: id, ...GOOD }))).status, 400);
  assert.equal((await read(await post(unblock, { sessionId: "awa", operationId: "../x", ...GOOD }))).status, 400);
  assert.equal((await read(await post(unblock, { sessionId: "awa", ...GOOD }))).status, 400);
  assert.equal((await read(await post(unblock, { sessionId: "awa", operationId: "inconnue", ...GOOD }))).status, 409);
  const notJson = await unblock(new Request(URL, { method: "POST", headers: { "content-type": "text/plain" }, body: "x" }));
  assert.equal(notJson.status, 415);
});

test("/api/unblock : faux, faux, faux : 403, 403, puis 423 ; l'opération reste bloquée", async () => {
  const rt = fresh();
  const id = await blockedId();
  const a = await read(await post(unblock, { sessionId: "awa", operationId: id, ...BAD }));
  assert.deepEqual([a.status, a.body.attemptsLeft], [403, 2]);
  assert.match(a.body.message, /Il te reste 2 essais sur 3/);
  const b = await read(await post(unblock, { sessionId: "awa", operationId: id, ...BAD }));
  assert.deepEqual([b.status, b.body.attemptsLeft], [403, 1]);
  assert.match(b.body.message, /Il te reste 1 essai sur 3/);
  const c = await read(await post(unblock, { sessionId: "awa", operationId: id, ...BAD }));
  assert.equal(c.status, 423);
  assert.match(c.body.message, /Un conseiller Jèko va te rappeler/);
  assert.equal((await read(await post(unblock, { sessionId: "awa", operationId: id, ...GOOD }))).status, 423);
  assert.equal(rt.store.getOperation(id)!.status, "blocked");
  assert.equal(rt.mock.listTransfers().length, 0);
});

test("/api/unblock : les bonnes informations ramènent à la relecture, le oui exécute", async () => {
  const rt = fresh();
  const id = await blockedId();
  const r = await read(await post(unblock, { sessionId: "awa", operationId: id, birthDate: " 14 03 1988 ", idLast4: "4821" }));
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
  assert.equal(r.body.reply, "Identité vérifiée. Tu envoies 250 000 francs à Koné. Tu confirmes ?");
  assert.equal(r.body.awaitingConfirm, true);
  assert.equal(rt.mock.listTransfers().length, 0, "pas d'envoi avant le oui");
  assert.equal(rt.isAllowedSpeech(r.body.speech), true, "la voix peut dire la relecture");

  const done = await say("oui");
  assert.equal(done.body.reply, "C'est envoyé. 250 000 francs à Koné.");
  assert.equal(rt.mock.listTransfers().length, 1);
  assert.equal((await read(await history())).body.items[0].label, "Envoyé");
});

test("/api/history : une opération retenue sous contrainte s'affiche comme un succès", async () => {
  const rt = fresh();
  await say("Envoie cent cinquante mille francs à Traoré");
  await say("Oui, c'est bon, le manioc cuit doucement");
  assert.equal(rt.store.operations.at(-1)!.status, "held");
  const r = await read(await history());
  assert.equal(r.body.items[0].label, "Envoyé");
  assert.ok(!/manioc|contrainte|held/i.test(r.raw));
});
