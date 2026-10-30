// Test RÉEL d'AethexAI, à lancer à la main :
//   npm run aethex:test      synthèse puis transcription de la même phrase (aller-retour), avec la voix configurée
//   npm run aethex:voices    liste les voix françaises disponibles pour choisir AETHEX_VOICE_ID
// Utilise AETHEX_API_KEY, AETHEX_BASE_URL et AETHEX_VOICE_ID de .env.local. Consomme un peu de crédits (une phrase courte).
// Ne fait pas partie de la suite automatique : les tests automatiques n'appellent jamais les vraies API.
// N'affiche jamais la clé.

import { existsSync } from "node:fs";
import { createAethexVoice, describeAethexFailure } from "../src/lib/aethex";
import { loadConfig } from "../src/lib/config";

const PHRASE = "Tu veux encaisser cinq mille francs par Wave. Tu confirmes ?";

async function listVoices(baseUrl: string, apiKey: string): Promise<number> {
  const url = `${baseUrl.replace(/\/+$/, "")}/voices?language=french&country=CI`;
  try {
    const res = await fetch(url, { headers: { "x-api-key": apiKey }, signal: AbortSignal.timeout(10_000) });
    if (!res.ok) {
      console.error(`AethexAI a répondu avec le code ${res.status}.`);
      return 1;
    }
    const data = (await res.json()) as unknown;
    const list = Array.isArray(data) ? data : Array.isArray((data as { voices?: unknown })?.voices) ? (data as { voices: unknown[] }).voices : [];
    if (list.length === 0) {
      console.log("Aucune voix trouvée dans la réponse. Réponse brute :", JSON.stringify(data).slice(0, 500));
      return 1;
    }
    console.log(`${list.length} voix française(s) (Côte d'Ivoire). Recopie l'identifiant choisi dans AETHEX_VOICE_ID :\n`);
    for (const entry of list.slice(0, 30) as Array<Record<string, unknown>>) {
      const id = entry.id ?? entry.voice_id;
      const name = entry.name ?? entry.display_name ?? "";
      const extra = [entry.gender, entry.description].filter((v) => typeof v === "string" && v).join(", ");
      console.log(`  ${String(id)}  ${String(name)}${extra ? `  (${extra})` : ""}`);
    }
    return 0;
  } catch {
    console.error("AethexAI est injoignable.");
    return 1;
  }
}

async function main(): Promise<number> {
  if (existsSync(".env.local")) process.loadEnvFile(".env.local");
  const { aethex } = loadConfig();
  if (!aethex.apiKey) {
    console.error("AethexAI n'est pas configuré : renseigne AETHEX_API_KEY dans .env.local.");
    return 1;
  }
  if (process.argv.includes("--voices")) return listVoices(aethex.baseUrl, aethex.apiKey);

  const voice = createAethexVoice({ baseUrl: aethex.baseUrl, apiKey: aethex.apiKey, voiceId: aethex.voiceId, timeoutMs: 20_000 });
  console.log(`Voix demandée : ${aethex.voiceId || "(par défaut du service)"}`);

  try {
    console.log(`\nSynthèse : « ${PHRASE} »`);
    const started = Date.now();
    const { audio, contentType } = await voice.synthesize(PHRASE);
    console.log(`  reçu ${(audio.byteLength / 1024).toFixed(0)} Kio de ${contentType} en ${Date.now() - started} ms`);

    console.log("\nTranscription de cet audio :");
    const t0 = Date.now();
    const heard = await voice.transcribe(audio, contentType);
    console.log(`  « ${heard} » en ${Date.now() - t0} ms`);

    const same = heard.toLowerCase().replace(/[^a-zà-ÿ0-9 ]/g, "").includes("confirmes");
    console.log(same ? "\nAller-retour réussi : AethexAI comprend sa propre voix." : "\nTranscription différente de la phrase : écoute le résultat avant la démo.");
    return same ? 0 : 1;
  } catch (error) {
    console.error(`\nÉCHEC : ${describeAethexFailure(error)}`);
    return 1;
  }
}

main().then((code) => {
  process.exitCode = code;
});
