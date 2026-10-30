import test from "node:test";
import assert from "node:assert/strict";
import {
  canSimulateClientPayment, errorView, GREETING, heardLine, isTestMode, keepNumbersTogether, newSessionId, PHASE_LABEL, screenKind,
  showConfirmButtons,
} from "../src/app/marchand/view";
import { createDialog, type TurnResult } from "../src/lib/dialog";
import { SESSION_ID } from "../src/lib/http";
import type { Cashier } from "../src/lib/ports";
import { Store } from "../src/lib/store";

const NOON = new Date(Date.UTC(2026, 9, 27, 12, 0, 0));

function setup() {
  const store = new Store(() => NOON);
  const cashier: Cashier = {
    createPaymentRequest: () => ({ id: "pr_1" }),
    createTransfer: () => ({ id: "tr_1" }),
  };
  const dialog = createDialog({ store, cashier });
  return { say: (text: string, sid = "s") => dialog.handleTurn(sid, text) };
}

// --- La nature de chaque réponse du dialogue ---------------------------------

test("réponses du dialogue : une confirmation simple est de nature « ask »", () => {
  const { say } = setup();
  const r = say("Encaisse cinq mille francs par Wave");
  assert.equal(r.tone, "ask");
  assert.equal(r.awaitingConfirm, true);
});

test("réponses du dialogue : le doute d'Argus est de nature « verify »", () => {
  const { say } = setup();
  const r = say("Envoie cent cinquante mille francs à Koné");
  assert.equal(r.tone, "verify");
  assert.equal(r.awaitingConfirm, true);
});

test("réponses du dialogue : succès, refus et information", () => {
  const a = setup();
  a.say("Encaisse cinq mille francs");
  assert.equal(a.say("oui").tone, "success", "encaissement lancé");

  const b = setup();
  b.say("Envoie 5000 à Fatou");
  assert.equal(b.say("oui").tone, "success", "transfert envoyé");

  assert.equal(setup().say("Envoie deux cent cinquante mille francs à Koné").tone, "verify", "opération bloquée : en attente, pas un refus");
  assert.equal(setup().say("Encaisse 250 000 francs").tone, "refusal", "au-dessus du plafond");

  const c = setup();
  assert.equal(c.say("bonjour").tone, "info");
  assert.equal(c.say("Encaisse").tone, "info", "question sur le montant");
  assert.equal(c.say("oui").tone, "info", "rien à confirmer");
});

// --- Choix d'affichage --------------------------------------------------------

test("apparence : la nature de la réponse décide, avec un repli sans nature", () => {
  assert.equal(screenKind({ tone: "success", awaitingConfirm: false }), "success");
  assert.equal(screenKind({ tone: "verify", awaitingConfirm: true }), "verify");
  assert.equal(screenKind({ awaitingConfirm: true }), "ask");
  assert.equal(screenKind({ awaitingConfirm: false }), "info");
  assert.equal(screenKind(undefined), "info");
});

test("boutons Oui et Non : seulement pendant une confirmation", () => {
  assert.equal(showConfirmButtons({ awaitingConfirm: true }), true);
  assert.equal(showConfirmButtons({ awaitingConfirm: false }), false);
  assert.equal(showConfirmButtons(undefined), false);
  const { say } = setup();
  assert.equal(showConfirmButtons(say("Encaisse 5000 francs")), true);
  assert.equal(showConfirmButtons(say("oui")), false);
});

test("simulation du paiement du client : seulement en démonstration, après un encaissement lancé", () => {
  const { say } = setup();
  say("Encaisse 5000 francs");
  const launched: TurnResult = say("oui");
  assert.ok(launched.payment);
  assert.equal(canSimulateClientPayment(launched, true), true);
  assert.equal(canSimulateClientPayment(launched, false), false, "jamais hors démonstration");
  assert.equal(canSimulateClientPayment(say("bonjour"), true), false, "pas de paiement en cours");
  assert.equal(canSimulateClientPayment(undefined, true), false);
});

test("mode clavier : seulement avec ?test=1", () => {
  assert.equal(isTestMode("?test=1"), true);
  assert.equal(isTestMode("?foo=2&test=1"), true);
  assert.equal(isTestMode("?test=0"), false);
  assert.equal(isTestMode(""), false);
  assert.equal(isTestMode("?demo=1"), false);
});

test("identifiant de session : accepté par le serveur, différent à chaque fois", () => {
  const a = newSessionId([1, 2, 255, 0, 16, 32, 64, 128]);
  assert.equal(a, "awa-0102ff0010204080");
  assert.match(a, SESSION_ID);
  assert.notEqual(a, newSessionId([9, 9, 9, 9, 9, 9, 9, 9]));
});

test("ce que dit l'écran de la phrase de la vendeuse", () => {
  assert.equal(heardLine("encaisse cinq mille francs"), "Tu as dit : « encaisse cinq mille francs »");
  assert.equal(heardLine("  oui  "), "Tu as dit : « oui »");
  assert.equal(heardLine(""), undefined);
  assert.equal(heardLine("   "), undefined);
  assert.equal(heardLine(undefined), undefined);
});

test("les montants ne se coupent pas en fin de ligne", () => {
  const nbsp = " ";
  assert.equal(keepNumbersTogether("C'est envoyé. 150 000 francs à Koné."), `C'est envoyé. 150${nbsp}000 francs à Koné.`);
  assert.equal(keepNumbersTogether("Paiement reçu. 5 000 francs par Wave."), `Paiement reçu. 5${nbsp}000 francs par Wave.`);
  assert.equal(keepNumbersTogether("1 250 000 francs"), `1${nbsp}250${nbsp}000 francs`);
  assert.equal(keepNumbersTogether("au 07 01 02 03 04"), "au 07 01 02 03 04", "un numéro de téléphone n'est pas un montant");
  assert.equal(keepNumbersTogether("Tu as 5 francs et 12 amis"), "Tu as 5 francs et 12 amis");
});

test("textes de l'écran : accueil, erreur et états du micro", () => {
  assert.match(GREETING.reply, /micro/);
  assert.equal(GREETING.reply, GREETING.speech);
  assert.equal(errorView().tone, "refusal");
  assert.deepEqual(Object.keys(PHASE_LABEL).sort(), ["idle", "listening", "speaking", "thinking"]);
  assert.equal(PHASE_LABEL.idle, "Appuie pour parler");
});
