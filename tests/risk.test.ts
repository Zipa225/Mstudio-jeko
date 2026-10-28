import test from "node:test";
import assert from "node:assert/strict";
import { getConfig } from "../src/lib/config";
import { scoreRisk, type RiskInput, type RiskResult, type RiskSettings } from "../src/lib/risk";

// L'heure est toujours fournie : midi UTC (= Abidjan), donc jamais de critère de nuit par accident.
const at = (h: number, min = 0) => new Date(Date.UTC(2026, 9, 27, h, min, 0));
const noon = at(12);

const SETTINGS: RiskSettings = { ceilingXof: 200_000, thresholds: { verify: 35, block: 65 } };
const base: Omit<RiskInput, "kind" | "amount"> = { beneficiaryKnown: true, avgTicket: 4500, previousOps: 0, now: noon };

const collect = (amount: number, over: Partial<RiskInput> = {}, s = SETTINGS) =>
  scoreRisk({ ...base, kind: "collect", amount, ...over }, s);
const send = (amount: number, over: Partial<RiskInput> = {}, s = SETTINGS) =>
  scoreRisk({ ...base, kind: "send", amount, ...over }, s);
const ids = (r: RiskResult) => r.factors.map((f) => f.id);

// --- Un critère à la fois ---------------------------------------------------

test("sortie d'argent : +10 pour un transfert, rien pour un encaissement", () => {
  assert.deepEqual(ids(send(5000)), ["outbound"]);
  assert.equal(send(5000).score, 10);
  assert.equal(collect(5000).score, 0);
});

test("montant vs panier moyen : 2, 4 et 10 fois, seuils inclusifs", () => {
  assert.equal(collect(8999).score, 0, "juste sous 2 fois");
  assert.equal(collect(9000).score, 10, "2 fois");
  assert.equal(collect(17_999).score, 10, "juste sous 4 fois");
  assert.equal(collect(18_000).score, 20, "4 fois");
  assert.equal(collect(44_999).score, 20, "juste sous 10 fois");
  assert.equal(collect(45_000).score, 30, "10 fois");
  assert.deepEqual(ids(collect(45_000)), ["amount_ratio"]);
});

test("panier moyen nul ou négatif : pas de division par zéro", () => {
  assert.equal(collect(5000, { avgTicket: 0 }).score, 30);
  assert.equal(collect(5000, { avgTicket: -10 }).score, 30);
});

test("plafond : strictement au-dessus de 200 000 FCFA", () => {
  const isolated = { avgTicket: 150_000 }; // ratio faible pour isoler ce critère
  assert.deepEqual(ids(collect(200_000, isolated)), []);
  assert.deepEqual(ids(collect(200_001, isolated)), ["ceiling"]);
  assert.equal(collect(200_001, isolated).score, 25);
});

test("bénéficiaire inconnu : +20 pour un transfert seulement", () => {
  assert.equal(send(5000, { beneficiaryKnown: false }).score, 30); // 10 sortie + 20 inconnu
  assert.equal(send(5000, { beneficiaryKnown: true }).score, 10);
  assert.equal(collect(5000, { beneficiaryKnown: false }).score, 0, "un encaissement n'a pas de bénéficiaire");
});

test("heure de nuit : de 22 h à 4 h 59, pas à 5 h ni à 21 h 59", () => {
  const night = (h: number, m = 0) => ids(collect(5000, { now: at(h, m) })).includes("night");
  for (const [h, m] of [[22, 0], [23, 59], [0, 0], [4, 59]] as const) assert.equal(night(h, m), true, `${h} h ${m}`);
  for (const [h, m] of [[5, 0], [12, 0], [21, 59]] as const) assert.equal(night(h, m), false, `${h} h ${m}`);
  assert.equal(collect(5000, { now: at(2) }).score, 15);
});

test("rafale : l'opération en cours compte, 3 opérations +15, 5 ou plus +25", () => {
  const velocity = (previousOps: number) => collect(5000, { previousOps }).score;
  assert.equal(velocity(0), 0, "1 opération");
  assert.equal(velocity(1), 0, "2 opérations");
  assert.equal(velocity(2), 15, "3 opérations");
  assert.equal(velocity(3), 15, "4 opérations");
  assert.equal(velocity(4), 25, "5 opérations");
  assert.equal(velocity(9), 25);
  assert.equal(velocity(-3), 0, "un compteur négatif est ramené à zéro");
});

// --- Décisions --------------------------------------------------------------

test("décisions avec les seuils par défaut : 35 et 65 exactement", () => {
  const accept = collect(45_000); // 30
  assert.equal(accept.score, 30);
  assert.equal(accept.decision, "accept");

  const verify = collect(250_000, { avgTicket: 100_000 }); // ratio 2,5 (+10) et plafond (+25)
  assert.equal(verify.score, 35);
  assert.equal(verify.decision, "verify");

  const block = send(250_000); // 10 + 30 + 25, bénéficiaire connu
  assert.equal(block.score, 65);
  assert.equal(block.decision, "block");
});

