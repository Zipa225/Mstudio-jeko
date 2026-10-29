import test from "node:test";
import assert from "node:assert/strict";
import {
  extractBeneficiary, extractPhone, extractWallet, formatPhone, isNo, isYes, parseIntent, WALLET_LABEL, type Intent,
} from "../src/lib/intent";

const check = (cases: Array<[string, Intent]>) => {
  for (const [text, expected] of cases) assert.deepEqual(parseIntent(text), expected, text);
};

// --- Encaisser -------------------------------------------------------------

test("encaisser : montant en mots ou en chiffres, moyen de paiement", () => {
  check([
    ["Encaisse cinq mille francs par Wave", { kind: "collect", amount: 5000, wallet: "wave" }],
    ["encaisser 5000", { kind: "collect", amount: 5000 }],
    ["Je veux encaisser dix mille francs Orange Money", { kind: "collect", amount: 10000, wallet: "orange" }],
    ["encaisse 2 500 FCFA par MTN", { kind: "collect", amount: 2500, wallet: "mtn" }],
    ["ENCAISSE CINQ MILLE", { kind: "collect", amount: 5000 }],
    ["un encaissement de vingt mille", { kind: "collect", amount: 20000 }],
    ["encaisse deux cent cinquante mille francs", { kind: "collect", amount: 250000 }],
  ]);
});

test("encaisser : ce qui manque reste absent, l'agent le demandera", () => {
  check([
    ["Encaisse par Moov", { kind: "collect", wallet: "moov" }],
    ["encaisse", { kind: "collect" }],
    ["j'aimerais encaisser s'il te plaît", { kind: "collect" }],
  ]);
});

test("encaisser : « fais payer », qu'une vendeuse dit plus souvent que « encaisse »", () => {
  check([
    ["Fais payer cinq mille francs", { kind: "collect", amount: 5000 }],
    ["faire payer cinq mille", { kind: "collect", amount: 5000 }],
    ["fais-moi payer cinq mille francs", { kind: "collect", amount: 5000 }],
    ["demande de paiement de cinq mille", { kind: "collect", amount: 5000 }],
    ["le client doit payer cinq mille", { kind: "collect", amount: 5000 }],
    ["il me doit cinq mille francs", { kind: "collect", amount: 5000 }],
    ["le client va payer deux mille", { kind: "collect", amount: 2000 }],
    ["fais payer dix mille francs par Wave", { kind: "collect", amount: 10000, wallet: "wave" }],
    // Sans montant, c'est quand même un encaissement : l'agent demandera combien.
    ["fais payer", { kind: "collect" }],
  ]);
});

test("encaisser : « payer » tout seul ne décide de rien, c'est l'entourage qui dit qui paie qui", () => {
  check([
    // Là, c'est le marchand qui paie : surtout pas un encaissement.
    ["je dois payer mille francs à Koffi", { kind: "unknown" }],
    // Un verbe explicite l'emporte sur l'expression : « il me doit » ne retourne pas l'envoi.
    ["Envoie mille francs à Koffi, il me doit", { kind: "send", amount: 1000, beneficiary: "Koffi" }],
    // Une question sans montant reste une question.
    ["comment faire payer un client ?", { kind: "support" }],
  ]);
});

// --- Envoyer ---------------------------------------------------------------

test("envoyer : montant, bénéficiaire avec ses accents, moyen de paiement", () => {
  check([
    ["Envoie cent cinquante mille francs à Koné", { kind: "send", amount: 150000, beneficiary: "Koné" }],
    ["Transfère 5000 à Fatou", { kind: "send", amount: 5000, beneficiary: "Fatou" }],
    ["Envoie 5000 à Mamadou par Wave", { kind: "send", amount: 5000, beneficiary: "Mamadou", wallet: "wave" }],
    ["envoie 5000 pour Adjoua", { kind: "send", amount: 5000, beneficiary: "Adjoua" }],
    ["vire 3000 à Fatou", { kind: "send", amount: 3000, beneficiary: "Fatou" }],
    ["Envoie 5000 francs à Koné par Wave", { kind: "send", amount: 5000, beneficiary: "Koné", wallet: "wave" }],
    ["envoie vingt mille francs", { kind: "send", amount: 20000 }],
    ["envoie 5000 chez ma tante", { kind: "send", amount: 5000, beneficiary: "Tante" }],
  ]);
});

