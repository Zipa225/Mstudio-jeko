// Prépare docker/argus/.env pour lancer Argus en local : npm run argus:env
// Part de docker/argus/.env.example et remplace chaque « a_generer » par un secret aléatoire. N'écrase jamais un .env
// existant (ses secrets sont déjà dans la base d'Argus : les changer casserait les mots de passe). N'affiche aucun secret.

import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const EXAMPLE = "docker/argus/.env.example";
const TARGET = "docker/argus/.env";

function main(): number {
  if (existsSync(TARGET)) {
    console.log(`${TARGET} existe déjà : rien n'a été changé (supprime-le pour en générer un nouveau, avec \`npm run argus:down -- -v\`).`);
    return 0;
  }
  const model = readFileSync(EXAMPLE, "utf8");
  const filled = model.replace(/^([A-Z_]+)=a_generer\s*$/gm, (_all, key: string) => `${key}=${randomBytes(24).toString("hex")}`);
  writeFileSync(TARGET, filled, { encoding: "utf8", mode: 0o600 });
  console.log(`${TARGET} créé avec des secrets aléatoires (ignoré par git).`);
  return 0;
}

process.exitCode = main();
