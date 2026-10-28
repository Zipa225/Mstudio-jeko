import test, { afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import { createDialog, type TurnResult } from "../src/lib/dialog";
import { createDuressGuard, duressStatus, publicTranscript } from "../src/lib/duress";
import type { Wallet } from "../src/lib/intent";
import type { Cashier } from "../src/lib/ports";
import { Store } from "../src/lib/store";
import { containsFuzzyPhrase, levenshtein, normalize, phraseKeywords } from "../src/lib/text";

// Phrase de TEST, neutre : jamais la vraie phrase de la démonstration.
const PHRASE = "le manioc cuit doucement";
// Les mots distinctifs : s'ils apparaissent quelque part, c'est une fuite.
const LEAK_KEYS = phraseKeywords(PHRASE).filter((k) => k.length >= 6);
const leaks = (s: string) => LEAK_KEYS.some((k) => normalize(s).includes(k));

const NOON = new Date(Date.UTC(2026, 9, 27, 12, 0, 0));

function setup(phrase: string | undefined = PHRASE) {
  const store = new Store(() => NOON);
  const calls = { collect: [] as Array<{ amount: number; wallet?: Wallet }>, transfer: [] as Array<{ amount: number; to: string }> };
  let n = 0;
  const cashier: Cashier = {
    createPaymentRequest(args) {
      calls.collect.push(args);
      return { id: `pr_${++n}` };
    },
    createTransfer(args) {
      calls.transfer.push(args);
      return { id: `tr_${++n}` };
    },
  };
  const dialog = createDialog({ store, cashier, guard: createDuressGuard(store, () => phrase) });
  const say = (text: string, sessionId = "s") => dialog.handleTurn(sessionId, text);
  const noMoney = () => calls.collect.length + calls.transfer.length === 0;
  return { store, calls, say, noMoney };
}

afterEach(() => mock.restoreAll());

// --- Détection floue --------------------------------------------------------

test("levenshtein : nombre de modifications entre deux mots", () => {
  assert.equal(levenshtein("manioc", "manioc"), 0);
  assert.equal(levenshtein("manioc", "maniok"), 1);
  assert.equal(levenshtein("doucement", "doucemment"), 1);
  assert.equal(levenshtein("", "abc"), 3);
  assert.equal(levenshtein("abc", ""), 3);
  assert.equal(levenshtein("chat", "chien"), 3);
});

test("phrase reconnue : exacte, noyée dans une phrase, ou avec une erreur de transcription", () => {
  assert.ok(containsFuzzyPhrase(PHRASE, PHRASE));
  assert.ok(containsFuzzyPhrase("oui, c'est bon, le manioc cuit doucement", PHRASE));
  assert.ok(containsFuzzyPhrase("oui oui vas-y, le manioc cuit doucement, merci", PHRASE));
  assert.ok(containsFuzzyPhrase("oui le maniok cuit doucement", PHRASE), "une lettre fausse sur manioc");
  assert.ok(containsFuzzyPhrase("oui le manioc cuit doucemment", PHRASE), "une lettre en trop");
  assert.ok(containsFuzzyPhrase("LE MANIOC CUIT DOUCEMENT", PHRASE), "majuscules");
});

test("phrase non reconnue : un mot manquant, une phrase voisine, une phrase banale", () => {
  assert.ok(!containsFuzzyPhrase("oui c'est bon", PHRASE));
  assert.ok(!containsFuzzyPhrase("le manioc est cuit", PHRASE), "il manque doucement");
  assert.ok(!containsFuzzyPhrase("le manioc", PHRASE));
  assert.ok(!containsFuzzyPhrase("", PHRASE));
  assert.ok(!containsFuzzyPhrase("oui le maniaca cuit doucement", PHRASE), "deux lettres d'écart : pas assez proche");
});

test("phrase trop faible (moins de deux mots qui comptent) : jamais reconnue", () => {
  assert.ok(!containsFuzzyPhrase("oui la marmite", "la marmite"), "un seul mot de 4 lettres ou plus");
  assert.ok(!containsFuzzyPhrase("oui le feu", "le feu"));
  assert.equal(duressStatus("la marmite"), "weak");
  assert.equal(duressStatus("le feu"), "weak");
});

test("statut de la détection : désactivée, faible ou active, sans jamais révéler la phrase", () => {
  assert.equal(duressStatus(undefined), "disabled");
  assert.equal(duressStatus(""), "disabled");
  assert.equal(duressStatus(PHRASE), "active");
});

// --- Parcours : le transfert sous contrainte --------------------------------

test("sous contrainte, la réponse est strictement identique à un succès normal (transfert)", () => {
  const normal = setup();
  normal.say("Envoie cent cinquante mille francs à Koné");
  const ok = normal.say("oui");

  const forced = setup();
  forced.say("Envoie cent cinquante mille francs à Koné");
  const duress = forced.say(`oui, c'est bon, ${PHRASE}`);

  assert.deepEqual(duress, ok, "même texte, même voix, même état, mêmes champs");
  assert.equal(duress.reply, "C'est envoyé. 150 000 francs à Koné.");
});

test("sous contrainte, l'encaissement est identique lui aussi (identifiant de paiement mis à part)", () => {
  const normal = setup();
  normal.say("Encaisse cinq mille francs par Wave");
  const ok = normal.say("oui");

  const forced = setup();
  forced.say("Encaisse cinq mille francs par Wave");
  const duress = forced.say(`oui ${PHRASE}`);

  assert.deepEqual({ ...duress, payment: { ...duress.payment!, id: "x" } }, { ...ok, payment: { ...ok.payment!, id: "x" } });
  assert.ok(duress.payment?.id, "un identifiant est fourni, comme pour un vrai paiement");
  assert.notEqual(duress.payment?.id, ok.payment?.id);
});

test("sous contrainte : rien n'est transféré, l'opération est retenue, l'alerte est critique", () => {
  const { say, store, calls, noMoney } = setup();
  say("Envoie cent cinquante mille francs à Koné");
  say(`oui, ${PHRASE}`);

  assert.ok(noMoney(), "la caisse n'est jamais appelée");
  const op = store.operations.at(-1)!;
  assert.deepEqual([op.kind, op.status, op.amount, op.beneficiary], ["send", "held", 150_000, "Koné"]);
  assert.equal(store.operations.filter((o) => o.status === "executed").length, 0);

  const alert = store.alerts.at(-1)!;
  assert.deepEqual([alert.level, alert.type, alert.title], ["critical", "duress", "Contrainte signalée"]);
  assert.equal(alert.operationId, op.id);
  assert.equal(alert.score, 60);
  assert.ok(alert.factors!.length > 0, "les raisons du score accompagnent l'alerte");
  assert.match(alert.detail, /Transfert de 150 000 FCFA vers Koné/);
  assert.match(alert.detail, /Aucune somme n'a été transférée/);
  assert.equal(calls.transfer.length, 0);
});

test("sous contrainte, un encaissement est retenu aussi", () => {
  const { say, store, calls } = setup();
  say("Encaisse 5000 francs");
  say(`oui ${PHRASE}`);
  assert.equal(calls.collect.length, 0);
  assert.equal(store.operations.at(-1)!.status, "held");
  assert.match(store.alerts.at(-1)!.detail, /Aucun encaissement n'a été lancé/);
});

test("la phrase est reconnue malgré une erreur de transcription, et sans « oui »", () => {
  const a = setup();
  a.say("Envoie cent cinquante mille francs à Koné");
  a.say("oui c'est bon le maniok cuit doucemment");
  assert.equal(a.store.operations.at(-1)!.status, "held");

  const b = setup();
  b.say("Envoie cent cinquante mille francs à Koné");
  b.say(`non non, ${PHRASE}`);
  assert.equal(b.store.operations.at(-1)!.status, "held", "la phrase l'emporte même mêlée à un non");
  assert.ok(b.noMoney());
});

test("après la contrainte, un oui ne confirme plus rien", () => {
  const { say, noMoney } = setup();
  say("Envoie cent cinquante mille francs à Koné");
  say(`oui ${PHRASE}`);
  assert.match(say("oui").reply, /rien à confirmer/);
  assert.ok(noMoney());
});

test("phrase dite sans opération à confirmer : alerte discrète, rien ne se déroule", () => {
  const idle = setup();
  const r = idle.say(PHRASE);
  assert.equal(r.reply, "D'accord. Je suis là si tu as besoin.");
  assert.equal(idle.store.alerts.at(-1)!.level, "critical");
  assert.equal(idle.store.alerts.at(-1)!.operationId, undefined);
  assert.equal(idle.store.operations.length, 10, "aucune opération créée");

  const early = setup();
  early.say("Envoie cent cinquante mille francs");
  early.say(`à Koné, ${PHRASE}`);
  assert.equal(early.store.alerts.at(-1)!.title, "Code de contrainte reçu");
  assert.ok(early.noMoney());
  assert.match(early.say("oui").reply, /rien à confirmer/, "la commande en cours est abandonnée");
  assert.ok(early.noMoney());
});

test("les conversations normales ne sont pas touchées par le garde", () => {
  const { say, calls, store } = setup();
  say("Encaisse 5000 francs");
  say("oui");
  assert.equal(calls.collect.length, 1);
  say("Envoie 150000 francs à Koné");
  say("oui c'est bon, vas-y");
  assert.equal(calls.transfer.length, 1);
  assert.equal(store.alerts.filter((a) => a.type === "duress").length, 0);
});

test("sans phrase configurée, rien n'est détecté : la fonction est désactivée, pas devinée", () => {
  const { say, calls, store } = setup("");
  say("Envoie cent cinquante mille francs à Koné");
  say(`oui ${PHRASE}`);
  assert.equal(calls.transfer.length, 1);
  assert.equal(store.alerts.filter((a) => a.type === "duress").length, 0);
});

// --- La phrase ne fuit nulle part ------------------------------------------

test("la phrase n'apparaît ni dans les réponses, ni dans l'état, ni dans les logs", () => {
  const logged: string[] = [];
  for (const m of ["log", "info", "warn", "error", "debug"] as const) {
    mock.method(console, m, (...args: unknown[]) => {
      logged.push(args.map(String).join(" "));
    });
  }

  const { say, store } = setup();
  const replies: TurnResult[] = [
    say("Envoie cent cinquante mille francs à Koné"),
    say(`oui, c'est bon, ${PHRASE}`),
    say(PHRASE),
    say("Encaisse 5000 francs"),
    say(`oui ${PHRASE}`),
  ];
  for (const r of replies) {
    assert.equal(leaks(r.reply), false, "écran du marchand");
    assert.equal(leaks(r.speech), false, "voix");
  }
  const dump = JSON.stringify({
    merchant: store.merchant, operations: store.operations, alerts: store.alerts, sessions: store.getSession("s"),
  });
  assert.equal(leaks(dump), false, "l'état en mémoire ne garde pas la phrase");
  assert.equal(leaks(logged.join("\n")), false, "aucune sortie console");
  assert.ok(store.alerts.filter((a) => a.level === "critical").length >= 3, "les alertes existent bien");
});

test("ce que l'écran affiche de la phrase du marchand : la phrase est retirée", () => {
  assert.equal(publicTranscript(`oui, ${PHRASE}`, PHRASE), "Oui");
  assert.equal(publicTranscript(PHRASE, PHRASE), "…");
  assert.equal(publicTranscript("encaisse cinq mille francs par Wave", PHRASE), "encaisse cinq mille francs par Wave");
  assert.equal(publicTranscript(`oui, ${PHRASE}`, undefined), `oui, ${PHRASE}`, "sans phrase configurée, rien à cacher");
  assert.equal(publicTranscript(`oui, ${PHRASE}`, ""), `oui, ${PHRASE}`);
  assert.equal(leaks(publicTranscript(`oui c'est bon le maniok cuit doucemment`, PHRASE)), false);
});
