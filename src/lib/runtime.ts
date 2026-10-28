// Assemblage de l'application côté serveur : un seul store, une seule fausse caisse, un seul dialogue.
// Les routes passent toutes par ici. L'instance est gardée sur `globalThis` pour survivre au rechargement à chaud de Next.
// Rien de secret n'est écrit ici : la clé de signature vient de la configuration, ou est générée au hasard.

import { getConfig } from "./config";
import { createDialog, type Dialog } from "./dialog";
import { createDuressGuard } from "./duress";
import { JekoMock } from "./jekoMock";
import { createWebhookReceiver, type WebhookOutcome, type WebhookRequest } from "./jekoWebhook";
import { Store } from "./store";

export interface RuntimeOptions {
  clock?: () => Date;
  /** Clé de signature des webhooks (sinon : configuration, sinon : clé aléatoire). */
  secret?: string;
  /** Lit la phrase de contrainte à chaque tour (sinon : configuration). */
  getPhrase?: () => string | undefined;
  /** Active les routes de démonstration (simuler le client, remettre à zéro). */
  demoMode?: boolean;
}

export interface Runtime {
  readonly options: RuntimeOptions;
  store: Store;
  mock: JekoMock;
  dialog: Dialog;
  receive: (req: WebhookRequest) => WebhookOutcome;
  getPhrase: () => string | undefined;
  demoMode: boolean;
}

export function createRuntime(options: RuntimeOptions = {}): Runtime {
  const getPhrase = options.getPhrase ?? (() => getConfig().duressPhrase);
  const store = new Store(options.clock);
  const mock = new JekoMock({ secret: options.secret, clock: options.clock });
  const dialog = createDialog({ store, cashier: mock, guard: createDuressGuard(store, getPhrase) });
  const receive = createWebhookReceiver({ store, secret: mock.webhookSecret });
  return { options, store, mock, dialog, receive, getPhrase, demoMode: options.demoMode ?? getConfig().demoMode };
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