test("envoyer : la casse est ramenée à la normale, une casse voulue est gardée", () => {
  assert.equal(extractBeneficiary("envoie 5000 à koné"), "Koné");
  assert.equal(extractBeneficiary("ENVOIE 5000 À KONÉ"), "Koné");
  assert.equal(extractBeneficiary("envoie 5000 à N'Guessan"), "N'Guessan");
  assert.equal(extractBeneficiary("envoie 5000 à Kone"), "Kone", "on n'invente pas un accent absent");
});

test("envoyer : un titre n'est pas un nom, « à monsieur Diallo » donne Diallo", () => {
  assert.equal(extractBeneficiary("envoie 5000 à monsieur Diallo"), "Diallo");
  assert.equal(extractBeneficiary("envoie 5000 à madame Fatou"), "Fatou");
  assert.equal(extractBeneficiary("envoie 5000 pour tanti Adjoua"), "Adjoua");
  assert.equal(extractBeneficiary("envoie 5000 à mon frère Koffi"), "Koffi");
  // Faute de nom derrière, le titre sert de nom : sinon l'agent demanderait « à qui ? » et la seule
  // réponse possible serait le même mot.
  assert.equal(extractBeneficiary("envoie 5000 à tonton"), "Tonton");
  assert.equal(extractBeneficiary("envoie 5000 à monsieur"), "Monsieur");
  // Même chose en réponse à « à qui ? ».
  assert.equal(extractBeneficiary("monsieur Diallo", { bare: true }), "Diallo");
  assert.equal(extractBeneficiary("tonton", { bare: true }), "Tonton");
});

test("envoyer : un numéro de téléphone devient le bénéficiaire, avec ou sans indicatif", () => {
  check([
    ["envoie 5000 au 07 01 02 03 04", { kind: "send", amount: 5000, phone: "0701020304" }],
    ["envoie cinq mille au 0701020304", { kind: "send", amount: 5000, phone: "0701020304" }],
    ["envoie cinq mille au +225 07 01 02 03 04", { kind: "send", amount: 5000, phone: "0701020304" }],
    ["envoie 5000 au 00225 0701020304", { kind: "send", amount: 5000, phone: "0701020304" }],
    ["envoie 5000 au 225.07.01.02.03.04", { kind: "send", amount: 5000, phone: "0701020304" }],
  ]);
});

test("envoyer : « pour le marché » n'est pas un bénéficiaire", () => {
  assert.equal(extractBeneficiary("envoie 5000 pour le marché"), undefined);
  assert.equal(extractBeneficiary("envoie 5000 à 10 heures"), undefined);
  assert.equal(extractBeneficiary("envoie 5000 par Wave"), undefined);
});

test("téléphone : seuls les numéros à 10 chiffres commençant par 0 comptent", () => {
  assert.equal(extractPhone("appelle le 07 01 02 03 04"), "0701020304");
  assert.equal(extractPhone("+2250701020304"), "0701020304");
  assert.equal(extractPhone("envoie 5000"), undefined);
  assert.equal(extractPhone("1234567890"), undefined);
  assert.equal(extractPhone("07010203"), undefined);
  assert.equal(formatPhone("0701020304"), "07 01 02 03 04");
});

test("bénéficiaire en réponse à « à qui ? » : un nom seul est accepté", () => {
  assert.equal(extractBeneficiary("Fatou", { bare: true }), "Fatou");
  assert.equal(extractBeneficiary("pour Fatou", { bare: true }), "Fatou");
  assert.equal(extractBeneficiary("c'est Fatou", { bare: true }), "Fatou");
  assert.equal(extractBeneficiary("euh", { bare: true }), undefined);
  assert.equal(extractBeneficiary("non", { bare: true }), undefined);
  assert.equal(extractBeneficiary("Fatou"), undefined, "sans « bare », un nom seul n'est pas pris");
});

