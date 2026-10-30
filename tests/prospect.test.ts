import test from "node:test";
import assert from "node:assert/strict";
import { POST as prospect } from "../src/app/api/prospect/route";
import { GET as state } from "../src/app/api/state/route";
import { INTEREST_LABEL, INTEREST_TONE, sortLeads } from "../src/app/analyste/view";
import {
  answerCount, cleanActivity, createProspectAgent, isSkip, leadSummary, parseCity, parsePayments, parseVolume, qualify,
} from "../src/lib/leads";
import type { VoiceService } from "../src/lib/ports";
import { createRuntime, replaceRuntime } from "../src/lib/runtime";
import { Store, type Lead } from "../src/lib/store";
import { normalize, phraseKeywords } from "../src/lib/text";

const NOON = new Date(Date.UTC(2026, 9, 29, 12, 0, 0));
const PHRASE = "le manioc cuit doucement";
const LEAK_KEYS = phraseKeywords(PHRASE).filter((k) => k.length >= 6);
const leaks = (s: string) => LEAK_KEYS.some((k) => normalize(s).includes(k));

function setup() {
  const store = new Store(() => NOON, true);
  const agent = createProspectAgent({ store });
  return {
    store,
    say: (text: string, session = "v1") => agent.handleTurn(session, text),
    leads: () => store.leads,
    alerts: (type: string) => store.alerts.filter((a) => a.type === type),
  };
}

/** Un entretien complet, dans l'ordre : activité, volume, moyens de paiement, ville, rappel. */
function interview(say: ReturnType<typeof setup>["say"], answers: string[], session = "v1") {
  say("", session);
  let last = say("", session);
  for (const a of answers) last = say(a, session);
  return last;
}

// --- La règle chaud, tiède, froid ----------------------------------------------------------------------

test("règle : chaud, tiède, froid", () => {
  const full = { activity: "Poisson", volume: "300 000 FCFA par mois", payments: "Wave", city: "Abidjan" };
  assert.equal(qualify({ ...full, wantsCall: true }), "chaud");
  assert.equal(qualify({ activity: "Poisson", volume: "x", payments: "Wave", wantsCall: true }), "chaud", "3 réponses suffisent");
  assert.equal(qualify({ ...full, wantsCall: false }), "tiede", "4 réponses mais pas de rappel");
  assert.equal(qualify({ ...full }), "tiede");
  assert.equal(qualify({ activity: "Poisson", volume: "x", wantsCall: true }), "tiede", "2 réponses seulement, même avec rappel");
  assert.equal(qualify({ activity: "Poisson", city: "Abidjan" }), "tiede");
  assert.equal(qualify({ activity: "Poisson", wantsCall: true }), "froid");
  assert.equal(qualify({ wantsCall: true }), "froid");
  assert.equal(qualify({}), "froid");
  assert.equal(answerCount(full), 4);
  assert.equal(answerCount({ activity: "x" }), 1);
});

test("résumé : une phrase par information, sans inventer", () => {
  assert.equal(leadSummary({}), "Aucune réponse pour le moment.");
  const text = leadSummary({ activity: "Poisson", volume: "300 000 FCFA par mois", payments: "Wave, espèces", city: "Abidjan", wantsCall: true });
  assert.equal(text, "Activité : Poisson. Volume : 300 000 FCFA par mois. Moyens de paiement : Wave, espèces. Ville : Abidjan. Veut être rappelé par un conseiller.");
  assert.match(leadSummary({ wantsCall: false }), /Ne veut pas être rappelé/);
  assert.match(leadSummary({ question: "Comment faire ?" }), /Question sans réponse : « Comment faire \? »/);
});

// --- Lecture des réponses --------------------------------------------------------------------------------

