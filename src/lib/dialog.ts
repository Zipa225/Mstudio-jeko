// Le dialogue du marchand : une phrase entre, une réponse sort.
// Flux : intention, montant et bénéficiaire, examen du risque (Argus), relecture et confirmation, exécution.
// Règle d'or : aucune opération d'argent sans relecture du montant ET « oui » explicite du marchand.
//
// Le moteur de risque peut être local (synchrone) ou l'API Argus (par le réseau, donc asynchrone). Le dialogue est
// synchrone avec le moteur local, et asynchrone avec Argus : `createDialog` le dit dans son type. En mode asynchrone,
// les tours d'une même session passent l'un après l'autre : un « oui » n'est jamais traité avant la fin de l'examen.

import { getConfig } from "./config";
import { parseAmount, toFrenchWords } from "./frenchNumbers";
import {
  extractBeneficiary, extractPhone, extractWallet, formatPhone, isNo, isYes, kindFrom, parseIntent, WALLET_LABEL, type Intent, type Wallet,
} from "./intent";
import type { AsyncCashier, AsyncRisk, Cashier, RiskAssessment, RiskRequest, SyncRisk } from "./ports";
import { findAnswer, summarize } from "./kb";
import { createLocalRisk } from "./riskLocal";
import type { Operation, Pending, Session, Store } from "./store";
import { formatXof } from "./text";

/** Nature d'une réponse, pour que l'écran choisisse son apparence sans deviner d'après le texte. */
export type Tone = "ask" | "verify" | "success" | "refusal" | "info";

export interface TurnResult {
  /** Texte affiché (montants en chiffres). */
  reply: string;
  /** Texte prononcé (montants en lettres). */
  speech: string;
  awaitingConfirm: boolean;
  /** `ask` : confirmation simple. `verify` : doute d'Argus. `success` : fait. `refusal` : refus. `info` : le reste. */
  tone?: Tone;
  /** D'où vient une réponse du support (règle RG-23 : toute réponse du support cite sa source). */
  source?: string;
  /** `url` : le lien de paiement du client (caisse réelle). */
  payment?: { id: string; amount: number; wallet?: Wallet; url?: string };
}

/**
 * Garde optionnel appelé à chaque phrase, AVANT toute interprétation. `operation` est l'opération en attente de
 * confirmation, s'il y en a une. S'il renvoie un résultat, le dialogue s'arrête là et la commande en cours est
 * abandonnée : c'est l'emplacement de la phrase de contrainte.
 */
export type TurnGuard = (text: string, operation: Operation | undefined) => TurnResult | undefined;

export interface DialogDeps {
  store: Store;
  cashier: Cashier | AsyncCashier;
  guard?: TurnGuard;
  /** Moteur de risque. Par défaut : le calcul local. */
  risk?: SyncRisk | AsyncRisk;
}

export interface SyncDialog {
  handleTurn(sessionId: string, text: string): TurnResult;
}

export interface AsyncDialog {
  handleTurn(sessionId: string, text: string): Promise<TurnResult>;
}

/** Un dialogue dont on ne sait pas s'il est synchrone : les routes attendent le résultat dans les deux cas. */
export interface AnyDialog {
  handleTurn(sessionId: string, text: string): TurnResult | Promise<TurnResult>;
}

export type Dialog = AnyDialog;

/** Plus petit montant accepté (minimum Mobile Money de Jèko, d'après le guide). */
export const MIN_AMOUNT = 5;

type Maybe<T> = T | Promise<T>;

const isThenable = (value: unknown): value is Promise<unknown> =>
  typeof (value as { then?: unknown } | null | undefined)?.then === "function";

/** Applique `next` au résultat, tout de suite s'il est déjà là, ou une fois qu'il arrive. */
function chain<T, U>(value: Maybe<T>, next: (v: T) => Maybe<U>): Maybe<U> {
  return isThenable(value) ? (value as Promise<T>).then(next) : next(value as T);
}

// ---------------------------------------------------------------------------
// Construction des réponses : le montant s'écrit en chiffres à l'écran et en lettres à la voix.
// Seules les valeurs `amt(...)` sont des montants : un nom de bénéficiaire reste du texte.
// ---------------------------------------------------------------------------

class Amount {
  constructor(readonly value: number) {}
}
const amt = (n: number) => new Amount(n);

interface Line {
  reply: string;
  speech: string;
}

