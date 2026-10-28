import test from "node:test";
import assert from "node:assert/strict";
import { createDialog, type ConfirmationGuard, type TurnResult } from "../src/lib/dialog";
import type { Wallet } from "../src/lib/intent";
import type { Cashier } from "../src/lib/ports";
import { Store } from "../src/lib/store";
import { formatXof } from "../src/lib/text";

// Midi à Abidjan (UTC) : aucun critère de nuit par accident.
const NOON = new Date(Date.UTC(2026, 9, 27, 12, 0, 0));

function setup(opts: { seed?: boolean; at?: Date; failing?: boolean; guard?: ConfirmationGuard } = {}) {
  const store = new Store(() => opts.at ?? NOON, opts.seed ?? true);
  const calls = {
    collect: [] as Array<{ amount: number; wallet?: Wallet }>,
    transfer: [] as Array<{ amount: number; to: string }>,
  };
  let n = 0;
  const cashier: Cashier = {
    createPaymentRequest(args) {
      if (opts.failing) throw new Error("caisse hors service");
      calls.collect.push(args);
      return { id: `pr_${++n}` };
    },
    createTransfer(args) {
      if (opts.failing) throw new Error("caisse hors service");
      calls.transfer.push(args);
      return { id: `tr_${++n}` };
    },
  };
  const dialog = createDialog({ store, cashier, guard: opts.guard });
  const say = (text: string, sessionId = "s") => dialog.handleTurn(sessionId, text);
  const last = () => store.operations[store.operations.length - 1];
  return { store, calls, say, last };
}

const noMoneyMoved = (calls: ReturnType<typeof setup>["calls"]) => calls.collect.length + calls.transfer.length === 0;

// --- Encaissement ----------------------------------------------------------

test("encaissement : relecture du montant, puis rien ne part avant le oui", () => {
  const { say, calls, last } = setup();
  const a = say("Encaisse cinq mille francs par Wave");
  assert.equal(a.awaitingConfirm, true);
  assert.equal(a.reply, "Tu veux encaisser 5 000 francs par Wave. Tu confirmes ?");
  assert.equal(a.speech, "Tu veux encaisser cinq mille francs par Wave. Tu confirmes ?");
  assert.ok(noMoneyMoved(calls), "la caisse n'est pas appelée avant le oui");
  assert.deepEqual([last().status, last().decision, last().score], ["to_confirm", "accept", 0]);

  const b = say("oui");
  assert.equal(b.reply, "C'est lancé. Le client peut scanner et payer.");
  assert.deepEqual(b.payment, { id: "pr_1", amount: 5000, wallet: "wave" });
  assert.deepEqual(calls.collect, [{ amount: 5000, wallet: "wave" }]);
  assert.deepEqual([last().status, last().paymentId], ["awaiting_payment", "pr_1"]);
});

test("encaissement sans moyen de paiement : pas de champ wallet", () => {
  const { say } = setup();
  say("Encaisse 5000 francs");
  const r = say("oui");
  assert.deepEqual(r.payment, { id: "pr_1", amount: 5000 });
});

test("montant manquant : l'agent le demande, puis relit", () => {
  const { say } = setup();
  const a = say("Encaisse par Wave");
  assert.equal(a.reply, "Quel montant veux-tu encaisser ?");
  assert.equal(a.awaitingConfirm, false);
  const b = say("dix mille francs");
  assert.equal(b.awaitingConfirm, true);
  assert.match(b.reply, /encaisser 10 000 francs par Wave/, "le moyen de paiement dit au début est gardé");
});

test("montant trop petit : le minimum est rappelé, la commande reste ouverte", () => {
  const { say, calls } = setup();
  const a = say("Encaisse 3 francs");
  assert.match(a.reply, /Le minimum est de 5 francs/);
  assert.equal(a.awaitingConfirm, false);
  assert.match(say("dix mille francs").reply, /10 000/);
  assert.ok(noMoneyMoved(calls));
});

test("encaissement au-dessus du plafond : explication, aucune opération créée", () => {
  const { say, store, calls } = setup();
  const r = say("Encaisse 250 000 francs");
  assert.match(r.reply, /plafond de 200 000 francs/);
  assert.equal(r.awaitingConfirm, false);
  assert.equal(store.operations.length, 10, "seulement les données d'exemple");
  assert.ok(noMoneyMoved(calls));
  assert.match(say("oui").reply, /rien à confirmer/);
  assert.ok(noMoneyMoved(calls));
});

