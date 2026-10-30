import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  DEFAULT_AETHEX_BASE_URL, DEFAULT_AETHEX_VOICE_ID, DEFAULT_ARGUS_ACCOUNT_ID, DEFAULT_ARGUS_DEVICE_ID, loadConfig,
} from "../src/lib/config";

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

test("config : Argus en mode api seulement si l'adresse ET la clé de licence sont renseignées", () => {
  assert.equal(loadConfig({}).argus.mode, "local");
  assert.equal(loadConfig({ ARGUS_URL: "http://localhost:4040" }).argus.mode, "local");
  assert.equal(loadConfig({ ARGUS_LICENSE_KEY: "k" }).argus.mode, "local");
  assert.equal(loadConfig({ ARGUS_URL: "  ", ARGUS_LICENSE_KEY: "k" }).argus.mode, "local");

  const on = loadConfig({ ARGUS_URL: " http://localhost:4040 ", ARGUS_LICENSE_KEY: " k " }).argus;
  assert.deepEqual([on.mode, on.url, on.licenseKey], ["api", "http://localhost:4040", "k"]);

  for (const mode of ["local", "LOCAL", " Local "]) {
    assert.equal(loadConfig({ ARGUS_URL: "http://x", ARGUS_LICENSE_KEY: "k", ARGUS_MODE: mode }).argus.mode, "local", mode);
  }
  assert.equal(loadConfig({ ARGUS_URL: "http://x", ARGUS_LICENSE_KEY: "k", ARGUS_MODE: "api" }).argus.mode, "api");
});

test("config : comptes, appareil et délai d'Argus ont des valeurs par défaut et un délai borné", () => {
  const d = loadConfig({}).argus;
  assert.deepEqual([d.senderAccountId, d.deviceId, d.timeoutMs], [DEFAULT_ARGUS_ACCOUNT_ID, DEFAULT_ARGUS_DEVICE_ID, 2000]);
  const custom = loadConfig({ ARGUS_ACCOUNT_ID: "mon-compte", ARGUS_DEVICE_ID: "mon-appareil" }).argus;
  assert.deepEqual([custom.senderAccountId, custom.deviceId], ["mon-compte", "mon-appareil"]);
  const timeout = (v: string) => loadConfig({ ARGUS_TIMEOUT_MS: v }).argus.timeoutMs;
  assert.equal(timeout("1500"), 1500);
  assert.equal(timeout("50"), 200, "trop court : borné");
  assert.equal(timeout("99999"), 10_000, "trop long : borné");
  assert.equal(timeout("abc"), 2000);
  assert.equal(timeout(""), 2000);
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
  assert.equal(values.ARGUS_LICENSE_KEY, "", "pas de clé de licence Argus");
  assert.equal(values.ARGUS_URL, "", "pas d'adresse d'Argus imposée");
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