function line(strings: TemplateStringsArray, ...values: Array<string | Amount>): Line {
  let reply = strings[0];
  let speech = strings[0];
  values.forEach((v, i) => {
    reply += v instanceof Amount ? formatXof(v.value) : v;
    speech += v instanceof Amount ? toFrenchWords(v.value) : v;
    reply += strings[i + 1];
    speech += strings[i + 1];
  });
  return { reply, speech };
}

const turn = (l: Line, awaitingConfirm = false, payment?: TurnResult["payment"], tone?: Tone): TurnResult => {
  const result: TurnResult = {
    reply: l.reply, speech: l.speech, awaitingConfirm, tone: tone ?? (awaitingConfirm ? "ask" : "info"),
  };
  if (payment) result.payment = payment;
  return result;
};

const plain = (text: string, awaitingConfirm = false, tone?: Tone) =>
  turn({ reply: text, speech: text }, awaitingConfirm, undefined, tone);

const REASON: Record<string, string> = {
  new_beneficiary: "c'est un nouveau numéro pour toi",
  amount_ratio: "c'est beaucoup plus que d'habitude",
  ceiling: "ça dépasse ton plafond",
  night: "il est tard",
  velocity: "il y a eu plusieurs opérations en peu de temps",
};

/** La raison du doute, dite à voix haute avant de demander le oui : celle d'Argus si elle existe, sinon les deux plus lourdes. */
function spokenReason(a: RiskAssessment): string {
  const reason = a.decisionReason?.trim();
  if (reason) return /[.!?]$/.test(reason) ? reason : `${reason}.`;
  const parts = a.factors
    .filter((f) => f.id !== "outbound")
    .sort((x, y) => y.points - x.points)
    .slice(0, 2)
    .map((f) => REASON[f.id] ?? f.label.toLowerCase())
    .filter(Boolean);
  if (!parts.length) return "Je préfère vérifier avec toi.";
  const sentence = parts.join(" et ");
  return `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}.`;
}

const who = (p: { beneficiary?: string; phone?: string }) => p.beneficiary ?? (p.phone ? formatPhone(p.phone) : "ce numéro");
const via = (wallet?: Wallet) => (wallet ? ` par ${WALLET_LABEL[wallet]}` : "");

/**
 * La réponse d'un succès. Elle sert à l'exécution normale ET à la contrainte : les deux sont donc
 * identiques par construction, et l'agresseur ne peut rien voir de différent.
 */
export function successTurn(op: Operation, paymentId = "", payUrl?: string): TurnResult {
  if (op.kind === "collect") {
    const payment: NonNullable<TurnResult["payment"]> = { id: paymentId, amount: op.amount };
    if (op.wallet) payment.wallet = op.wallet;
    if (payUrl) payment.url = payUrl;
    return turn(line`C'est lancé. Le client peut scanner et payer.`, false, payment, "success");
  }
  return turn(line`C'est envoyé. ${amt(op.amount)} francs à ${who(op)}.`, false, undefined, "success");
}

const NOTHING_TO_CONFIRM = "Il n'y a rien à confirmer pour le moment.";
const ASK_YES_NO = "Dis oui pour confirmer, ou non pour annuler.";

/** L'annonce vocale de la JèkoBox, dite seulement après vérification du webhook de paiement. */
export function paymentReceivedTurn(op: Operation): TurnResult {
  return turn(line`Paiement reçu. ${amt(op.amount)} francs${via(op.wallet)}.`, false, undefined, "success");
}

// ---------------------------------------------------------------------------

