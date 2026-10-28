// Configuration centrale, lue depuis l'environnement. Les secrets ne vivent que côté serveur.
// Règle : aucune valeur secrète par défaut. Une phrase de contrainte absente désactive la détection.

export const DEFAULT_AETHEX_BASE_URL = "https://api.aethexai.com/api/v1";
/** Voix ivoirienne Adjoua (identifiant public de la liste officielle des voix). */
export const DEFAULT_AETHEX_VOICE_ID = "c32631f7-1018-54aa-84f8-725411de8636";

/** Comptes et appareil de démonstration envoyés à Argus (identifiants fictifs, pas des secrets). */
export const DEFAULT_ARGUS_ACCOUNT_ID = "awa-demo-compte";
export const DEFAULT_ARGUS_DEVICE_ID = "device-awa-demo";
export const DEFAULT_ARGUS_TIMEOUT_MS = 2000;

export interface ArgusConfig {
  /** `api` seulement si l'adresse ET la clé de licence sont renseignées et que ARGUS_MODE n'impose pas `local`. */
  mode: "api" | "local";
  url: string | undefined;
  licenseKey: string | undefined;
  /** Compte d'Awa : émetteur d'un transfert, bénéficiaire d'un encaissement. */
  senderAccountId: string;
  deviceId: string;
  timeoutMs: number;
}

export interface AppConfig {
  aethex: {
    apiKey: string | undefined;
    baseUrl: string;
    voiceId: string;
    configured: boolean;
  };
  /** undefined : la détection de contrainte est désactivée. */
  duressPhrase: string | undefined;
  /** undefined : la fausse caisse génère une clé aléatoire au démarrage. */
  jekoWebhookSecret: string | undefined;
  argus: ArgusConfig;
  demoMode: boolean;
  /** Plafond issu des notes des ingénieurs Jèko (à confirmer : par transaction ou cumulé ?). */
  ceilingXof: number;
  /** Seuils de décision du score de risque (0 à 100). */
  thresholds: { verify: number; block: number };
}

type Env = Record<string, string | undefined>;

const clean = (v: string | undefined): string | undefined => {
  const t = v?.trim();
  return t ? t : undefined;
};

export function loadConfig(env: Env = process.env): AppConfig {
  const apiKey = clean(env.AETHEX_API_KEY);
  const argusUrl = clean(env.ARGUS_URL);
  const argusKey = clean(env.ARGUS_LICENSE_KEY);
  const argusTimeout = Number.parseInt(env.ARGUS_TIMEOUT_MS ?? "", 10);
  return {
    aethex: {
      apiKey,
      baseUrl: clean(env.AETHEX_BASE_URL) ?? DEFAULT_AETHEX_BASE_URL,
      voiceId: clean(env.AETHEX_VOICE_ID) ?? DEFAULT_AETHEX_VOICE_ID,
      configured: apiKey !== undefined,
    },
    duressPhrase: clean(env.DURESS_PHRASE),
    jekoWebhookSecret: clean(env.JEKO_WEBHOOK_SECRET),
    argus: {
      mode: clean(env.ARGUS_MODE)?.toLowerCase() !== "local" && argusUrl && argusKey ? "api" : "local",
      url: argusUrl,
      licenseKey: argusKey,
      senderAccountId: clean(env.ARGUS_ACCOUNT_ID) ?? DEFAULT_ARGUS_ACCOUNT_ID,
      deviceId: clean(env.ARGUS_DEVICE_ID) ?? DEFAULT_ARGUS_DEVICE_ID,
      timeoutMs: Number.isFinite(argusTimeout) ? Math.min(10_000, Math.max(200, argusTimeout)) : DEFAULT_ARGUS_TIMEOUT_MS,
    },
    demoMode: env.DEMO_MODE === "1",
    ceilingXof: 200_000,
    thresholds: { verify: 35, block: 65 },
  };
}

/** Configuration du processus courant (relue à chaque appel : pratique pour les tests). */
export const getConfig = (): AppConfig => loadConfig();
