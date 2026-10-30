// Graine d'historique pour Argus, à lancer UNE FOIS avant la démo : npm run argus:seed
// Argus calcule lui-même les habitudes d'un compte à partir des transactions qu'il a vues. Pour qu'un transfert de 150 000
// FCFA paraisse « inhabituel », le compte d'Awa doit avoir un passé : on envoie douze opérations de quelques milliers de
// francs, étalées sur les dix derniers jours, en journée.
// À vérifier au premier lancement : qu'Argus accepte des horodatages passés. S'il les refuse, le script le dit.
// N'affiche jamais la clé de licence.

import { existsSync } from "node:fs";
import { loadConfig } from "../src/lib/config";
import type { RiskRequest } from "../src/lib/ports";
import { ArgusError, createArgusRisk, describeArgusFailure } from "../src/lib/riskArgus";
import { Store } from "../src/lib/store";

const DAY = 86_400_000;
const AMOUNTS = [2500, 5000, 3000, 7500, 1500, 4000, 6000, 2000, 8000, 5500, 3500, 4500];

async function main(): Promise<number> {
  if (existsSync(".env.local")) process.loadEnvFile(".env.local");
  const { argus } = loadConfig();
  if (argus.mode !== "api" || !argus.url || !argus.licenseKey) {
    console.error("Argus n'est pas configuré : renseigne ARGUS_URL et ARGUS_LICENSE_KEY dans .env.local.");
    return 1;
  }

  const risk = createArgusRisk({
    baseUrl: argus.url,
    licenseKey: argus.licenseKey,
    senderAccountId: argus.senderAccountId,
    deviceId: argus.deviceId,
    timeoutMs: Math.max(argus.timeoutMs, 5000),
  });

  const contacts = new Store().merchant.contacts;
  const history: RiskRequest[] = AMOUNTS.map((amount, i) => {
    const when = new Date(Date.now() - (i + 1) * 0.8 * DAY);
    when.setUTCHours(9 + (i % 7), 15, 0, 0); // en journée, heure d'Abidjan (UTC)
    const send = i % 3 === 0;
    return {
      kind: send ? "send" : "collect",
      amount,
      beneficiaryAccount: send ? contacts[i % contacts.length].phone : argus.senderAccountId,
      beneficiaryKnown: true,
      avgTicket: 4500,
      previousOps: 0,
      now: when,
    };
  });

  let sent = 0;
  let failed = 0;
  for (const request of history) {
    try {
      await risk.assess(request);
      sent++;
    } catch (error) {
      failed++;
      const status = error instanceof ArgusError && error.status ? ` [HTTP ${error.status}]` : "";
      console.log(`  échec (${request.now.toISOString()}) : ${describeArgusFailure(error)}${status}`);
    }
  }

  console.log(`\n${sent} opération(s) envoyée(s) à Argus, ${failed} en échec.`);
  if (failed) console.log("Si Argus refuse les dates passées, dis-le moi : on adaptera la graine.");
  return failed ? 1 : 0;
}

// Pas de process.exit() : sous Windows il plante quand des connexions réseau se ferment. On pose le code de sortie.
main().then((code) => {
  process.exitCode = code;
});
