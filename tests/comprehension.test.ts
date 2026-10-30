import test from "node:test";
import assert from "node:assert/strict";
import { createDialog } from "../src/lib/dialog";
import { isYes, kindFrom, parseIntent, repairSpeech } from "../src/lib/intent";
import type { Cashier } from "../src/lib/ports";
import { Store } from "../src/lib/store";
import { normalize } from "../src/lib/text";

// Midi à Abidjan (UTC) : aucun critère de nuit par accident.
const NOON = new Date(Date.UTC(2026, 9, 29, 12, 0, 0));

function setup() {
  const store = new Store(() => NOON, true);
  const calls = { collect: 0, transfer: 0 };
  const cashier: Cashier = {
    createPaymentRequest() {
      calls.collect++;
      return { id: "pr_1" };
    },
    createTransfer() {
      calls.transfer++;
      return { id: "tr_1" };
    },
  };
  const dialog = createDialog({ store, cashier });
  return { store, calls, say: (text: string, session = "s") => dialog.handleTurn(session, text) };
}

// --- Réparer ce que la reconnaissance a mal écrit --------------------------------------------------------

test("réparation : « on voit 5000 francs par 8 » est « envoie 5000 francs par Wave » (cas réel)", () => {
  assert.equal(repairSpeech("On voit 5000 francs par 8."), "envoie 5000 francs par wave");
  assert.deepEqual(parseIntent("On voit 5000 francs par 8."), { kind: "send", amount: 5000, wallet: "wave" });
});

test("réparation : les autres façons d'écrire « envoie », « encaisse » et « Wave »", () => {
  for (const v of ["On voit", "En voie", "En voix", "An voyez", "on voie"]) {
    assert.equal(parseIntent(`${v} cinq mille francs par Wave`).kind, "send", v);
  }
  for (const v of ["On casse", "En caisse", "On caisse", "En cesse", "On casser"]) {
    assert.equal(parseIntent(`${v} cinq mille francs par Wave`).kind, "collect", v);
  }
  for (const w of ["8", "huit", "vague", "weve", "oueve", "ouaf", "waif"]) {
    assert.equal(parseIntent(`Encaisse 5000 francs par ${w}`).wallet, "wave", w);
    assert.equal(parseIntent(`Encaisse 5000 francs sur ${w}`).wallet, "wave", `sur ${w}`);
    assert.equal(parseIntent(`Encaisse 5000 francs avec ${w}`).wallet, "wave", `avec ${w}`);
  }
});

test("réparation : le bénéficiaire garde ses accents", () => {
  assert.deepEqual(parseIntent("En voie cent cinquante mille francs à Koné"), { kind: "send", amount: 150_000, beneficiary: "Koné" });
});

test("réparation : jamais en dehors d'une phrase d'argent", () => {
  for (const t of ["on voit que c'est bien", "on voit les choses", "en caisse", "on casse tout", "il y a 8 personnes", "J'ai 8 enfants", "par 8 chemins", "en voie de guérison"]) {
    assert.equal(repairSpeech(t), normalize(t), `${t} : le texte n'est pas touché`);
    assert.equal(parseIntent(t).kind, "unknown", t);
  }
});

test("réparation : un vrai verbe n'est pas touché, et « wave » reste « wave »", () => {
  assert.deepEqual(parseIntent("Envoie 5000 F par Wave"), { kind: "send", amount: 5000, wallet: "wave" });
  assert.deepEqual(parseIntent("Encaisse cinq mille francs par Wave"), { kind: "collect", amount: 5000, wallet: "wave" });
  assert.equal(repairSpeech("Encaisse cinq mille francs par Orange"), "encaisse cinq mille francs par orange");
});

// --- Un montant sans verbe compris -------------------------------------------------------------------------

test("montant seul : l'intention « amount », avec le moyen de paiement s'il est compris", () => {
  assert.deepEqual(parseIntent("Cinq mille francs"), { kind: "amount", amount: 5000 });
  assert.deepEqual(parseIntent("5000 francs par Wave"), { kind: "amount", amount: 5000, wallet: "wave" });
  assert.deepEqual(parseIntent("5000 F par vague"), { kind: "amount", amount: 5000, wallet: "wave" });
  assert.deepEqual(parseIntent("ça fait 5000 francs"), { kind: "amount", amount: 5000 });
  assert.deepEqual(parseIntent("cinq mille par Orange"), { kind: "amount", amount: 5000, wallet: "orange" });
});

test("montant seul : pas pour une question, ni sans mot d'argent", () => {
  assert.equal(parseIntent("combien font cinq mille francs ?").kind, "support");
  assert.equal(parseIntent("J'ai atteint la limite de 200 000, comment augmenter mon plafond ?").kind, "support");
  assert.equal(parseIntent("il y a 5000 personnes").kind, "unknown", "un nombre sans mot d'argent");
  assert.equal(parseIntent("bonjour").kind, "unknown");
  assert.equal(parseIntent("combien j'ai encaissé aujourd'hui").kind, "summary");
});

test("verbe : encaisser ou envoyer, aussi mal prononcés", () => {
  for (const t of ["encaisser", "Encaisse", "recevoir", "on casse", "en caisse"]) assert.equal(kindFrom(t), "collect", t);
  for (const t of ["envoyer", "envoie", "on voit", "en voie", "je veux envoyer"]) assert.equal(kindFrom(t), "send", t);
  for (const t of ["", "oui", "euh", "peut-être", "cinq mille"]) assert.equal(kindFrom(t), undefined, t);
});