test("moyens de paiement reconnus", () => {
  assert.equal(extractWallet("par Wave"), "wave");
  assert.equal(extractWallet("Orange Money"), "orange");
  assert.equal(extractWallet("avec MTN"), "mtn");
  assert.equal(extractWallet("sur Moov"), "moov");
  for (const heard of ["par WAF", "par WIF", "par wav", "par ouave"]) assert.equal(extractWallet(heard), "wave", heard);
  assert.equal(extractWallet("Tu veux encaisser 5000 francs par WAF, tu confirmes?"), "wave");
  assert.equal(extractWallet("en espèces"), undefined);
  assert.equal(extractWallet("par momo"), undefined, "MoMo n'est pas dans le guide : non reconnu");
  assert.deepEqual(WALLET_LABEL, { wave: "Wave", orange: "Orange", mtn: "MTN", moov: "Moov" });
});

// --- Bilan -----------------------------------------------------------------

test("bilan : une question sur les ventes n'est pas une commande d'encaissement", () => {
  for (const text of [
    "Combien j'ai encaissé aujourd'hui ?", "Fais-moi le bilan", "mes ventes du jour", "total du jour", "combien j'ai gagné",
    "combien j'ai encaissé",
  ]) {
    assert.deepEqual(parseIntent(text), { kind: "summary" }, text);
  }
});

// --- Support ---------------------------------------------------------------

test("support : questions et mots-clés, jamais un ordre", () => {
  for (const text of [
    "J'ai atteint la limite de 200 000, comment augmenter mon plafond ?",
    "C'est quoi les frais ?",
    "Est-ce que Jèko marche en Côte d'Ivoire ?",
    "comment envoyer de l'argent",
    "quel est mon plafond",
    "les frais",
    "pourquoi tu as refusé l'envoi",
    "combien ça coûte d'envoyer",
  ]) {
    assert.deepEqual(parseIntent(text), { kind: "support" }, text);
  }
});

// --- Inconnu ---------------------------------------------------------------

test("inconnu : l'agent redemande plutôt que de deviner", () => {
  for (const text of ["", "   ", "bonjour", "merci beaucoup", "euh", "il fait chaud aujourd'hui", "donne-moi de l'argent", "quoi", "5000"]) {
    assert.deepEqual(parseIntent(text), { kind: "unknown" }, JSON.stringify(text));
  }
});

// --- Oui et non ------------------------------------------------------------

test("oui : formulations courantes", () => {
  for (const text of [
    "oui", "Oui, c'est bon", "ouais d'accord", "ok", "OK", "d'accord", "vas-y", "bien sûr", "confirme", "exactement",
    "oui, c'est bon, j'ai laissé la marmite sur le feu", "oui oui",
  ]) {
    assert.equal(isYes(text), true, text);
    assert.equal(isNo(text), false, text);
  }
});

test("non : formulations courantes", () => {
  for (const text of ["non", "Non merci", "annule", "stop", "laisse tomber", "tant pis", "jamais", "pas maintenant", "ok annule", "oui annule"]) {
    assert.equal(isNo(text), true, text);
    assert.equal(isYes(text), false, text);
  }
});

test("ambigu : ni oui ni non, l'agent redemande et rien ne s'exécute", () => {
  for (const text of ["oui non", "non d'accord", "je ne confirme pas", "c'est pas bon", "pas d'accord", "ne confirme pas", "peut-être", "", "euh"]) {
    assert.equal(isYes(text), false, `oui ? ${JSON.stringify(text)}`);
  }
  for (const text of ["oui non", "non d'accord", "je ne confirme pas", "c'est pas bon", "peut-être", "euh"]) {
    assert.equal(isNo(text), false, `non ? ${JSON.stringify(text)}`);
  }
});

test("oui et non ne se déclenchent pas à l'intérieur d'un autre mot", () => {
  assert.equal(isYes("souhait"), false);
  assert.equal(isNo("nonante"), false);
  assert.equal(isYes("okapi"), false);
});
