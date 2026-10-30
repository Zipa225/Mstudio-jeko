// Pose les règles de la démonstration dans Argus : npm run argus:regles (rejouable : une règle existante est mise à jour).
// Pourquoi : le modèle d'Argus ne réagit pas au montant seul (100 millions de FCFA y valent un score de 4 sur 100). Argus a
// un moteur de règles dont l'action l'emporte sur le modèle : c'est là que se règlent les seuils propres à ce compte.
//   - DEMO_TRANSFERT_ELEVE_NOUVEAU_NUMERO : 100 000 FCFA ou plus vers un nouveau bénéficiaire -> VERIFY (question de vérification)
//   - DEMO_PLAFOND_DEPASSE                : plus de 200 000 FCFA (plafond du compte)             -> BLOCK (refus, rappel d'un conseiller)
// Les petits montants (encaissements, transferts vers un contact connu) ne déclenchent rien.
// Prérequis : Argus démarré (`npm run argus:up`). Se connecte avec l'administrateur de docker/argus/.env. N'affiche aucun secret.

import { existsSync, readFileSync } from "node:fs";

const ARGUS_URL = "http://127.0.0.1:4040";

interface RuleSpec {
  code: string;
  name: string;
  description: string;
  action: "VERIFY" | "BLOCK";
  priority: number;
  condition: Record<string, unknown>;
}

const RULES: RuleSpec[] = [
  {
    code: "DEMO_PLAFOND_DEPASSE",
    name: "Montant au-dessus du plafond du compte",
    description: "Plus de 200 000 FCFA en une opération : refusée, un conseiller rappelle le marchand.",
    action: "BLOCK",
    priority: 10,
    condition: { fact: "amount", op: ">", value: 200_000 },
  },
  {
    code: "DEMO_TRANSFERT_ELEVE_NOUVEAU_NUMERO",
    name: "Transfert élevé vers un nouveau numéro",
    description: "100 000 FCFA ou plus vers un bénéficiaire jamais vu : confirmation vocale demandée.",
    action: "VERIFY",
    priority: 20,
    condition: { all: [{ fact: "amount", op: ">=", value: 100_000 }, { fact: "new_beneficiary", op: "==", value: true }] },
  },
];

function readEnvFile(path: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const m = /^([A-Z_][A-Z0-9_]*)=(.*)$/.exec(line);
    if (m) out[m[1]] = m[2].trim();
  }
  return out;
}

async function main(): Promise<number> {
  if (!existsSync("docker/argus/.env")) {
    console.error("docker/argus/.env est absent : lance d'abord `npm run argus:env` puis `npm run argus:up`.");
    return 1;
  }
  const { ADMIN_EMAIL: email, ADMIN_PASSWORD: password } = readEnvFile("docker/argus/.env");
  const call = (path: string, init: RequestInit, token?: string) =>
    fetch(`${ARGUS_URL}${path}`, {
      ...init,
      headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
      signal: AbortSignal.timeout(15_000),
      cache: "no-store",
    });

  try {
    const login = await call("/v1/auth/login", { method: "POST", body: JSON.stringify({ email, password }) });
    if (!login.ok) {
      console.error(`Connexion refusée par Argus (code ${login.status}). Argus est-il démarré et sain ?`);
      return 1;
    }
    const { access_token: token } = (await login.json()) as { access_token?: string };
    if (!token) {
      console.error("Argus n'a pas renvoyé de jeton.");
      return 1;
    }

    let failures = 0;
    for (const rule of RULES) {
      const found = await call(`/v1/rules?search=${encodeURIComponent(rule.code)}&limit=50`, { method: "GET" }, token);
      const body = found.ok ? ((await found.json()) as unknown) : undefined;
      const list = Array.isArray(body) ? body : ((body as { data?: unknown[] } | undefined)?.data ?? []);
      const existing = (list as Array<{ id?: string; code?: string }>).find((r) => r.code === rule.code);

      const { code, ...fields } = rule;
      const res = existing?.id
        ? await call(`/v1/rules/${existing.id}`, { method: "PATCH", body: JSON.stringify({ ...fields, enabled: true }) }, token)
        : await call("/v1/rules", { method: "POST", body: JSON.stringify({ code, ...fields, enabled: true }) }, token);
      if (res.ok) console.log(`${existing ? "mise à jour" : "créée"}  ${code}  (${rule.action})`);
      else {
        failures++;
        console.error(`ÉCHEC  ${code} : Argus a répondu ${res.status}`);
      }
    }
    if (!failures) console.log("\nRègles en place. Lance `npm run argus:test` pour voir les décisions.");
    return failures ? 1 : 0;
  } catch {
    console.error(`Argus est injoignable sur ${ARGUS_URL} : lance \`npm run argus:up\`.`);
    return 1;
  }
}

main().then((code) => {
  process.exitCode = code;
});
