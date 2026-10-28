// Configuration centrale, lue depuis l'environnement. Les secrets ne vivent que côté serveur.
// Règle : aucune valeur secrète par défaut. Une phrase de contrainte absente désactive la détection.

export const DEFAULT_AETHEX_BASE_URL = "https://api.aethexai.com/api/v1";
/** Voix ivoirienne Adjoua (identifiant public de la liste officielle des voix). */
export const DEFAULT_AETHEX_VOICE_ID = "c32631f7-1018-54aa-84f8-725411de8636";

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
  return {
    aethex: {
      apiKey,
      baseUrl: clean(env.AETHEX_BASE_URL) ?? DEFAULT_AETHEX_BASE_URL,
      voiceId: clean(env.AETHEX_VOICE_ID) ?? DEFAULT_AETHEX_VOICE_ID,
      configured: apiKey !== undefined,
    },
    duressPhrase: clean(env.DURESS_PHRASE),
    jekoWebhookSecret: clean(env.JEKO_WEBHOOK_SECRET),
    demoMode: env.DEMO_MODE === "1",
    ceilingXof: 200_000,
    thresholds: { verify: 35, block: 65 },
  };
}

/** Configuration du processus courant (relue à chaque appel : pratique pour les tests). */
export const getConfig = (): AppConfig => loadConfig();
