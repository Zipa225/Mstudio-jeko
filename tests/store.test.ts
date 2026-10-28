import test from "node:test";
import assert from "node:assert/strict";
import { BURST_WINDOW_MS, DEFAULT_AVG_TICKET, Store } from "../src/lib/store";

const at = (h: number, min = 0, day = 27) => new Date(Date.UTC(2026, 9, day, h, min, 0));

function clocked(start: Date, seed = true) {
  let current = start;
  const store = new Store(() => current, seed);
  return {
    store,
    set: (d: Date) => {
      current = d;
    },
    advance: (ms: number) => {
      current = new Date(current.getTime() + ms);
    },
  };
}

const collect = (amount: number, status: "paid" | "to_confirm" | "cancelled" = "paid") => ({
  kind: "collect" as const, amount, status, score: 0, decision: "accept" as const, factors: [], verifiedByVoice: false,
});

test("données d'exemple : 10 encaissements payés, panier moyen de 4 500 FCFA, 3 contacts", () => {
  const { store } = clocked(at(12));
  assert.equal(store.operations.length, 10);
  assert.ok(store.operations.every((o) => o.kind === "collect" && o.status === "paid"));
  assert.equal(store.avgTicket(), 4500);
  assert.deepEqual(store.merchant.contacts.map((c) => c.name), ["Fatou", "Mamadou", "Adjoua"]);
  assert.equal(store.alerts.length, 0);
});

test("les encaissements d'exemple ne comptent pas comme une rafale", () => {
  const { store } = clocked(at(12));
  assert.equal(store.previousOps(store.now()), 0);
});

test("contacts connus : sans tenir compte des accents ni de la casse, ou par numéro", () => {
  const { store } = clocked(at(12));
  for (const name of ["Fatou", "fatou", "FATOU", "Adjoua"]) assert.equal(store.isKnownContact({ name }), true, name);
  assert.equal(store.isKnownContact({ name: "Koné" }), false);
  assert.equal(store.isKnownContact({ phone: "0100000002" }), true);
  assert.equal(store.isKnownContact({ phone: "0701020304" }), false);
  assert.equal(store.isKnownContact({}), false);
});

test("panier moyen : seuls les encaissements payés comptent, valeur par défaut sinon", () => {
  const { store } = clocked(at(12), false);
  assert.equal(store.avgTicket(), DEFAULT_AVG_TICKET);
  store.addOperation(collect(1000, "paid"));
  store.addOperation(collect(3000, "paid"));
  store.addOperation(collect(900_000, "to_confirm"));
  store.addOperation({ ...collect(900_000, "paid"), kind: "send" });
  assert.equal(store.avgTicket(), 2000);
});

test("rafale : fenêtre de 10 minutes, bornes incluses, opérations annulées exclues", () => {
  const c = clocked(at(12), false);
  c.store.addOperation(collect(5000, "to_confirm"));
  c.store.addOperation(collect(5000, "cancelled"));
  assert.equal(c.store.previousOps(c.store.now()), 1, "l'annulée ne compte pas");

  c.advance(BURST_WINDOW_MS);
  assert.equal(c.store.previousOps(c.store.now()), 1, "pile 10 minutes : encore dans la fenêtre");
  c.advance(1);
  assert.equal(c.store.previousOps(c.store.now()), 0, "10 minutes et 1 ms : sorti de la fenêtre");
});

test("bilan du jour : jour calendaire à Abidjan (UTC), encaissements payés seulement", () => {
  const c = clocked(at(23, 59, 26), false);
  c.store.addOperation(collect(1000)); // la veille, 23 h 59
  c.set(at(0, 0, 27));
  c.store.addOperation(collect(2000)); // 00 h 00 exactement
  c.set(at(15));
  c.store.addOperation(collect(3000));
  c.store.addOperation(collect(9000, "to_confirm"));
  assert.deepEqual(c.store.paidToday(c.store.now()), { total: 5000, count: 2 });
  c.set(at(0, 0, 28));
  assert.deepEqual(c.store.paidToday(c.store.now()), { total: 0, count: 0 });
});

test("opérations : identifiant unique, horodatage de l'horloge injectée, mise à jour", () => {
  const c = clocked(at(12), false);
  const a = c.store.addOperation(collect(5000, "to_confirm"));
  c.advance(60_000);
  const b = c.store.addOperation(collect(6000, "to_confirm"));
  assert.notEqual(a.id, b.id);
  assert.equal(a.ts, at(12).getTime());
  assert.equal(b.ts, at(12, 1).getTime());

  c.store.updateOperation(a.id, { status: "awaiting_payment", paymentId: "pr_1" });
  assert.equal(c.store.getOperation(a.id)?.status, "awaiting_payment");
  assert.equal(c.store.getOperation(a.id)?.ts, a.ts, "l'horodatage ne change pas");
  assert.equal(c.store.getOperation(undefined), undefined);
  assert.equal(c.store.getOperation("inconnu"), undefined);
  assert.throws(() => c.store.updateOperation("inconnu", { status: "paid" }), /inconnue/);
});

test("alertes : horodatées et rangées dans l'ordre d'arrivée", () => {
  const c = clocked(at(12), false);
  const first = c.store.addAlert({ level: "info", type: "verified", title: "a", detail: "a" });
  c.advance(1000);
  const second = c.store.addAlert({ level: "critical", type: "duress", title: "b", detail: "b" });
  assert.deepEqual(c.store.alerts.map((a) => a.id), [first.id, second.id]);
  assert.equal(second.ts - first.ts, 1000);
});

test("sessions : une par identifiant, indépendantes", () => {
  const { store } = clocked(at(12));
  const a = store.getSession("a");
  assert.equal(store.getSession("a"), a);
  a.pending = { stage: "need_amount", kind: "collect" };
  assert.equal(store.getSession("b").pending, undefined);
});

test("remise à zéro : efface tout et recharge les données d'exemple", () => {
  const { store } = clocked(at(12));
  store.addOperation(collect(5000, "to_confirm"));
  store.addAlert({ level: "info", type: "verified", title: "x", detail: "x" });
  store.getSession("a").pending = { stage: "need_amount", kind: "send" };
  store.reset();
  assert.equal(store.operations.length, 10);
  assert.equal(store.alerts.length, 0);
  assert.equal(store.getSession("a").pending, undefined);
  store.reset(false);
  assert.equal(store.operations.length, 0);
  assert.equal(store.merchant.contacts.length, 0);
});
