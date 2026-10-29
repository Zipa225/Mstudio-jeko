import test from "node:test";
import assert from "node:assert/strict";
import { createDialog } from "../src/lib/dialog";
import { findAnswer, KB, summarize } from "../src/lib/kb";
import { parseIntent } from "../src/lib/intent";
import type { Cashier } from "../src/lib/ports";
import { Store } from "../src/lib/store";
import { sourceLine } from "../src/app/marchand/view";

const NOON = new Date(Date.UTC(2026, 9, 29, 12, 0, 0));

function setup() {
  const store = new Store(() => NOON, true);
  let moved = 0;
  const cashier: Cashier = {
    createPaymentRequest() {
      moved++;
      return { id: "pr_1" };
    },
    createTransfer() {
      moved++;
      return { id: "tr_1" };
    },
  };
  const dialog = createDialog({ store, cashier });
  return { store, say: (text: string, session = "s") => dialog.handleTurn(session, text), moved: () => moved };
}

const handoffs = (store: Store) => store.alerts.filter((a) => a.type === "handoff");

// --- La base -------------------------------------------------------------------------------

test("base : chaque entrée cite une source, a une réponse affichée et une réponse parlée", () => {
  const ids = new Set<string>();
  for (const e of KB) {
    assert.ok(e.source.trim().length > 5, `${e.id} : source`);
    assert.ok(e.reply.length > 20 && e.speech.length > 20, `${e.id} : textes`);
    assert.ok(e.keywords.length > 0, `${e.id} : mots-clés`);
    assert.ok(!ids.has(e.id), `${e.id} : identifiant unique`);
    ids.add(e.id);
    for (const k of e.keywords) assert.equal(k, k.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, ""), `${e.id} : « ${k} » sans accent ni majuscule`);
    assert.ok(!/\d/.test(e.speech), `${e.id} : la voix dit les chiffres en lettres`);
  }
});

test("base : une réponse par sujet", () => {
  const cases: Array<[string, string]> = [
    ["Quels sont les frais ?", "frais"],
    ["Combien vous prenez de commission ?", "frais"],
    ["C'est quoi le tarif de la JèkoBox ?", "frais"],
    ["Combien coûte un virement bancaire ?", "virement"],
    ["Quand est-ce que j'ai mon argent ? Quel est le délai de reversement ?", "reversement"],
    ["Où acheter une JèkoBox et quel est son prix ?", "box"],
    ["Vous acceptez quels moyens de paiement ?", "moyens"],
    ["Est-ce que vous acceptez les cartes Visa ?", "moyens"],
    ["Dans quels pays vous êtes ?", "pays"],
    ["Vous êtes basés à Abidjan ?", "pays"],
    ["Comment je peux vous contacter ?", "contact"],
    ["Quels sont vos horaires ?", "contact"],
    ["Pourquoi ma vérification est demandée ?", "verification"],
    ["J'ai atteint la limite de 200 000, comment augmenter mon plafond ?", "plafond"],
  ];
  for (const [question, expected] of cases) assert.equal(findAnswer(question)?.entry.id, expected, question);
});

test("base : le pluriel et les accents n'empêchent pas la réponse", () => {
  assert.equal(findAnswer("Les FRAIS")?.entry.id, "frais");
  assert.equal(findAnswer("les tarifs")?.entry.id, "frais");
  assert.equal(findAnswer("les plafonds")?.entry.id, "plafond");
  assert.equal(findAnswer("la vérification")?.entry.id, "verification");
});

test("base : une question hors base ne reçoit aucune réponse", () => {
  for (const question of ["Quel temps fait-il demain ?", "Comment cuire du riz ?", "bonjour", ""]) {
    assert.equal(findAnswer(question), undefined, question);
  }
});

test("base : les faits chiffrés sont ceux des sources", () => {
  const frais = KB.find((e) => e.id === "frais")!;
  assert.match(frais.reply, /1,5 %/);
  assert.match(frais.reply, /1 %/);
  assert.match(frais.speech, /un virgule cinq pour cent/);
  assert.match(KB.find((e) => e.id === "virement")!.reply, /1 000 FCFA/);
  assert.match(KB.find((e) => e.id === "box")!.reply, /50 000 FCFA/);
  assert.match(KB.find((e) => e.id === "box")!.reply, /25 000 FCFA par an/);
  const plafond = KB.find((e) => e.id === "plafond")!;
  assert.match(plafond.reply, /200\s000 FCFA/);
  assert.match(plafond.speech, /deux cent mille francs/);
  assert.match(plafond.reply, /à confirmer/, "le plafond n'est pas présenté comme certain");
  assert.equal(plafond.handoff, true);
  assert.match(KB.find((e) => e.id === "contact")!.reply, /07 97 71 44 32/);
});

