// Assemblage de l'application côté serveur : un seul store, une seule fausse caisse, un seul dialogue.
// Les routes passent toutes par ici. L'instance est gardée sur `globalThis` pour survivre au rechargement à chaud de Next.
// Rien de secret n'est écrit ici : la clé de signature vient de la configuration, ou est générée au hasard.

import { getConfig, type ArgusConfig } from "./config";
import { createDialog, type Dialog } from "./dialog";
import { createDuressGuard } from "./duress";
import { JekoMock } from "./jekoMock";
import { createWebhookReceiver, type WebhookOutcome, type WebhookRequest } from "./jekoWebhook";
import type { AsyncRisk, SyncRisk } from "./ports";
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
}

export interface Runtime {
  readonly options: RuntimeOptions;
  store: Store;
  mock: JekoMock;
  dialog: Dialog;
  receive: (req: WebhookRequest) => WebhookOutcome;
  getPhrase: () => string | undefined;
  demoMode: boolean;
  /** Qui examine les opérations : l'API Argus (avec le calcul local en secours) ou le calcul local seul. */
  riskMode: "api" | "local";
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
  const dialog = createDialog({ store, cashier: mock, guard: createDuressGuard(store, getPhrase), risk });
  const receive = createWebhookReceiver({ store, secret: mock.webhookSecret });
  return {
    options, store, mock, dialog, receive, getPhrase,
    demoMode: options.demoMode ?? getConfig().demoMode,
    riskMode: risk.async === true ? "api" : "local",
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