test("oui : les façons courantes de l'entendre", () => {
  for (const t of ["oui", "ouais", "ouai", "wi", "ui", "ouep", "oui oui", "d'accord"]) assert.equal(isYes(t), true, t);
  for (const t of ["non", "pas oui", "euh", ""]) assert.equal(isYes(t), false, t);
});

// --- Dans le dialogue ---------------------------------------------------------------------------------------

test("dialogue : « on voit 5000 francs par 8 » devient un envoi par Wave, il manque le bénéficiaire", () => {
  const { say, calls } = setup();
  const r = say("On voit 5000 francs par 8.");
  assert.equal(r.reply, "À qui veux-tu l'envoyer ?");
  assert.equal(r.awaitingConfirm, false);
  assert.deepEqual(calls, { collect: 0, transfer: 0 });
  const next = say("Fatou");
  assert.equal(next.awaitingConfirm, true);
  assert.match(next.reply, /Tu envoies 5 000 francs par Wave à Fatou/);
});

test("dialogue : un montant sans verbe, l'agent demande encaisser ou envoyer, et garde le montant", () => {
  const { say, calls } = setup();
  const ask = say("Cinq mille francs par Wave");
  assert.equal(ask.reply, "Tu veux encaisser ou envoyer 5 000 francs par Wave ?");
  assert.equal(ask.speech, "Tu veux encaisser ou envoyer cinq mille francs par Wave ?");
  assert.equal(ask.awaitingConfirm, false, "rien à confirmer encore");
  assert.deepEqual(calls, { collect: 0, transfer: 0 }, "rien n'est lancé");

  const confirm = say("encaisser");
  assert.equal(confirm.reply, "Tu veux encaisser 5 000 francs par Wave. Tu confirmes ?");
  assert.equal(confirm.awaitingConfirm, true);
  assert.deepEqual(calls, { collect: 0, transfer: 0 }, "toujours rien avant le oui");

  const done = say("oui");
  assert.equal(done.reply, "C'est lancé. Le client peut scanner et payer.");
  assert.deepEqual(calls, { collect: 1, transfer: 0 });
});

test("dialogue : répondre « envoyer » demande le bénéficiaire", () => {
  const { say } = setup();
  say("5000 francs");
  assert.equal(say("envoyer").reply, "À qui veux-tu l'envoyer ?");
  assert.match(say("Mamadou").reply, /Tu envoies 5 000 francs à Mamadou/);
});

test("dialogue : la réponse peut être mal prononcée aussi", () => {
  const a = setup();
  a.say("5000 francs par Wave");
  assert.equal(a.say("on casse").awaitingConfirm, true);
  const b = setup();
  b.say("5000 francs par Wave");
  assert.equal(b.say("en voie").reply, "À qui veux-tu l'envoyer ?");
});

test("dialogue : réponse incompréhensible ou « oui » : on redemande, jamais d'exécution", () => {
  const { say, calls } = setup();
  say("5000 francs par Wave");
  assert.equal(say("euh").reply, "Dis encaisser ou envoyer.");
  assert.equal(say("oui").reply, "Dis encaisser ou envoyer.", "un oui ne choisit rien");
  assert.equal(say("").reply, "Je n'ai pas entendu. Tu peux répéter ?");
  assert.deepEqual(calls, { collect: 0, transfer: 0 });
  assert.equal(say("encaisser").awaitingConfirm, true, "la question tient toujours");
});

test("dialogue : « non » annule", () => {
  const { say, calls, store } = setup();
  say("5000 francs par Wave");
  assert.equal(say("non").reply, "D'accord, j'annule.");
  assert.equal(say("oui").reply, "Il n'y a rien à confirmer pour le moment.");
  assert.deepEqual(calls, { collect: 0, transfer: 0 });
  assert.equal(store.operations.length, 10, "aucune opération créée");
});

test("dialogue : une commande complète pendant la question remplace le montant gardé", () => {
  const { say } = setup();
  say("5000 francs par Wave");
  assert.equal(say("Encaisse dix mille francs par Orange").reply, "Tu veux encaisser 10 000 francs par Orange. Tu confirmes ?");
});

test("dialogue : un montant trop petit est refusé après le choix du verbe", () => {
  const { say, calls } = setup();
  assert.equal(say("2 francs").reply, "Tu veux encaisser ou envoyer 2 francs ?");
  assert.match(say("encaisser").reply, /Le minimum est de 5 francs/);
  assert.deepEqual(calls, { collect: 0, transfer: 0 });
});

test("dialogue : le moyen de paiement dit avec le verbe est retenu", () => {
  const { say } = setup();
  say("5000 francs");
  assert.equal(say("encaisser par Orange").reply, "Tu veux encaisser 5 000 francs par Orange. Tu confirmes ?");
});

test("dialogue : deux sessions ne se mélangent pas", () => {
  const { say } = setup();
  say("5000 francs par Wave", "a");
  assert.equal(say("encaisser", "b").reply, "Quel montant veux-tu encaisser ?");
  assert.equal(say("encaisser", "a").awaitingConfirm, true);
});
