import test from "node:test";
import assert from "node:assert/strict";
import { MAX_AMOUNT, parseAmount, toFrenchWords } from "../src/lib/frenchNumbers";
import { formatXof, normalize, tokens } from "../src/lib/text";

// --- text.ts ---------------------------------------------------------------

test("normalize : minuscules, sans accents ni ponctuation", () => {
  assert.equal(normalize("Koné"), "kone");
  assert.equal(normalize("J'ai laissé la marmite"), "j ai laisse la marmite");
  assert.equal(normalize("Œuf  ÉTÉ"), "oeuf ete");
  assert.equal(normalize("quatre-vingt-dix"), "quatre vingt dix");
  assert.equal(normalize("   "), "");
});

test("tokens : découpe en mots normalisés", () => {
  assert.deepEqual(tokens("Envoie 5 000 à Koné !"), ["envoie", "5", "000", "a", "kone"]);
  assert.deepEqual(tokens(""), []);
});

test("formatXof : espace simple entre les milliers", () => {
  assert.equal(formatXof(150000), "150 000");
  assert.equal(formatXof(5000), "5 000");
  assert.equal(formatXof(1234567), "1 234 567");
  assert.equal(formatXof(500), "500");
  assert.ok(!/[  ]/.test(formatXof(1234567)));
});

// --- toFrenchWords ---------------------------------------------------------

test("toFrenchWords : formes de référence", () => {
  const cases: Array<[number, string]> = [
    [0, "zéro"], [1, "un"], [16, "seize"], [17, "dix-sept"], [20, "vingt"], [21, "vingt et un"],
    [22, "vingt-deux"], [31, "trente et un"], [70, "soixante-dix"], [71, "soixante et onze"],
    [77, "soixante-dix-sept"], [80, "quatre-vingts"], [81, "quatre-vingt-un"], [90, "quatre-vingt-dix"],
    [91, "quatre-vingt-onze"], [99, "quatre-vingt-dix-neuf"], [100, "cent"], [101, "cent un"],
    [180, "cent quatre-vingts"], [200, "deux cents"], [201, "deux cent un"], [1000, "mille"],
    [1001, "mille un"], [1100, "mille cent"], [2000, "deux mille"], [5000, "cinq mille"],
    [21000, "vingt et un mille"], [80000, "quatre-vingt mille"], [150000, "cent cinquante mille"],
    [200000, "deux cent mille"], [250000, "deux cent cinquante mille"],
    [1000000, "un million"], [2000000, "deux millions"], [80000000, "quatre-vingts millions"],
    [200000000, "deux cents millions"],
    [999999999, "neuf cent quatre-vingt-dix-neuf millions neuf cent quatre-vingt-dix-neuf mille neuf cent quatre-vingt-dix-neuf"],
  ];
  for (const [n, words] of cases) assert.equal(toFrenchWords(n), words, String(n));
});

test("toFrenchWords : refuse ce qui n'est pas un montant entier dans la plage", () => {
  for (const bad of [-1, 1.5, MAX_AMOUNT + 1, NaN, Infinity]) assert.throws(() => toFrenchWords(bad), RangeError, String(bad));
});

// --- parseAmount : mots ----------------------------------------------------

test("parseAmount : montants dits en mots dans une phrase", () => {
  const cases: Array<[string, number]> = [
    ["Encaisse cinq mille francs par Wave", 5000],
    ["Envoie cent cinquante mille francs à Koné", 150000],
    ["envoie deux cent cinquante mille francs à Koné", 250000],
    ["encaisse cinq cents francs", 500],
    ["encaisse mille francs", 1000],
    ["encaisse mille cinq cents francs", 1500],
    ["encaisse quatre-vingt-dix mille francs", 90000],
    ["encaisse quatre vingts francs", 80],
    ["encaisse soixante et onze mille francs", 71000],
    ["encaisse soixante-dix-sept mille francs", 77000],
    ["encaisse vingt et un mille francs", 21000],
    ["envoie un million de francs", 1000000],
    ["envoie deux millions cinq cent mille francs", 2500000],
    ["ENCAISSE CINQ MILLE FRANCS", 5000],
    ["cent mille", 100000],
    ["dix mille FCFA", 10000],
  ];
  for (const [text, n] of cases) assert.equal(parseAmount(text), n, text);
});

// --- parseAmount : chiffres ------------------------------------------------

