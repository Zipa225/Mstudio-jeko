// Test RÉEL de Jèko, à lancer à la main :
//   npm run jeko:stores     liste les boutiques du compte (lecture seule) pour trouver JEKO_STORE_ID
//   npm run jeko:test       crée UNE vraie demande de paiement de 5 FCFA (le minimum) et affiche le lien du client
// Jèko n'a pas de bac à sable : la demande est réelle. Elle ne débite personne tant que personne n'ouvre le lien et ne paie.
// Utilise JEKO_API_KEY, JEKO_API_KEY_ID, JEKO_STORE_ID, JEKO_BASE_URL de .env.local (JEKO_MODE n'est pas nécessaire ici).
// Ne fait pas partie de la suite automatique : les tests automatiques n'appellent jamais les vraies API.
// N'affiche jamais les clés.

import { existsSync } from "node:fs";
import { loadConfig } from "../src/lib/config";
import { createJekoLive, describeJekoFailure } from "../src/lib/jekoLive";

async function main(): Promise<number> {
  if (existsSync(".env.local")) process.loadEnvFile(".env.local");
  const { jeko } = loadConfig();
  if (!jeko.apiKey || !jeko.apiKeyId) {
    console.error("Jèko n'est pas configuré : renseigne JEKO_API_KEY et JEKO_API_KEY_ID dans .env.local.");
    return 1;
  }
  const listOnly = process.argv.includes("--stores");
  if (!listOnly && !jeko.storeId) {
    console.error("Renseigne JEKO_STORE_ID dans .env.local (npm run jeko:stores le donne).");
    return 1;
  }

  const client = createJekoLive({
    baseUrl: jeko.baseUrl,
    apiKey: jeko.apiKey,
    apiKeyId: jeko.apiKeyId,
    storeId: jeko.storeId ?? "inconnu",
    publicBaseUrl: jeko.publicBaseUrl,
    timeoutMs: Math.max(jeko.timeoutMs, 15_000),
  });

  try {
    if (listOnly) {
      const stores = (await client.listStores()) as unknown;
      const list = Array.isArray(stores) ? stores : Array.isArray((stores as { data?: unknown })?.data) ? (stores as { data: unknown[] }).data : [];
      if (list.length === 0) {
        console.log("Aucune boutique reconnue dans la réponse :", JSON.stringify(stores).slice(0, 500));
        return 1;
      }
      console.log(`${list.length} boutique(s). Recopie l'identifiant choisi dans JEKO_STORE_ID :\n`);
      for (const entry of list as Array<Record<string, unknown>>) console.log(`  ${String(entry.id)}  ${String(entry.name ?? "")}`);
      return 0;
    }

    console.log("Création d'une vraie demande de paiement de 5 FCFA par Wave...");
    const started = Date.now();
    const launched = await client.createPaymentRequest({ amount: 5, wallet: "wave" });
    console.log(`  créée en ${Date.now() - started} ms`);
    console.log(`  référence : ${launched.id}`);
    console.log(`  lien du client : ${launched.payUrl}`);
    console.log("\nNe paie pas si tu ne veux pas être débité de 5 FCFA. Pour tester le webhook, paie ce lien avec un compte Wave,");
    console.log("après avoir enregistré l'adresse publique /api/webhook/jeko de l'application dans le tableau de bord Jèko.");
    return 0;
  } catch (error) {
    console.error(`\nÉCHEC : ${describeJekoFailure(error)}`);
    return 1;
  }
}

main().then((code) => {
  process.exitCode = code;
});
