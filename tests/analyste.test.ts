import test from "node:test";
import assert from "node:assert/strict";
import {
  ALERT_TONE_LABEL, counters, DECISION_LABEL, duressNotice, factorChip, formatClock, KIND_LABEL, operationTarget, pickBanner,
  STATUS_LABEL, STATUS_TONE,
} from "../src/app/analyste/view";
import type { Alert, Operation, OperationStatus } from "../src/lib/store";

const alert = (id: string, level: Alert["level"], over: Partial<Alert> = {}): Alert => ({
  id, ts: 0, level, type: level === "critical" ? "duress" : "blocked", title: id, detail: "d", ...over,
});

const op = (over: Partial<Operation>): Operation => ({
  id: "o", ts: 0, kind: "send", amount: 1000, status: "executed", score: 0, decision: "accept", factors: [], verifiedByVoice: false, ...over,
});

const ALL_STATUSES: OperationStatus[] = ["to_confirm", "awaiting_payment", "paid", "executed", "cancelled", "held", "blocked", "failed"];

test("bannière : la plus récente alerte critique non prise en compte", () => {
  const alerts = [alert("c2", "critical"), alert("w", "warning"), alert("c1", "critical")];
  assert.equal(pickBanner(alerts, new Set())?.id, "c2");
  assert.equal(pickBanner(alerts, new Set(["c2"]))?.id, "c1");
  assert.equal(pickBanner(alerts, new Set(["c2", "c1"])), undefined);
});

test("bannière : seules les alertes critiques déclenchent le rouge", () => {
  assert.equal(pickBanner([alert("w", "warning"), alert("i", "info")], new Set()), undefined);
  assert.equal(pickBanner([], new Set()), undefined);
});

test("compteurs : en cours regroupe à confirmer et en attente de paiement, sans compter les annulées", () => {
  const counts = Object.fromEntries(ALL_STATUSES.map((s) => [s, 0])) as Record<OperationStatus, number>;
  Object.assign(counts, { paid: 10, to_confirm: 1, awaiting_payment: 2, executed: 3, cancelled: 9, held: 1, blocked: 4, failed: 5 });
  const byId = Object.fromEntries(counters({ counts, criticalAlerts: 2 }).map((c) => [c.id, c]));
  assert.equal(byId.paid.value, 10);
  assert.equal(byId.pending.value, 3);
  assert.equal(byId.executed.value, 3);
  assert.equal(byId.blocked.value, 4);
  assert.equal(byId.held.value, 1);
  assert.equal(byId.critical.value, 2);
  assert.equal(Object.keys(byId).length, 6);
});

test("compteurs : retenues et alertes critiques sont mises en avant seulement quand elles sont positives", () => {
  const zero = Object.fromEntries(ALL_STATUSES.map((s) => [s, 0])) as Record<OperationStatus, number>;
  const calm = Object.fromEntries(counters({ counts: zero, criticalAlerts: 0 }).map((c) => [c.id, c.highlight]));
  assert.deepEqual([calm.held, calm.critical], [false, false]);
  const alarm = Object.fromEntries(counters({ counts: { ...zero, held: 1 }, criticalAlerts: 1 }).map((c) => [c.id, c.highlight]));
  assert.deepEqual([alarm.held, alarm.critical], [true, true]);
});

test("chaque état d'opération a un libellé français et une teinte, et le rouge n'est utilisé pour aucun état", () => {
  for (const s of ALL_STATUSES) {
    assert.ok(STATUS_LABEL[s].length > 0, s);
    assert.ok(["ok", "wait", "neutral", "held", "warn"].includes(STATUS_TONE[s]), s);
  }
  assert.equal(STATUS_LABEL.held, "Retenue");
  assert.equal(STATUS_LABEL.blocked, "Bloquée");
  assert.equal(STATUS_TONE.paid, "ok");
  assert.equal(STATUS_TONE.held, "held", "une opération retenue sous contrainte a sa propre teinte, distincte d'un refus");
  assert.equal(STATUS_TONE.cancelled, "neutral");
  assert.equal(STATUS_TONE.blocked, "warn");
  assert.deepEqual(KIND_LABEL, { collect: "Encaissement", send: "Transfert" });
  assert.deepEqual(DECISION_LABEL, { accept: "Accepté", verify: "À vérifier", block: "Bloqué" });
  assert.equal(ALERT_TONE_LABEL.critical, "Critique");
});

test("l'heure est celle d'Abidjan (UTC), sur deux chiffres", () => {
  assert.equal(formatClock(Date.UTC(2026, 9, 27, 14, 3, 7)), "14:03:07");
  assert.equal(formatClock(Date.UTC(2026, 9, 27, 0, 0, 0)), "00:00:00");
  assert.equal(formatClock(Date.UTC(2026, 9, 27, 23, 59, 59)), "23:59:59");
});

test("cible d'une opération : bénéficiaire, numéro, moyen de paiement", () => {
  assert.equal(operationTarget(op({ kind: "send", beneficiary: "Koné" })), "Koné");
  assert.equal(operationTarget(op({ kind: "send", phone: "0701020304" })), "07 01 02 03 04");
  assert.equal(operationTarget(op({ kind: "send" })), "Numéro inconnu");
  assert.equal(operationTarget(op({ kind: "collect", wallet: "wave" })), "Wave");
  assert.equal(operationTarget(op({ kind: "collect", wallet: "mtn" })), "MTN");
  assert.equal(operationTarget(op({ kind: "collect" })), "Sans moyen précisé");
});

test("avertissement quand la détection de contrainte ne peut pas fonctionner", () => {
  assert.equal(duressNotice("active"), undefined);
  assert.match(duressNotice("disabled")!, /non configurée/);
  assert.match(duressNotice("weak")!, /trop courte/);
});

test("les raisons du score s'affichent avec leurs points", () => {
  assert.equal(factorChip({ label: "Bénéficiaire inconnu", points: 20 }), "Bénéficiaire inconnu +20");
});
