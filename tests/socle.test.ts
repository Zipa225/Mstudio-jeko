import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_AETHEX_BASE_URL, DEFAULT_AETHEX_VOICE_ID, loadConfig } from "../src/lib/config";

const root = join(__dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

test("config : sans variables, aucune phrase ni clé par défaut", () => {
  const c = loadConfig({});
  assert.equal(c.duressPhrase, undefined, "aucune phrase de contrainte par défaut");
  assert.equal(c.aethex.apiKey, undefined);
  assert.equal(c.aethex.configured, false);
  assert.equal(c.jekoWebhookSecret, undefined);
  assert.equal(c.demoMode, false);
});

test("config : les valeurs publiques ont un défaut, pas les secrets", () => {
  const c = loadConfig({});
  assert.equal(c.aethex.baseUrl, DEFAULT_AETHEX_BASE_URL);
  assert.equal(c.aethex.voiceId, DEFAULT_AETHEX_VOICE_ID);
  assert.deepEqual(c.thresholds, { verify: 35, block: 65 });
  assert.equal(c.ceilingXof, 200_000);
});

test("config : les valeurs vides ou faites d'espaces comptent comme absentes", () => {
  const c = loadConfig({ DURESS_PHRASE: "   ", AETHEX_API_KEY: "", AETHEX_VOICE_ID: "  ", AETHEX_BASE_URL: "" });
  assert.equal(c.duressPhrase, undefined);
  assert.equal(c.aethex.configured, false);
  assert.equal(c.aethex.voiceId, DEFAULT_AETHEX_VOICE_ID);
  assert.equal(c.aethex.baseUrl, DEFAULT_AETHEX_BASE_URL);
});

test("config : lit les variables renseignées", () => {
  const c = loadConfig({
    AETHEX_API_KEY: " clé-de-test ",
    AETHEX_VOICE_ID: "voix-x",
    AETHEX_BASE_URL: "https://exemple.invalid/api",
    DURESS_PHRASE: " une phrase de test ",
    JEKO_WEBHOOK_SECRET: "s3cret",
    DEMO_MODE: "1",
  });
  assert.equal(c.aethex.apiKey, "clé-de-test");
  assert.equal(c.aethex.configured, true);
  assert.equal(c.aethex.voiceId, "voix-x");
  assert.equal(c.aethex.baseUrl, "https://exemple.invalid/api");
  assert.equal(c.duressPhrase, "une phrase de test");
  assert.equal(c.jekoWebhookSecret, "s3cret");
  assert.equal(c.demoMode, true);
});

test("dépôt : .env.local est ignoré par git", () => {
  const lines = read(".gitignore").split(/\r?\n/).map((l) => l.trim());
  assert.ok(lines.includes(".env.local"), ".env.local doit figurer dans .gitignore");
  assert.ok(lines.includes("node_modules"));
});

test("dépôt : le modèle .env.local.example ne contient aucun secret", () => {
  const values = Object.fromEntries(
    read(".env.local.example")
      .split(/\r?\n/)
      .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
      .map((l) => {
        const i = l.indexOf("=");
        return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
      }),
  );
  assert.equal(values.AETHEX_API_KEY, "", "pas de clé AethexAI");
  assert.equal(values.DURESS_PHRASE, "", "pas de phrase de contrainte dans git");
  assert.equal(values.JEKO_WEBHOOK_SECRET, "", "pas de clé de signature");
  assert.ok(!/ae_live_[A-Za-z0-9]/.test(read(".env.local.example")), "aucune vraie clé");
});

test("charte : les variables de STYLE.md sont définies dans globals.css", () => {
  const css = read("src/app/globals.css");
  for (const [name, hex] of [
    ["--jeko-violet", "#3a0ca2"],
    ["--jeko-violet-profond", "#240465"],
    ["--fond", "#f3f4f6"],
    ["--alerte-fond", "#fed99d"],
    ["--succes", "#0b7a3e"],
    ["--critique", "#e5484d"],
    ["--nuit", "#14053f"],
  ] as const) {
    assert.match(css, new RegExp(`${name}:\\s*${hex}`, "i"), `${name} doit valoir ${hex}`);
  }
});