test("parseAmount : montants en chiffres, avec ou sans séparateurs", () => {
  const cases: Array<[string, number]> = [
    ["encaisse 5000", 5000],
    ["encaisse 5 000 francs", 5000],
    ["encaisse 5.000 francs", 5000],
    ["encaisse 5000f", 5000],
    ["encaisse 5000 FCFA", 5000],
    ["encaisse 200 000 FCFA", 200000],
    ["envoie 1 500 000 francs", 1500000],
    ["encaisse 5 mille francs", 5000],
    ["envoie 2 millions", 2000000],
    ["envoie 150000 à Koné", 150000],
  ];
  for (const [text, n] of cases) assert.equal(parseAmount(text), n, text);
});

test("parseAmount : les numéros de téléphone ne sont jamais pris pour un montant", () => {
  assert.equal(parseAmount("envoie 5000 au 07 01 02 03 04"), 5000);
  assert.equal(parseAmount("envoie cinq mille au 0701020304"), 5000);
  assert.equal(parseAmount("envoie 5000 francs au +225 07 01 02 03 04"), 5000);
  assert.equal(parseAmount("envoie à 0701020304"), undefined);
  assert.equal(parseAmount("envoie à 07 01 02 03 04"), undefined);
  assert.equal(parseAmount("appelle le +225 07 01 02 03 04"), undefined);
  assert.equal(parseAmount("envoie à 2250701020304"), undefined);
  // Un nombre qui commence par 0 n'est jamais un montant, même court (ancien format à 8 chiffres).
  assert.equal(parseAmount("envoie à 07010203"), undefined);
  assert.equal(parseAmount("envoie à 0701"), undefined);
  assert.equal(parseAmount("encaisse 05000 francs"), undefined);
});

test("parseAmount : un montant suivi de francs l'emporte sur un autre nombre", () => {
  assert.equal(parseAmount("j'ai deux enfants, envoie cinq mille francs"), 5000);
  assert.equal(parseAmount("pour le 3 du mois, encaisse 5000 francs"), 5000);
});

// --- parseAmount : prudence ------------------------------------------------

test("parseAmount : renvoie undefined plutôt qu'un montant faux", () => {
  const nothing = [
    "", "   ", "bonjour", "je veux envoyer de l'argent", "un transfert s'il te plaît", "zéro", "0", "00",
    "5,5", "un mille", "cinq cinq", "cent soixante dix cinq", "vingt dix", "mille mille",
    "deux milliards", "1 000 000 000", "1234567890",
  ];
  for (const text of nothing) assert.equal(parseAmount(text), undefined, JSON.stringify(text));
});

test("parseAmount : « un » seul est l'article, sauf devant franc", () => {
  assert.equal(parseAmount("un transfert"), undefined);
  assert.equal(parseAmount("encaisse un franc"), 1);
});

// --- aller-retour ----------------------------------------------------------

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test("aller-retour : parseAmount(toFrenchWords(n)) = n, de 2 à 20 000", () => {
  for (let n = 2; n <= 20_000; n++) {
    assert.equal(parseAmount(toFrenchWords(n)), n, `${n} : ${toFrenchWords(n)}`);
  }
});

test("aller-retour : valeurs aléatoires et bornes jusqu'à 999 999 999", () => {
  const rand = mulberry32(20261028);
  const values = new Set<number>([100, 1000, 999_999, 1_000_000, 80_000_000, 200_000_000, 999_999_999, 900_000_000]);
  for (let i = 0; i < 6000; i++) {
    const digits = 1 + Math.floor(rand() * 9);
    values.add(Math.max(2, Math.floor(rand() * 10 ** digits)));
  }
  for (const n of values) {
    assert.equal(parseAmount(toFrenchWords(n)), n, `${n} : ${toFrenchWords(n)}`);
  }
});

test("aller-retour : l'affichage en chiffres est relu à l'identique", () => {
  const rand = mulberry32(42);
  for (let i = 0; i < 3000; i++) {
    const n = Math.max(1, Math.floor(rand() * 10 ** (1 + Math.floor(rand() * 9))));
    assert.equal(parseAmount(formatXof(n)), n, formatXof(n));
    assert.equal(parseAmount(String(n)), n, String(n));
  }
});

test("la phrase complète garde son montant, quelle que soit la forme (mots ou chiffres)", () => {
  for (const n of [5000, 150000, 250000, 1500, 90000]) {
    assert.equal(parseAmount(`Envoie ${toFrenchWords(n)} francs à Koné`), n);
    assert.equal(parseAmount(`Envoie ${formatXof(n)} francs à Koné`), n);
  }
});