export function createDialog(deps: Omit<DialogDeps, "risk" | "cashier"> & { cashier: Cashier; risk?: SyncRisk }): SyncDialog;
export function createDialog(deps: Omit<DialogDeps, "risk" | "cashier"> & { cashier: Cashier | AsyncCashier; risk: AsyncRisk }): AsyncDialog;
export function createDialog(deps: Omit<DialogDeps, "risk" | "cashier"> & { cashier: AsyncCashier; risk?: SyncRisk | AsyncRisk }): AsyncDialog;
export function createDialog(deps: DialogDeps): AnyDialog;
export function createDialog(deps: DialogDeps): AnyDialog {
  const { store, cashier } = deps;
  const risk: SyncRisk | AsyncRisk = deps.risk ?? createLocalRisk();

  const clear = (s: Session) => {
    s.pending = undefined;
  };

  const cancelOperation = (op: Operation | undefined) => {
    if (op && op.status === "to_confirm") store.updateOperation(op.id, { status: "cancelled" });
  };

  // --- Début d'une commande -------------------------------------------------

  function startCommand(s: Session, intent: Intent): Maybe<TurnResult> {
    const p: Pending = {
      stage: "need_amount",
      kind: intent.kind === "send" ? "send" : "collect",
      amount: intent.amount,
      wallet: intent.wallet,
      beneficiary: intent.beneficiary,
      phone: intent.phone,
    };
    return advance(s, p);
  }

  function advance(s: Session, p: Pending): Maybe<TurnResult> {
    if (p.amount === undefined) {
      p.stage = "need_amount";
      s.pending = p;
      return plain(p.kind === "send" ? "Quel montant veux-tu envoyer ?" : "Quel montant veux-tu encaisser ?");
    }
    if (p.amount < MIN_AMOUNT) {
      p.amount = undefined;
      p.stage = "need_amount";
      s.pending = p;
      return turn(line`Le minimum est de ${amt(MIN_AMOUNT)} francs. Quel montant veux-tu ?`);
    }
    if (p.kind === "send" && !p.beneficiary && !p.phone) {
      p.stage = "need_beneficiary";
      s.pending = p;
      return plain("À qui veux-tu l'envoyer ?");
    }
    return evaluate(s, p);
  }

  // --- Examen par le moteur de risque, puis relecture -----------------------

  function evaluate(s: Session, p: Pending): Maybe<TurnResult> {
    const amount = p.amount as number;
    const config = getConfig();
    const now = store.now();

    if (p.kind === "collect" && amount > config.ceilingXof) {
      clear(s);
      return turn(line`Ce montant dépasse ton plafond de ${amt(config.ceilingXof)} francs. Un conseiller Jèko peut t'expliquer comment le relever.`, false, undefined, "refusal");
    }

    const request: RiskRequest = {
      kind: p.kind,
      amount,
      beneficiaryAccount: store.accountFor({ name: p.beneficiary, phone: p.phone }),
      beneficiaryKnown: p.kind === "send" ? store.isKnownContact({ name: p.beneficiary, phone: p.phone }) : true,
      avgTicket: store.avgTicket(),
      previousOps: store.previousOps(now),
      now,
    };
    return chain<RiskAssessment, TurnResult>(risk.assess(request), (assessment) => conclude(s, p, assessment));
  }

  /** La suite de l'examen : refuser, ou relire le montant et demander confirmation. */
  function conclude(s: Session, p: Pending, a: RiskAssessment): TurnResult {
    const amount = p.amount as number;
    const base = {
      kind: p.kind,
      amount,
      wallet: p.wallet,
      beneficiary: p.beneficiary,
      phone: p.phone,
      score: a.score,
      decision: a.decision,
      factors: a.factors,
      verifiedByVoice: false,
      riskSource: a.source,
      ...(a.modelVersion ? { modelVersion: a.modelVersion } : {}),
      ...(a.degraded ? { degraded: true } : {}),
    };

    if (a.decision === "block") {
      const op = store.addOperation({ ...base, status: "blocked" });
      store.addAlert({
        level: "warning",
        type: "blocked",
        title: "Opération bloquée : rappel à faire",
        detail: `${p.kind === "send" ? "Transfert" : "Encaissement"} de ${formatXof(amount)} FCFA${p.kind === "send" ? ` vers ${who(p)}` : ""} refusé. Un conseiller doit rappeler le marchand.`,
        operationId: op.id,
        score: a.score,
        factors: a.factors,
      });
      clear(s);
      return plain("Je ne peux pas faire ça maintenant, pour ta sécurité. Un conseiller Jèko va te rappeler.", false, "refusal");
    }

    const op = store.addOperation({ ...base, status: "to_confirm" });
    p.stage = "confirm";
    p.operationId = op.id;
    s.pending = p;

    const lead = a.decision === "verify" ? `Attention. ${spokenReason(a)} ` : "";
    const tone: Tone = a.decision === "verify" ? "verify" : "ask";
    if (p.kind === "collect") {
      return turn(line`${lead}Tu veux encaisser ${amt(amount)} francs${via(p.wallet)}. Tu confirmes ?`, true, undefined, tone);
    }
    const ask = a.decision === "verify" ? "C'est bien toi qui décides ?" : "Tu confirmes ?";
    return turn(line`${lead}Tu envoies ${amt(amount)} francs${via(p.wallet)} à ${who(p)}. ${ask}`, true, undefined, tone);
  }

  // --- Exécution : seulement après un oui ------------------------------------

  function fail(op: Operation): TurnResult {
    store.updateOperation(op.id, { status: "failed" });
    store.addAlert({
      level: "warning",
      type: "failed",
      title: "Échec de l'exécution",
      detail: `La caisse n'a pas pu traiter ${op.kind === "send" ? "le transfert" : "l'encaissement"} de ${formatXof(op.amount)} FCFA.`,
      operationId: op.id,
      score: op.score,
      factors: op.factors,
    });
    return plain("Je n'ai pas pu faire l'opération. Réessaie dans un instant.", false, "refusal");
  }

  function execute(s: Session, op: Operation): Maybe<TurnResult> {
    clear(s);
    if (op.status !== "to_confirm") return plain(NOTHING_TO_CONFIRM);

    let launched: Maybe<{ id: string; payUrl?: string }>;
    try {
      launched =
        op.kind === "collect"
          ? cashier.createPaymentRequest({ amount: op.amount, wallet: op.wallet })
          : cashier.createTransfer({ amount: op.amount, to: op.beneficiary ?? op.phone ?? "inconnu" });
    } catch {
      return fail(op);
    }
    const done = (result: { id: string; payUrl?: string }) => finish(op, result);
    return isThenable(launched) ? launched.then(done, () => fail(op)) : done(launched);
  }

  /** La caisse a accepté : on enregistre et on répond. */
  function finish(op: Operation, launched: { id: string; payUrl?: string }): TurnResult {
    if (op.kind === "collect") {
      store.updateOperation(op.id, { status: "awaiting_payment", paymentId: launched.id });
      return successTurn(op, launched.id, launched.payUrl);
    }

    const verified = op.decision === "verify";
    store.updateOperation(op.id, { status: "executed", verifiedByVoice: verified });
    if (verified) {
      store.addAlert({
        level: "info",
        type: "verified",
        title: "Transfert vérifié par la voix",
        detail: `${formatXof(op.amount)} FCFA vers ${who(op)}. Le marchand a confirmé après la question de vérification.`,
        operationId: op.id,
        score: op.score,
        factors: op.factors,
      });
    }
    return successTurn(op);
  }

  // --- Les trois situations d'une session ------------------------------------

  function handleConfirm(s: Session, p: Pending, text: string): Maybe<TurnResult> {
    const op = store.getOperation(p.operationId);
    if (!op) {
      clear(s);
      return plain(NOTHING_TO_CONFIRM);
    }

    // Une nouvelle commande complète remplace la précédente ; elle repasse par une relecture.
    const intent = parseIntent(text);
    if ((intent.kind === "collect" || intent.kind === "send") && intent.amount !== undefined) {
      cancelOperation(op);
      clear(s);
      return startCommand(s, intent);
    }

    if (isNo(text)) {
      cancelOperation(op);
      clear(s);
      return plain("D'accord, j'annule.");
    }

    // « oui, envoie » confirme ; « oui, encaisse » alors qu'on parle d'un envoi ne confirme rien.
    const contradicts = (intent.kind === "collect" || intent.kind === "send") && intent.kind !== p.kind;
    if (isYes(text) && !contradicts) return execute(s, op);

    return plain(ASK_YES_NO, true);
  }

  function handleMissing(s: Session, p: Pending, text: string): Maybe<TurnResult> {
    const intent = parseIntent(text);

    // Un montant a été compris mais pas le verbe : « encaisser » ou « envoyer » complète la commande, le montant est gardé.
    if (p.stage === "need_kind") {
      if ((intent.kind === "collect" || intent.kind === "send") && intent.amount !== undefined) return startCommand(s, intent);
      if (isNo(text)) {
        clear(s);
        return plain("D'accord, j'annule.");
      }
      const kind = kindFrom(text);
      if (!kind) return plain("Dis encaisser ou envoyer.");
      p.kind = kind;
      p.wallet = p.wallet ?? extractWallet(text);
      return advance(s, p);
    }

    if (intent.kind === "collect" || intent.kind === "send") return startCommand(s, intent);

    if (isNo(text)) {
      clear(s);
      return plain("D'accord, j'annule.");
    }

    if (p.stage === "need_amount") {
      const amount = parseAmount(text);
      if (amount === undefined) return plain("Je n'ai pas compris le montant. Par exemple : cinq mille francs.");
      p.amount = amount;
      p.wallet = p.wallet ?? extractWallet(text);
      return advance(s, p);
    }

    const phone = extractPhone(text);
    const name = extractBeneficiary(text, { bare: true });
    if (!phone && !name) return plain("Je n'ai pas compris à qui. Dis un nom ou un numéro.");
    p.phone = phone ?? p.phone;
    p.beneficiary = name ?? p.beneficiary;
    return advance(s, p);
  }

  /** Une question d'assistance : réponse sourcée de la base, ou passage à un conseiller avec un résumé (RG-23). */
  function supportTurn(question: string): TurnResult {
    const found = findAnswer(question);
    if (found) {
      const { entry } = found;
      if (entry.handoff) handOff(question, `Réponse partielle donnée (${entry.id}).`);
      return { reply: entry.reply, speech: entry.speech, awaitingConfirm: false, tone: "info", source: entry.source };
    }
    handOff(question, "Hors de la base du support.");
    const reply = "Je n'ai pas la réponse à ça. Je passe ta question à un conseiller Jèko, qui te répondra.";
    return { reply, speech: reply, awaitingConfirm: false, tone: "info" };
  }

  function handOff(question: string, why: string) {
    store.addAlert({
      level: "info",
      type: "handoff",
      title: "Question passée à un conseiller",
      detail: `Le marchand a demandé : « ${summarize(question)} ». ${why} Un conseiller doit lui répondre.`,
    });
  }

  function handleIdle(s: Session, text: string): Maybe<TurnResult> {
    const intent = parseIntent(text);
    switch (intent.kind) {
      case "collect":
      case "send":
        return startCommand(s, intent);
      case "summary": {
        const { total, count } = store.paidToday(store.now());
        if (!count) return plain("Tu n'as encore rien encaissé aujourd'hui.");
        return turn(line`Aujourd'hui, tu as encaissé ${amt(total)} francs, en ${amt(count)} paiement${count > 1 ? "s" : ""}.`);
      }
      case "support":
        return supportTurn(text);
      case "amount": {
        // Le verbe n'a pas été compris (« on voit cinq mille francs ») : on garde le montant et on demande, sans rien deviner.
        const p: Pending = { stage: "need_kind", kind: "collect", amount: intent.amount, wallet: intent.wallet };
        s.pending = p;
        return turn(line`Tu veux encaisser ou envoyer ${amt(intent.amount as number)} francs${via(intent.wallet)} ?`);
      }
      default:
        if (isYes(text) || isNo(text)) return plain(NOTHING_TO_CONFIRM);
        return plain("Je n'ai pas bien compris. Tu peux dire par exemple : encaisse cinq mille francs, ou : combien j'ai encaissé aujourd'hui ?");
    }
  }

  function runTurn(sessionId: string, rawText: string): Maybe<TurnResult> {
    const s = store.getSession(sessionId);
    const text = rawText.trim();
    if (!text) return plain("Je n'ai pas entendu. Tu peux répéter ?", s.pending?.stage === "confirm");
    const awaiting = s.pending?.stage === "confirm" ? store.getOperation(s.pending.operationId) : undefined;
    const guarded = deps.guard?.(text, awaiting);
    if (guarded) {
      clear(s);
      return guarded;
    }
    if (s.pending?.stage === "confirm") return handleConfirm(s, s.pending, text);
    if (s.pending) return handleMissing(s, s.pending, text);
    return handleIdle(s, text);
  }

  // Avec Argus ou la vraie caisse Jèko (réseau), les tours d'une même session s'enchaînent : le suivant attend la fin du précédent.
  const isAsync = risk.async === true || cashier.async === true;
  const tails = new Map<string, Promise<void>>();

  return {
    handleTurn(sessionId: string, rawText: string): TurnResult | Promise<TurnResult> {
      if (!isAsync) return runTurn(sessionId, rawText) as TurnResult;
      const previous = tails.get(sessionId) ?? Promise.resolve();
      const result = previous.then(() => runTurn(sessionId, rawText));
      const settled = result.then(
        () => undefined,
        () => undefined,
      );
      tails.set(sessionId, settled);
      void settled.then(() => {
        if (tails.get(sessionId) === settled) tails.delete(sessionId);
      });
      return result;
    },
  };
}
