// Crée la licence Argus et branche l'application dessus : npm run argus:licence
// Prérequis : `npm run argus:env` puis `npm run argus:up` (Argus répond sur http://127.0.0.1:4040).
// Étapes : connexion de l'administrateur d'Argus (ADMIN_EMAIL / ADMIN_PASSWORD de docker/argus/.env), création de la
// licence (POST /v1/licenses : la clé n'est montrée qu'une fois), puis écriture de ARGUS_URL et ARGUS_LICENSE_KEY dans
// .env.local (ignoré par git). N'affiche jamais la clé, ni le mot de passe, ni les jetons.
// Une licence existante n'est pas remplacée sans `--force`.

import { existsSync, readFileSync, writeFileSync } from "node:fs";

const ARGUS_URL = "http://127.0.0.1:4040";
const DOCKER_ENV = "docker/argus/.env";
const LOCAL_ENV = ".env.local";

function readEnvFile(path: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const m = /^([A-Z_][A-Z0-9_]*)=(.*)$/.exec(line);
    if (m) out[m[1]] = m[2].trim();
  }
  return out;
}

/** Met à jour (ou ajoute) des lignes CLE=valeur en gardant tout le reste du fichier tel quel. */
function setEnvValues(path: string, values: Record<string, string>): void {
  const text = existsSync(path) ? readFileSync(path, "utf8") : "";
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text ? text.split(/\r?\n/) : [];
  for (const [key, value] of Object.entries(values)) {
    const i = lines.findIndex((l) => l.startsWith(`${key}=`));
    if (i >= 0) lines[i] = `${key}=${value}`;
    else lines.push(`${key}=${value}`);
  }
  writeFileSync(path, lines.join(eol).replace(/(\r?\n)*$/, eol), "utf8");
}

async function call(path: string, init: RequestInit): Promise<Response> {
  return fetch(`${ARGUS_URL}${path}`, { ...init, signal: AbortSignal.timeout(15_000), cache: "no-store" });
}

async function main(): Promise<number> {
  if (!existsSync(DOCKER_ENV)) {
    console.error("docker/argus/.env est absent : lance d'abord `npm run argus:env`, puis `npm run argus:up`.");
    return 1;
  }
  const docker = readEnvFile(DOCKER_ENV);
  const email = docker.ADMIN_EMAIL;
  const password = docker.ADMIN_PASSWORD;
  if (!email || !password) {
    console.error("ADMIN_EMAIL ou ADMIN_PASSWORD manque dans docker/argus/.env.");
    return 1;
  }

  const local = existsSync(LOCAL_ENV) ? readEnvFile(LOCAL_ENV) : {};
  if (local.ARGUS_LICENSE_KEY && !process.argv.includes("--force")) {
    console.log("Une licence est déjà enregistrée dans .env.local : rien n'a été changé (ajoute --force pour en créer une nouvelle).");
    return 0;
  }

  try {
    const login = await call("/v1/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    if (!login.ok) {
      console.error(`Connexion refusée par Argus (code ${login.status}). Argus est-il démarré et sain ? (docker compose ps)`);
      return 1;
    }
    const { access_token: token } = (await login.json()) as { access_token?: string };
    if (!token) {
      console.error("Argus n'a pas renvoyé de jeton de connexion.");
      return 1;
    }

    const created = await call("/v1/licenses", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ fail_mode: "closed" }),
    });
    if (!created.ok) {
      console.error(`Création de la licence refusée (code ${created.status}).`);
      return 1;
    }
    const { license_key: key } = (await created.json()) as { license_key?: string };
    if (!key) {
      console.error("Argus n'a pas renvoyé de clé de licence.");
      return 1;
    }

    setEnvValues(LOCAL_ENV, { ARGUS_URL, ARGUS_LICENSE_KEY: key });
    console.log("Licence créée et enregistrée dans .env.local (ARGUS_URL et ARGUS_LICENSE_KEY).");
    if (local.ARGUS_MODE?.toLowerCase() === "local") {
      console.log("Attention : ARGUS_MODE=local est réglé dans .env.local, l'application ignorera Argus. Vide cette valeur.");
    }
    console.log("Redémarre l'application, puis lance `npm run argus:test` pour voir les vraies décisions d'Argus.");
    return 0;
  } catch {
    console.error(`Argus est injoignable sur ${ARGUS_URL} : lance \`npm run argus:up\` et attends que les conteneurs soient sains.`);
    return 1;
  }
}

main().then((code) => {
  process.exitCode = code;
});