test("activité : on retire « je vends » et l'article", () => {
  assert.equal(cleanActivity("Je vends du poisson"), "Poisson");
  assert.equal(cleanActivity("moi je suis couturière"), "Couturière");
  assert.equal(cleanActivity("Je tiens une boutique de pagnes."), "Boutique de pagnes");
  assert.equal(cleanActivity("des bananes"), "Bananes");
  assert.equal(cleanActivity("x"), undefined);
  assert.ok(cleanActivity("a".repeat(300))!.length <= 80);
});

test("volume : montant en chiffres ou en mots, avec sa période", () => {
  assert.equal(parseVolume("environ 300 000 francs par mois"), "300 000 FCFA par mois");
  assert.equal(parseVolume("trois cent mille francs"), "300 000 FCFA par mois");
  assert.equal(parseVolume("15000 par jour"), "15 000 FCFA par jour");
  assert.equal(parseVolume("cent mille francs par semaine"), "100 000 FCFA par semaine");
  assert.equal(parseVolume("beaucoup"), "Beaucoup");
  assert.equal(parseVolume("ok"), undefined);
});

test("moyens de paiement : reconnaît chaque moyen une seule fois", () => {
  assert.equal(parsePayments("Wave et Orange"), "Wave, Orange Money");
  assert.equal(parsePayments("surtout du cash et du wave, wave"), "Wave, espèces");
  assert.equal(parsePayments("mtn moov djamo"), "MTN, Moov, Djamo");
  assert.equal(parsePayments("par carte visa"), "carte");
  assert.equal(parsePayments("des virements"), "Des virements");
  assert.equal(parsePayments("a"), undefined);
});

test("ville : villes connues avec accents, sinon le texte nettoyé", () => {
  assert.equal(parseCity("j'habite à Abidjan, Cocody"), "Abidjan");
  assert.equal(parseCity("Bouake"), "Bouaké");
  assert.equal(parseCity("San Pedro"), "San-Pédro");
  assert.equal(parseCity("je suis à Tiassalé"), "Tiassalé");
  assert.equal(parseCity("en Guinée"), "Guinée");
  assert.equal(parseCity("?"), undefined);
});

test("sauter une question : « je ne sais pas », « passe »", () => {
  for (const t of ["je ne sais pas", "Je sais pas trop", "passe", "non merci", "je préfère ne pas répondre", "", "  "]) assert.equal(isSkip(t), true, t);
  for (const t of ["poisson", "environ trois cent mille", "à Abidjan", "je passe mes journées au marché pour vendre"]) assert.equal(isSkip(t), false, t);
});

// --- L'entretien -------------------------------------------------------------------------------------------

