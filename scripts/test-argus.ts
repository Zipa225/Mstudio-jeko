// Test RÉEL d'Argus, à lancer à la main : npm run argus:test
// Envoie quatre opérations à l'API Argus configurée dans .env.local (ARGUS_URL, ARGUS_LICENSE_KEY) et affiche ce qu'elle décide.
// Ne fait pas partie de la suite automatique : les tests automatiques n'appellent jamais les vraies API.
// N'affiche jamais la clé de licence.

import { existsSync } from "node:fs";
import { loadConfig } from "../src/lib/config";
import type { RiskRequest } from "../src/lib/ports";
import { ArgusError, createArgusRisk, describeArgusFailure } from "../src/lib/riskArgus";

async function main(): Promise<number> {
  if (existsSync(".env.local")) process.loadEnvFile(".env.local");
  const { argus } = loadConfig();
  if (argus.mode !== "api" || !argus.url || !argus.licenseKey) {
    console.error("Argus n'est pas configuré : renseigne ARGUS_URL et ARGUS_LICENSE_KEY dans .env.local (et pas ARGUS_MODE=local).");
    return 1;
  }

  const risk = createArgusRisk({
    baseUrl: argus.url,
    licenseKey: argus.licenseKey,
    senderAccountId: argus.senderAccountId,
    deviceId: argus.deviceId,
    timeoutMs: Math.max(argus.timeoutMs, 5000),
  });

  const base = { avgTicket: 4500, previousOps: 0, now: new Date() };
  const cases: Array<[string, RiskRequest]> = [
    ["Encaissement de 5 000 FCFA", { ...base, kind: "collect", amount: 5000, beneficiaryAccount: argus.senderAccountId, beneficiaryKnown: true }],
    ["Transfert de 5 000 FCFA vers un contact connu", { ...base, kind: "send", amount: 5000, beneficiaryAccount: "0100000001", beneficiaryKnown: true }],
    ["Transfert de 150 000 FCFA vers un inconnu (scène de la contrainte)", { ...base, kind: "send", amount: 150_000, beneficiaryAccount: "nom:kone", beneficiaryKnown: false }],
    ["Transfert de 250 000 FCFA vers un inconnu (refus attendu)", { ...base, kind: "send", amount: 250_000, beneficiaryAccount: "nom:kone", beneficiaryKnown: false }],
  ];

  let failures = 0;
  for (const [label, request] of cases) {
    console.log(`\n${label}`);
    try {
      const a = await risk.assess(request);
      console.log(`  décision : ${a.decision} (score ${a.score}/100), modèle ${a.modelVersion ?? "inconnu"}`);
      if (a.decisionReason) console.log(`  raison   : ${a.decisionReason}`);
      for (const f of a.factors) console.log(`  facteur  : ${f.label} (+${f.points})`);
    } catch (error) {
      failures++;
      const status = error instanceof ArgusError && error.status ? ` [HTTP ${error.status}]` : "";
      console.log(`  ÉCHEC : ${describeArgusFailure(error)}${status}`);
    }
  }

  console.log(failures ? `\n${failures} appel(s) en échec : vérifie qu'Argus tourne et que la clé de licence est valide.` : "\nArgus répond sur les quatre cas.");
  return failures ? 1 : 0;
}

// Pas de process.exit() : sous Windows il plante quand des connexions réseau se ferment. On pose le code de sortie.
main().then((code) => {
  process.exitCode = code;
});
