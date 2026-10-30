// Assemblage de l'application côté serveur : un seul store, une seule fausse caisse, un seul dialogue.
// Les routes passent toutes par ici. L'instance est gardée sur `globalThis` pour survivre au rechargement à chaud de Next.
// Rien de secret n'est écrit ici : la clé de signature vient de la configuration, ou est générée au hasard.

import { createAethexVoice } from "./aethex";
import { getConfig, type AppConfig, type ArgusConfig, type JekoConfig } from "./config";
import { createDialog, type Dialog } from "./dialog";
import { createDuressGuard } from "./duress";
import { createJekoLive } from "./jekoLive";
import { JekoMock } from "./jekoMock";
import { createProspectAgent, type ProspectAgent } from "./leads";
import { createWebhookReceiver, type WebhookOutcome, type WebhookRequest } from "./jekoWebhook";
import type { AsyncCashier, AsyncRisk, Cashier, SyncRisk, VoiceService } from "./ports";
import { createArgusRisk, withFallback } from "./riskArgus";
import { createLocalRisk } from "./riskLocal";
import { Store } from "./store";

/** Une alerte « mode dégradé » au plus par minute, pour ne pas inonder l'écran de l'analyste. */
const DEGRADED_ALERT_EVERY_MS = 60_000;

export interface RuntimeOptions {
  clock?: () => Date;
  /** Clé de signature des webhooks (sinon : configuration, sinon : clé aléatoire). */
  secret?: string;
  /** Lit la phrase de contrainte à chaque tour (sinon : configuration). */
  getPhrase?: () => string | undefined;
  /** Active les routes de démonstration (simuler le client, remettre à zéro). */
  demoMode?: boolean;
  /** Réglages d'Argus (sinon : configuration). */
  argus?: ArgusConfig;
  /** Moteur de risque imposé (tests). */
  risk?: SyncRisk | AsyncRisk;
  /** `fetch` utilisé pour appeler Argus (tests). */
  fetchImpl?: typeof fetch;
  /** Réglages d'AethexAI (sinon : configuration). */
  aethex?: AppConfig["aethex"];
  /** Voix imposée (tests) ; `null` force « pas de voix serveur ». */
  voice?: VoiceService | null;
  /** `fetch` utilisé pour appeler AethexAI (tests). */
  aethexFetch?: typeof fetch;
  /** Réglages de Jèko (sinon : configuration). */
  jeko?: JekoConfig;
  /** Caisse imposée (tests). */
  cashier?: Cashier | AsyncCashier;
  /** `fetch` utilisé pour appeler Jèko (tests). */
  jekoFetch?: typeof fetch;
}

/** Nombre de phrases récentes que la synthèse vocale accepte de prononcer. */
const SPEECH_MEMORY = 200;

export interface Runtime {
  readonly options: RuntimeOptions;
  store: Store;
  /** La fausse caisse : toujours là, car elle fournit la clé de signature des webhooks et simule le client en mode démo. */
  mock: JekoMock;
  /** `live` : la vraie API Jèko crée les demandes de paiement. `mock` : fausse caisse. */
  cashierMode: "mock" | "live";
  /** Vrai si la clé de signature des webhooks vient de la configuration (sinon les vrais webhooks Jèko seront refusés). */
  webhookConfigured: boolean;
  dialog: Dialog;
  /** L'entretien des visiteurs de la page /prospect (F12). */
  prospects: ProspectAgent;
  receive: (req: WebhookRequest) => WebhookOutcome;
  getPhrase: () => string | undefined;
  demoMode: boolean;
  /** Qui examine les opérations : l'API Argus (avec le calcul local en secours) ou le calcul local seul. */
  riskMode: "api" | "local";
  /** La voix serveur (AethexAI), si une clé est configurée. Sinon, la page utilise la voix du navigateur. */
  voice: VoiceService | undefined;
  voiceMode: "aethex" | "browser";
  /** La synthèse ne prononce que des phrases produites par le serveur : on les mémorise ici. */
  allowSpeech(text: string): void;
  isAllowedSpeech(text: string): boolean;
}