test("entretien complet : un prospect chaud, une fiche, une seule alerte", () => {
  const { say, leads, alerts } = setup();
  const first = say("");
  assert.match(first.reply, /^Bonjour ! Je suis l'assistant de Jèko/);
  assert.match(first.reply, /Que vends-tu/);
  assert.equal(first.stage, "activity");
  assert.equal(leads().length, 0, "pas de fiche tant qu'il n'a rien dit");

  const a = say("Je vends du poisson");
  assert.equal(a.reply, "Merci. Combien d'argent encaisses-tu à peu près par mois ?");
  assert.equal(a.stage, "volume");
  assert.equal(a.interest, "froid");
  assert.equal(leads().length, 1);

  assert.equal(say("environ 300 000 francs par mois").stage, "payments");
  const c = say("Wave et espèces");
  assert.equal(c.stage, "city");
  assert.equal(c.interest, "tiede", "trois réponses sans rappel");
  const d = say("Abidjan");
  assert.equal(d.stage, "call");
  assert.match(d.reply, /Veux-tu qu'un conseiller Jèko te rappelle/);

  const end = say("oui, avec plaisir");
  assert.equal(end.stage, "done");
  assert.equal(end.interest, "chaud");
  assert.match(end.reply, /Un conseiller Jèko va te rappeler/);

  assert.equal(leads().length, 1, "une seule fiche par visiteur");
  const [lead] = leads();
  assert.equal(lead.interest, "chaud");
  assert.equal(lead.wantsCall, true);
  assert.equal(lead.summary, "Activité : Poisson. Volume : 300 000 FCFA par mois. Moyens de paiement : Wave, espèces. Ville : Abidjan. Veut être rappelé par un conseiller.");
  assert.equal(alerts("lead").length, 1);
  assert.equal(alerts("lead")[0].title, "Prospect chaud");
  assert.equal(alerts("lead")[0].level, "info");

  say("merci beaucoup");
  assert.equal(alerts("lead").length, 1, "pas de seconde alerte");
  const after = say("Quels sont les frais ?");
  assert.match(after.reply, /Tu as une autre question sur Jèko \?$/, "l'entretien est fini : pas de nouvelle question d'entretien");
  assert.equal(after.interest, "chaud");
  assert.equal(alerts("lead").length, 1, "une question de support après l'entretien ne ré-alerte pas");
});

test("entretien : refuser le rappel donne un prospect tiède", () => {
  const { say, leads, alerts } = setup();
  interview(say, ["Je vends des habits", "deux cent mille francs", "wave", "Bouaké", "non"]);
  const [lead] = leads();
  assert.equal(lead.interest, "tiede");
  assert.equal(lead.wantsCall, false);
  assert.equal(lead.city, "Bouaké");
  assert.equal(alerts("lead").length, 0);
});

test("entretien : sauter les questions donne un prospect froid", () => {
  const { say, leads } = setup();
  const end = interview(say, ["je ne sais pas", "passe", "je ne sais pas", "Abidjan", "oui"]);
  assert.equal(end.interest, "froid", "une seule vraie réponse, même avec un rappel");
  assert.equal(leads()[0].city, "Abidjan");
  assert.equal(leads()[0].activity, undefined);
});

test("entretien : une réponse vide ou incompréhensible répète la question", () => {
  const { say } = setup();
  say("");
  assert.equal(say("poisson").stage, "volume");
  const again = say("");
  assert.equal(again.stage, "volume");
  assert.equal(again.reply, "Combien d'argent encaisses-tu à peu près par mois ?");
  const bad = say("ok");
  assert.equal(bad.stage, "volume");
  assert.match(bad.reply, /^Je n'ai pas bien compris\. Combien/);
});

test("entretien : à la question du rappel, une réponse ambiguë est redemandée", () => {
  const { say } = setup();
  interview(say, ["poisson", "100000", "wave", "Abidjan"]);
  const unclear = say("peut-être");
  assert.equal(unclear.stage, "call");
  assert.match(unclear.reply, /Dis oui si tu veux être rappelé, ou non/);
  assert.equal(say("oui").stage, "done");
});

test("entretien : chaque visiteur a sa propre session et sa propre fiche", () => {
  const { say, leads } = setup();
  say("", "a");
  say("", "b");
  say("poisson", "a");
  say("coiffure", "b");
  assert.equal(leads().length, 2);
  assert.deepEqual(leads().map((l) => l.activity).sort(), ["Coiffure", "Poisson"]);
});

// --- Questions de support pendant l'entretien ----------------------------------------------------------

test("question de support : réponse sourcée, l'entretien ne bouge pas", () => {
  const { say, alerts, leads } = setup();
  say("");
  const r = say("Quels sont les frais ?");
  assert.match(r.reply, /^Jèko prend un virgule cinq pour cent/);
  assert.match(r.reply, /Que vends-tu/, "la question en cours est reposée");
  assert.equal(r.source, "jeko.africa, page Tarifs");
  assert.equal(r.stage, "activity");
  assert.equal(alerts("handoff").length, 0);
  assert.equal(leads().length, 0);
  assert.equal(say("poisson").stage, "volume");
});

test("question hors base : passage à un conseiller, fiche avec la question", () => {
  const { say, alerts, leads } = setup();
  say("");
  const r = say("Comment je change le nom de ma boutique ?");
  assert.match(r.reply, /Je passe ta question à un conseiller Jèko/);
  assert.equal(r.source, undefined);
  assert.equal(alerts("handoff").length, 1);
  assert.match(alerts("handoff")[0].detail, /Un prospect a demandé/);
  assert.equal(leads().length, 1);
  assert.equal(leads()[0].question, "Comment je change le nom de ma boutique ?");
  assert.equal(leads()[0].interest, "froid");
  assert.match(leads()[0].summary, /Question sans réponse/);
});

test("question dès le premier message : on répond, puis on accueille", () => {
  const { say } = setup();
  const r = say("Vous êtes dans quels pays ?");
  assert.match(r.reply, /Abidjan/);
  assert.match(r.reply, /Bonjour ! Je suis l'assistant de Jèko/);
  assert.equal(r.source, "jeko.africa, pied de page");
  assert.equal(r.stage, "activity");
});

test("question sur le plafond : réponse partielle sourcée et passage à un conseiller", () => {
  const { say, alerts } = setup();
  say("");
  const r = say("Quel est le plafond ?");
  assert.match(r.reply, /plafond de ton compte/);
  assert.equal(r.source, "Notes des ingénieurs Jèko (plafond à confirmer)");
  assert.equal(alerts("handoff").length, 1);
  assert.match(alerts("handoff")[0].detail, /Réponse partielle/);
});

test("« je ne sais pas combien » est une réponse sautée, pas une question de support", () => {
  const { say, alerts } = setup();
  say("");
  say("poisson");
  const r = say("je ne sais pas combien");
  assert.equal(r.stage, "payments");
  assert.equal(alerts("handoff").length, 0);
});

// --- Le magasin ---------------------------------------------------------------------------------------------

test("magasin : une fiche par session, mise à jour sur place, bornée à 200, remise à zéro", () => {
  const store = new Store(() => NOON, false);
  const first = store.upsertLead("s1", { interest: "froid", summary: "a" });
  const again = store.upsertLead("s1", { interest: "chaud", summary: "b", city: "Abidjan" });
  assert.equal(store.leads.length, 1);
  assert.equal(first.id, again.id);
  assert.deepEqual([again.interest, again.city, again.summary], ["chaud", "Abidjan", "b"]);
  for (let i = 0; i < 205; i++) store.upsertLead(`x${i}`, { interest: "froid", summary: "x" });
  assert.equal(store.leads.length, 200);
  assert.equal(store.leads.some((l) => l.sessionId === "s1"), false, "les plus anciennes sont oubliées");
  store.reset(false);
  assert.equal(store.leads.length, 0);
});

test("analyste : les chauds d'abord, puis tièdes, puis froids ; libellés sans rouge", () => {
  const lead = (id: string, interest: Lead["interest"], updatedAt: number): Lead => ({ id, sessionId: id, ts: 0, updatedAt, interest, summary: id });
  const sorted = sortLeads([lead("f1", "froid", 5), lead("t1", "tiede", 1), lead("c1", "chaud", 2), lead("c2", "chaud", 9), lead("t2", "tiede", 8)]);
  assert.deepEqual(sorted.map((l) => l.id), ["c2", "c1", "t2", "t1", "f1"]);
  assert.deepEqual(INTEREST_LABEL, { chaud: "Chaud", tiede: "Tiède", froid: "Froid" });
  assert.deepEqual(INTEREST_TONE, { chaud: "held", tiede: "wait", froid: "neutral" });
});

// --- Les routes -------------------------------------------------------------------------------------------------

function stubVoice(transcript: string): VoiceService & { heard: number } {
  const stub = {
    heard: 0,
    async transcribe() {
      stub.heard++;
      return transcript;
    },
    async synthesize() {
      return { audio: new ArrayBuffer(16), contentType: "audio/wav" };
    },
  };
  return stub;
}

const URL_ = "http://localhost/api/prospect";
const fresh = (voice?: VoiceService | null) =>
  replaceRuntime(createRuntime({
    clock: () => NOON, secret: "s", getPhrase: () => PHRASE, demoMode: true, voice: voice ?? null,
    jeko: { mode: "mock", baseUrl: "https://x.test", apiKey: undefined, apiKeyId: undefined, storeId: undefined, publicBaseUrl: "http://localhost:3000", timeoutMs: 1000 },
  }));

async function read(res: Response) {
  const raw = await res.text();
  let body: any;
  try {
    body = JSON.parse(raw);
  } catch {
    body = undefined;
  }
  return { status: res.status, raw, body };
}

const post = async (payload: unknown) =>
  read(await prospect(new Request(URL_, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) })));

test("route : l'entretien par JSON, la fiche arrive dans /api/state", async () => {
  const rt = fresh();
  const start = await post({ sessionId: "visiteur-1", text: "" });
  assert.equal(start.status, 200);
  assert.match(start.body.reply, /Que vends-tu/);
  assert.equal(start.body.heard, "");
  assert.ok(rt.isAllowedSpeech(start.body.speech), "la voix peut prononcer la phrase");

  for (const t of ["Je vends du riz", "400 000 francs", "Orange et Wave", "Korhogo", "oui"]) await post({ sessionId: "visiteur-1", text: t });
  const s = await read(await state());
  assert.equal(s.body.leads.length, 1);
  assert.equal(s.body.leads[0].interest, "chaud");
  assert.match(s.body.leads[0].summary, /Korhogo/);
  assert.ok(s.body.alerts.some((a: any) => a.title === "Prospect chaud"));
});

test("route : entrées invalides", async () => {
  fresh();
  for (const [payload, error] of [
    [{ text: "x" }, "invalid_session"], [{ sessionId: "a b", text: "x" }, "invalid_session"],
    [{ sessionId: "v", text: 5 }, "invalid_text"], [{ sessionId: "v", text: "x".repeat(501) }, "invalid_text"], [[], "invalid_json"],
  ] as const) {
    const r = await post(payload);
    assert.deepEqual([r.status, r.body.error], [400, error], JSON.stringify(payload).slice(0, 40));
  }
  const wrong = await prospect(new Request(URL_, { method: "POST", headers: { "content-type": "text/plain" }, body: "x" }));
  assert.equal(wrong.status, 415);
});

test("route : par la voix, le texte compris devient la bulle du visiteur", async () => {
  const voice = stubVoice("Je vends du poisson");
  fresh(voice);
  await post({ sessionId: "visiteur-2", text: "" });
  const form = new FormData();
  form.set("sessionId", "visiteur-2");
  form.set("audio", new Blob([new Uint8Array(100)], { type: "audio/wav" }), "voix.wav");
  const r = await read(await prospect(new Request(URL_, { method: "POST", body: form })));
  assert.equal(r.status, 200);
  assert.equal(r.body.heard, "Je vends du poisson");
  assert.equal(r.body.stage, "volume");
  assert.equal(voice.heard, 1);
});

test("route : sans voix serveur, l'audio est refusé (501)", async () => {
  fresh(null);
  const form = new FormData();
  form.set("sessionId", "visiteur-3");
  form.set("audio", new Blob([new Uint8Array(100)], { type: "audio/wav" }), "voix.wav");
  const r = await read(await prospect(new Request(URL_, { method: "POST", body: form })));
  assert.deepEqual([r.status, r.body.error], [501, "voice_not_available"]);
});

test("route : la phrase de contrainte n'entre jamais dans une fiche ni dans une réponse", async () => {
  const rt = fresh();
  await post({ sessionId: "visiteur-4", text: "" });
  const r = await post({ sessionId: "visiteur-4", text: `je vends du poisson, ${PHRASE}` });
  assert.equal(leaks(r.raw), false);
  assert.equal(leaks(JSON.stringify(rt.store.leads)), false);
  assert.equal(leaks(JSON.stringify(rt.store.alerts)), false);
});

test("route : /api/state sans prospect renvoie une liste vide", async () => {
  fresh();
  assert.deepEqual((await read(await state())).body.leads, []);
});