test("décisions : la comparaison est bien « supérieur ou égal » à chaque seuil", () => {
  // collect(45 000) vaut 30 ; send(250 000) vaut 65.
  assert.equal(collect(45_000, {}, { ...SETTINGS, thresholds: { verify: 30, block: 90 } }).decision, "verify");
  assert.equal(collect(45_000, {}, { ...SETTINGS, thresholds: { verify: 31, block: 90 } }).decision, "accept");
  assert.equal(send(250_000, {}, { ...SETTINGS, thresholds: { verify: 35, block: 65 } }).decision, "block");
  assert.equal(send(250_000, {}, { ...SETTINGS, thresholds: { verify: 35, block: 66 } }).decision, "verify");
});

test("le plafond et les seuils sont réglables sans toucher à l'environnement", () => {
  const strict: RiskSettings = { ceilingXof: 10_000, thresholds: SETTINGS.thresholds };
  assert.deepEqual(ids(collect(12_000, { avgTicket: 12_000 }, strict)), ["ceiling"]);
  assert.deepEqual(ids(collect(12_000, { avgTicket: 12_000 }, SETTINGS)), []);
});

test("sans réglages explicites, les valeurs de config.ts s'appliquent", () => {
  const input: RiskInput = { ...base, kind: "send", amount: 150_000, beneficiaryKnown: false };
  assert.deepEqual(scoreRisk(input), scoreRisk(input, getConfig()));
  assert.equal(getConfig().ceilingXof, 200_000);
  assert.deepEqual(getConfig().thresholds, { verify: 35, block: 65 });
});

test("le score est plafonné à 100", () => {
  const r = send(250_000, { beneficiaryKnown: false, now: at(2), previousOps: 4 });
  assert.equal(r.factors.reduce((s, f) => s + f.points, 0), 125);
  assert.equal(r.score, 100);
  assert.equal(r.decision, "block");
});

// --- Les trois scénarios de la démo ----------------------------------------

test("démo : encaissement de 5 000 FCFA, accepté sans raison de douter", () => {
  const r = collect(5000);
  assert.equal(r.score, 0);
  assert.equal(r.decision, "accept");
  assert.deepEqual(r.factors, []);
});

test("démo : 150 000 FCFA vers un inconnu, vérification (score 60)", () => {
  const r = send(150_000, { beneficiaryKnown: false });
  assert.equal(r.score, 60);
  assert.equal(r.decision, "verify");
  assert.deepEqual(ids(r), ["outbound", "amount_ratio", "new_beneficiary"]);
});

test("démo : 250 000 FCFA vers un inconnu, bloqué (score 85)", () => {
  const r = send(250_000, { beneficiaryKnown: false });
  assert.equal(r.score, 85);
  assert.equal(r.decision, "block");
  assert.deepEqual(ids(r), ["outbound", "amount_ratio", "ceiling", "new_beneficiary"]);
});

// --- Qualité des explications et robustesse --------------------------------

test("chaque facteur a des points, un libellé et un détail ; l'ordre est fixe et sans doublon", () => {
  const r = send(250_000, { beneficiaryKnown: false, now: at(2), previousOps: 4 });
  assert.deepEqual(ids(r), ["outbound", "amount_ratio", "ceiling", "new_beneficiary", "night", "velocity"]);
  assert.equal(new Set(ids(r)).size, r.factors.length);
  for (const f of r.factors) {
    assert.ok(f.points > 0);
    assert.ok(f.label.length > 0);
    assert.ok(f.detail.length > 0);
  }
});

test("hors plafonnement, la somme des facteurs égale le score", () => {
  const r = send(150_000, { beneficiaryKnown: false });
  assert.equal(r.factors.reduce((s, f) => s + f.points, 0), r.score);
});

test("les détails sont lisibles par l'analyste", () => {
  const r = send(150_000, { beneficiaryKnown: false });
  const ratio = r.factors.find((f) => f.id === "amount_ratio");
  assert.match(ratio!.detail, /33,3 fois le panier moyen \(4 500 FCFA\)/);
  assert.match(send(250_000).factors.find((f) => f.id === "ceiling")!.detail, /200 000 FCFA/);
  assert.match(collect(5000, { now: at(23) }).factors[0].detail, /23 h/);
});

test("montant invalide : erreur explicite, jamais un score", () => {
  for (const bad of [0, -5, NaN, Infinity]) assert.throws(() => collect(bad), RangeError, String(bad));
});

test("le calcul est pur : l'entrée n'est pas modifiée et le résultat est reproductible", () => {
  const input: RiskInput = Object.freeze({ ...base, kind: "send", amount: 150_000, beneficiaryKnown: false });
  const a = scoreRisk(input, SETTINGS);
  const b = scoreRisk(input, SETTINGS);
  assert.deepEqual(a, b);
  assert.equal(input.amount, 150_000);
});