test("résumé : une ligne, bornée", () => {
  assert.equal(summarize("  bonjour\n\n  le   monde \t"), "bonjour le monde");
  const long = summarize("a".repeat(500));
  assert.equal(long.length, 200);
  assert.ok(long.endsWith("…"));
  assert.equal(summarize("court", 200), "court");
});

test("écran : la ligne « Source » n'existe que s'il y a une source", () => {
  assert.equal(sourceLine("jeko.africa, page Tarifs"), "Source : jeko.africa, page Tarifs");
  assert.equal(sourceLine(undefined), undefined);
  assert.equal(sourceLine("   "), undefined);
});

// --- Dans le dialogue ----------------------------------------------------------------------------

test("dialogue : une question de support reçoit une réponse sourcée, sans alerte ni opération", () => {
  const { store, say, moved } = setup();
  const before = store.operations.length;
  const r = say("Quels sont les frais ?");
  assert.equal(r.source, "jeko.africa, page Tarifs");
  assert.match(r.reply, /1,5 %/);
  assert.match(r.speech, /pour cent/);
  assert.equal(r.tone, "info");
  assert.equal(r.awaitingConfirm, false);
  assert.equal(handoffs(store).length, 0);
  assert.equal(store.operations.length, before);
  assert.equal(moved(), 0);
});

test("dialogue : la question du plafond répond avec sa source et passe aussi la main à un conseiller", () => {
  const { store, say, moved } = setup();
  const r = say("J'ai atteint la limite de 200 000, comment augmenter mon plafond ?");
  assert.match(r.reply, /plafond de ton compte est de 200\s000 FCFA/);
  assert.match(r.reply, /conseiller Jèko/);
  assert.equal(r.source, "Notes des ingénieurs Jèko (plafond à confirmer)");
  const [alert] = handoffs(store);
  assert.equal(handoffs(store).length, 1);
  assert.equal(alert.level, "info");
  assert.equal(alert.title, "Question passée à un conseiller");
  assert.match(alert.detail, /limite de 200 000/);
  assert.match(alert.detail, /Réponse partielle/);
  assert.equal(moved(), 0);
});

test("dialogue : une question hors base passe à un conseiller avec un résumé, sans source", () => {
  const { store, say } = setup();
  const r = say("Comment je fais pour changer le nom de ma boutique ?");
  assert.match(r.reply, /Je passe ta question à un conseiller Jèko/);
  assert.equal(r.source, undefined);
  const [alert] = handoffs(store);
  assert.equal(handoffs(store).length, 1);
  assert.match(alert.detail, /changer le nom de ma boutique/);
  assert.match(alert.detail, /Hors de la base/);
});

test("dialogue : un résumé trop long est borné dans l'alerte", () => {
  const { store, say } = setup();
  say(`Comment faire pour ${"truc ".repeat(200)}?`);
  assert.ok(handoffs(store)[0].detail.length < 400);
});

test("dialogue : une question de support pendant une confirmation n'exécute rien", () => {
  const { say, moved } = setup();
  say("Encaisse cinq mille francs par Wave");
  const r = say("Quels sont les frais ?");
  assert.equal(r.awaitingConfirm, true, "l'agent redemande la confirmation, il n'exécute pas");
  assert.equal(moved(), 0);
});

test("intention : les nouvelles questions d'assistance sont reconnues, jamais les ordres", () => {
  for (const q of [
    "Quels sont vos horaires ?", "Dans quel pays vous êtes ?", "Je veux parler à un conseiller", "Combien coûte un virement bancaire ?",
    "Quel est le délai de reversement ?", "Y a-t-il un abonnement ?",
    "vos horaires d'ouverture", "le pays de Jèko", "un virement bancaire", "mon reversement",
  ])assert.deepEqual(parseIntent(q), { kind: "support" }, q);
  assert.equal(parseIntent("Encaisse cinq mille francs par Wave").kind, "collect");
  assert.equal(parseIntent("Envoie cinq mille francs à Fatou").kind, "send");
});