function notifyDegraded(store: Store, reason: string): void {
  const now = store.now().getTime();
  const last = [...store.alerts].reverse().find((a) => a.type === "degraded");
  if (last && now - last.ts < DEGRADED_ALERT_EVERY_MS) return;
  store.addAlert({
    level: "warning",
    type: "degraded",
    title: "Argus indisponible : score local utilisé",
    detail: `Mode dégradé : ${reason}. Les opérations sont examinées par le calcul local simplifié, jamais exécutées sans score.`,
  });
}

export function createRuntime(options: RuntimeOptions = {}): Runtime {
  const getPhrase = options.getPhrase ?? (() => getConfig().duressPhrase);
  const store = new Store(options.clock);
  const mock = new JekoMock({ secret: options.secret, clock: options.clock });
  const argus = options.argus ?? getConfig().argus;
  const local = createLocalRisk();
  let risk: SyncRisk | AsyncRisk = local;
  if (options.risk) {
    risk = options.risk;
  } else if (argus.mode === "api" && argus.url && argus.licenseKey) {
    const remote = createArgusRisk({
      baseUrl: argus.url,
      licenseKey: argus.licenseKey,
      senderAccountId: argus.senderAccountId,
      deviceId: argus.deviceId,
      timeoutMs: argus.timeoutMs,
      fetchImpl: options.fetchImpl,
    });
    risk = withFallback(remote, local, (reason) => notifyDegraded(store, reason));
  }
  const jeko = options.jeko ?? getConfig().jeko;
  let cashier: Cashier | AsyncCashier = mock;
  let cashierMode: "mock" | "live" = "mock";
  if (options.cashier) {
    cashier = options.cashier;
    cashierMode = options.cashier === mock ? "mock" : "live";
  } else if (jeko.mode === "live" && jeko.apiKey && jeko.apiKeyId && jeko.storeId) {
    cashier = createJekoLive({
      baseUrl: jeko.baseUrl,
      apiKey: jeko.apiKey,
      apiKeyId: jeko.apiKeyId,
      storeId: jeko.storeId,
      publicBaseUrl: jeko.publicBaseUrl,
      timeoutMs: jeko.timeoutMs,
      fetchImpl: options.jekoFetch,
    });
    cashierMode = "live";
  }
  const dialog = createDialog({
    store, cashier, guard: createDuressGuard(store, getPhrase, cashier.decoyPayUrl?.bind(cashier)), risk,
  });
  const receive = createWebhookReceiver({ store, secret: mock.webhookSecret });

  const aethex = options.aethex ?? getConfig().aethex;
  let voice: VoiceService | undefined;
  if (options.voice !== undefined) voice = options.voice ?? undefined;
  else if (aethex.apiKey) {
    voice = createAethexVoice({ baseUrl: aethex.baseUrl, apiKey: aethex.apiKey, voiceId: aethex.voiceId, fetchImpl: options.aethexFetch });
  }

  const allowed = new Set<string>();
  return {
    options, store, mock, cashierMode, dialog, prospects: createProspectAgent({ store }),
    webhookConfigured: Boolean(options.secret ?? getConfig().jekoWebhookSecret), receive, getPhrase,
    demoMode: options.demoMode ?? getConfig().demoMode,
    riskMode: risk.async === true ? "api" : "local",
    voice,
    voiceMode: voice ? "aethex" : "browser",
    allowSpeech(text: string) {
      allowed.add(text);
      if (allowed.size > SPEECH_MEMORY) allowed.delete(allowed.values().next().value as string);
    },
    isAllowedSpeech: (text: string) => allowed.has(text),
  };
}

const g = globalThis as unknown as { __jekoRuntime?: Runtime };

export function getRuntime(): Runtime {
  return (g.__jekoRuntime ??= createRuntime());
}

/** Remise à zéro de la démonstration : tout est recréé avec les mêmes réglages. */
export function resetRuntime(): Runtime {
  return (g.__jekoRuntime = createRuntime(getRuntime().options));
}

/** Pour les tests : remplace l'instance courante. */
export function replaceRuntime(runtime: Runtime): Runtime {
  return (g.__jekoRuntime = runtime);
}