test("encaissement pile au plafond : autorisé, avec relecture", () => {
  const { say } = setup();
  const r = say("Encaisse 200 000 francs");
  assert.equal(r.awaitingConfirm, true);
  assert.match(r.reply, /200 000/);
});

// --- Transfert : démo ------------------------------------------------------

test("démo : transfert de 150 000 FCFA à un inconnu, raison dite à voix haute avant le oui", () => {
  const { say, calls, store, last } = setup();
  const a = say("Envoie cent cinquante mille francs à Koné");
  assert.equal(a.awaitingConfirm, true);
  assert.match(a.reply, /^Attention\./);
  assert.match(a.reply, /nouveau numéro pour toi/);
  assert.match(a.reply, /beaucoup plus que d'habitude/);
  assert.match(a.reply, /Tu envoies 150 000 francs à Koné\. C'est bien toi qui décides \?$/);
  assert.match(a.speech, /cent cinquante mille francs/);
  assert.deepEqual([last().decision, last().score], ["verify", 60]);
  assert.ok(noMoneyMoved(calls));

  const b = say("oui");
  assert.equal(b.reply, "C'est envoyé. 150 000 francs à Koné.");
  assert.deepEqual(calls.transfer, [{ amount: 150_000, to: "Koné" }]);
  assert.deepEqual([last().status, last().verifiedByVoice], ["executed", true]);
  const alert = store.alerts.at(-1)!;
  assert.deepEqual([alert.level, alert.type, alert.operationId], ["info", "verified", last().id]);
});

test("démo : transfert de 250 000 FCFA, bloqué avec une alerte de rappel", () => {
  const { say, calls, store, last } = setup();
  const a = say("Envoie deux cent cinquante mille francs à Koné");
  assert.match(a.reply, /Je ne peux pas faire ça maintenant/);
  assert.equal(a.awaitingConfirm, false);
  assert.deepEqual([last().status, last().decision, last().score], ["blocked", "block", 85]);
  const alert = store.alerts.at(-1)!;
  assert.deepEqual([alert.level, alert.type], ["warning", "blocked"]);
  assert.match(alert.title, /rappel à faire/);
  assert.match(alert.detail, /250 000 FCFA vers Koné/);
  assert.equal(alert.operationId, last().id);
  assert.ok(noMoneyMoved(calls));
  assert.match(say("oui").reply, /rien à confirmer/);
  assert.ok(noMoneyMoved(calls), "un oui après un refus n'exécute rien");
});

test("transfert à un contact connu : pas de question de vérification", () => {
  const { say, last } = setup();
  const r = say("Envoie 5000 à Fatou");
  assert.equal(r.reply, "Tu envoies 5 000 francs à Fatou. Tu confirmes ?");
  assert.deepEqual([last().decision, last().score], ["accept", 10]);
});

test("bénéficiaire manquant : l'agent le demande, un nom seul suffit", () => {
  const { say, calls } = setup();
  assert.equal(say("Envoie vingt mille francs").reply, "À qui veux-tu l'envoyer ?");
  const r = say("Fatou");
  assert.match(r.reply, /Tu envoies 20 000 francs à Fatou/);
  say("oui");
  assert.deepEqual(calls.transfer, [{ amount: 20_000, to: "Fatou" }]);
});

test("bénéficiaire par numéro de téléphone", () => {
  const { say, calls } = setup();
  const r = say("envoie 5000 au 0701020304");
  assert.match(r.reply, /à 07 01 02 03 04/);
  say("oui");
  assert.deepEqual(calls.transfer, [{ amount: 5000, to: "0701020304" }]);
});

test("les accents du bénéficiaire sont conservés", () => {
  const { say } = setup();
  assert.match(say("Envoie vingt mille francs à Koné").reply, /à Koné\./);
});

test("transfert de nuit : le critère d'heure est pris en compte", () => {
  const { say, last } = setup({ at: new Date(Date.UTC(2026, 9, 27, 23, 0, 0)) });
  say("Envoie 5000 à Fatou");
  assert.ok(last().factors.some((f) => f.id === "night"));
  assert.equal(last().score, 25);
});

test("rafale : la troisième opération en 10 minutes déclenche le critère", () => {
  const { say, last } = setup();
  for (let i = 0; i < 3; i++) {
    say("Encaisse 5000 francs");
    if (i < 2) say("oui");
  }
  assert.ok(last().factors.some((f) => f.id === "velocity"));
  assert.equal(last().score, 15);
});

// --- Garde-fous : jamais d'argent sans oui ----------------------------------

test("annulation : rien ne part, l'opération est marquée annulée", () => {
  const { say, calls, last } = setup();
  say("Encaisse 5000 francs");
  assert.equal(say("non").reply, "D'accord, j'annule.");
  assert.equal(last().status, "cancelled");
  assert.ok(noMoneyMoved(calls));
  assert.match(say("oui").reply, /rien à confirmer/);
  assert.ok(noMoneyMoved(calls));
});

test("annulation pendant les questions : la commande disparaît", () => {
  const { say, store, calls } = setup();
  say("Envoie vingt mille francs");
  assert.match(say("annule").reply, /annule/);
  assert.match(say("Fatou").reply, /pas bien compris/);
  assert.equal(store.operations.length, 10);
  assert.ok(noMoneyMoved(calls));
});

test("changement de commande : la nouvelle remplace l'ancienne et repasse par une relecture", () => {
  const { say, calls, store } = setup();
  say("Encaisse 5000 francs");
  const first = store.operations.at(-1)!;
  const b = say("en fait encaisse 8000 francs");
  assert.equal(b.awaitingConfirm, true);
  assert.match(b.reply, /8 000/);
  assert.equal(first.status, "cancelled");
  assert.ok(noMoneyMoved(calls), "un changement ne confirme jamais");
  say("oui");
  assert.deepEqual(calls.collect, [{ amount: 8000, wallet: undefined }]);
});

test("changement de type : « non, envoie 3000 à Fatou » remplace un encaissement", () => {
  const { say, calls } = setup();
  say("Encaisse 5000 francs");
  assert.match(say("non envoie 3000 à Fatou").reply, /Tu envoies 3 000 francs à Fatou/);
  assert.ok(noMoneyMoved(calls));
});

test("réponses ambiguës : l'agent redemande, rien ne part, puis un vrai oui exécute une seule fois", () => {
  const { say, calls } = setup();
  say("Encaisse 5000 francs");
  for (const text of ["oui non", "je ne confirme pas", "peut-être", "euh", "c'est pas bon"]) {
    const r = say(text);
    assert.equal(r.awaitingConfirm, true, text);
    assert.match(r.reply, /Dis oui pour confirmer/, text);
  }
  assert.ok(noMoneyMoved(calls));
  say("oui");
  assert.equal(calls.collect.length, 1);
});

test("deux oui de suite : une seule exécution", () => {
  const { say, calls } = setup();
  say("Encaisse 5000 francs");
  say("oui");
  assert.match(say("oui").reply, /rien à confirmer/);
  assert.equal(calls.collect.length, 1);
});

test("« oui, envoie » confirme un envoi ; « oui, encaisse » ne confirme pas un envoi", () => {
  const a = setup();
  a.say("Envoie 5000 à Fatou");
  a.say("oui, envoie");
  assert.equal(a.calls.transfer.length, 1);

  const b = setup();
  b.say("Envoie 5000 à Fatou");
  const r = b.say("oui, encaisse");
  assert.equal(r.awaitingConfirm, true);
  assert.ok(noMoneyMoved(b.calls));
});

test("oui ou non sans rien à confirmer : jamais d'exécution", () => {
  const { say, calls } = setup();
  assert.match(say("oui").reply, /rien à confirmer/);
  assert.match(say("non").reply, /rien à confirmer/);
  assert.match(say("ok d'accord").reply, /rien à confirmer/);
  assert.ok(noMoneyMoved(calls));
});

test("le montant relu est le montant exécuté", () => {
  for (const amount of [5000, 12_500, 44_000, 99_000, 200_000]) {
    const { say, calls } = setup();
    const a = say(`Encaisse ${formatXof(amount)} francs`);
    assert.ok(a.reply.includes(formatXof(amount)), `relecture de ${amount}`);
    say("oui");
    assert.equal(calls.collect[0].amount, amount);
  }
});

test("sessions indépendantes : le oui d'une session ne confirme pas l'autre", () => {
  const { say, calls } = setup();
  say("Encaisse 5000 francs", "s1");
  assert.match(say("oui", "s2").reply, /rien à confirmer/);
  assert.ok(noMoneyMoved(calls));
  say("oui", "s1");
  assert.equal(calls.collect.length, 1);
});

test("garde de confirmation : appelé seulement à l'étape de confirmation, et il peut reprendre la main", () => {
  const seen: string[] = [];
  const guard: ConfirmationGuard = (text, op) => {
    seen.push(op.id);
    if (!text.includes("SECRET")) return undefined;
    return { reply: "C'est envoyé.", speech: "C'est envoyé.", awaitingConfirm: false };
  };
  const { say, calls, last } = setup({ guard });
  say("Envoie 5000 à Fatou");
  assert.equal(seen.length, 0, "pas appelé avant la confirmation");

  const r = say("oui SECRET");
  assert.equal(r.reply, "C'est envoyé.");
  assert.equal(seen.length, 1);
  assert.equal(seen[0], last().id);
  assert.ok(noMoneyMoved(calls), "le garde a repris la main : le dialogue n'exécute rien");
  assert.match(say("oui").reply, /rien à confirmer/);

  say("Envoie 6000 à Fatou");
  say("oui");
  assert.equal(calls.transfer.length, 1, "sans déclenchement du garde, le flux normal continue");
});

test("caisse en panne : message clair, opération échouée, alerte, aucune exécution fantôme", () => {
  const { say, store, last } = setup({ failing: true });
  say("Encaisse 5000 francs");
  const r = say("oui");
  assert.match(r.reply, /pas pu faire l'opération/);
  assert.equal(last().status, "failed");
  const alert = store.alerts.at(-1)!;
  assert.deepEqual([alert.level, alert.type, alert.operationId], ["warning", "failed", last().id]);
  assert.match(say("oui").reply, /rien à confirmer/);

  const t = setup({ failing: true });
  t.say("Envoie 5000 à Fatou");
  assert.match(t.say("oui").reply, /pas pu faire l'opération/);
  assert.equal(t.last().status, "failed");
});

// --- Questions, bilan, texte incompris -------------------------------------

test("bilan du jour", () => {
  const { say } = setup();
  assert.equal(say("Combien j'ai encaissé aujourd'hui ?").reply, "Aujourd'hui, tu as encaissé 45 000 francs, en 10 paiements.");

  const empty = setup({ seed: false });
  assert.equal(empty.say("fais-moi le bilan").reply, "Tu n'as encore rien encaissé aujourd'hui.");

  const one = setup({ seed: false });
  one.store.addOperation({ kind: "collect", amount: 7000, status: "paid", score: 0, decision: "accept", factors: [], verifiedByVoice: false });
  assert.equal(one.say("bilan").reply, "Aujourd'hui, tu as encaissé 7 000 francs, en 1 paiement.");
});

test("questions de support : réponse provisoire, aucune opération", () => {
  const { say, store, calls } = setup();
  const r = say("J'ai atteint la limite de 200 000, comment augmenter mon plafond ?");
  assert.match(r.reply, /conseiller Jèko/);
  assert.equal(store.operations.length, 10);
  assert.ok(noMoneyMoved(calls));
});

test("texte vide ou incompris : l'agent redemande", () => {
  const { say, calls } = setup();
  assert.match(say("").reply, /pas entendu/);
  assert.match(say("   ").reply, /pas entendu/);
  assert.match(say("il fait chaud").reply, /pas bien compris/);
  assert.ok(noMoneyMoved(calls));
});

test("pendant une confirmation, un texte vide redemande le oui ou le non", () => {
  const { say } = setup();
  say("Encaisse 5000 francs");
  const r = say("");
  assert.equal(r.awaitingConfirm, true);
});

test("montant non compris pendant la question : l'agent redemande", () => {
  const { say } = setup();
  say("Encaisse");
  assert.match(say("bof").reply, /pas compris le montant/);
  const t = setup();
  t.say("Envoie 5000");
  assert.match(t.say("euh").reply, /pas compris à qui/);
});

test("les réponses sont propres : montants en lettres à la voix, aucun marqueur ni undefined", () => {
  const { say } = setup();
  const results: TurnResult[] = [
    say("Encaisse cinq mille francs par Wave"), say("oui"),
    say("Envoie cent cinquante mille francs à Koné"), say("oui"),
    say("Envoie deux cent cinquante mille francs à Koné"),
    say("Encaisse 250 000 francs"), say("bilan"), say("Envoie 5000"), say("Fatou"), say("non"),
  ];
  for (const r of results) {
    assert.ok(!/\{\{|undefined|NaN|\[object/.test(r.reply + r.speech), r.reply);
    assert.ok(!/\d/.test(r.speech), `la voix ne lit pas de chiffres : ${r.speech}`);
  }
});
