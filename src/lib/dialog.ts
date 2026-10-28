// Le dialogue du marchand : une phrase entre, une réponse sort.
// Flux : intention, montant et bénéficiaire, score Argus, relecture et confirmation, exécution.
// Règle d'or : aucune opération d'argent sans relecture du montant ET « oui » explicite du marchand.

import { getConfig } from "./config";
import { parseAmount, toFrenchWords } from "./frenchNumbers";
import {
  extractBeneficiary, extractPhone, extractWallet, formatPhone, isNo, isYes, parseIntent, WALLET_LABEL, type Intent, type Wallet,
} from "./intent";
import type { Cashier } from "./ports";
import { scoreRisk, type FactorId, type RiskResult } from "./risk";
import type { Operation, Pending, Session, Store } from "./store";
import { formatXof } from "./text";

export interface TurnResult {
  /** Texte affiché (montants en chiffres). */
  reply: string;
  /** Texte prononcé (montants en lettres). */
  speech: string;
  awaitingConfirm: boolean;
  payment?: { id: string; amount: number; wallet?: Wallet };
}

/**
 * Garde optionnel appelé à l'étape de confirmation, AVANT de lire le oui ou le non.
 * S'il renvoie un résultat, le dialogue s'arrête là : c'est l'emplacement de la phrase de contrainte.
 */
export type ConfirmationGuard = (text: string, operation: Operation) => TurnResult | undefined;

export interface DialogDeps {
  store: Store;
  cashier: Cashier;
  guard?: ConfirmationGuard;
}

export interface Dialog {
  handleTurn(sessionId: string, text: string): TurnResult;
}

/** Plus petit montant accepté (minimum Mobile Money de Jèko, d'après le guide). */
export const MIN_AMOUNT = 5;

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

const turn = (l: Line, awaitingConfirm = false, payment?: TurnResult["payment"]): TurnResult => {
  const result: TurnResult = { reply: l.reply, speech: l.speech, awaitingConfirm };
  if (payment) result.payment = payment;
  return result;
};

const plain = (text: string, awaitingConfirm = false) => turn({ reply: text, speech: text }, awaitingConfirm);

const REASON: Partial<Record<FactorId, string>> = {
  new_beneficiary: "c'est un nouveau numéro pour toi",
  amount_ratio: "c'est beaucoup plus que d'habitude",
  ceiling: "ça dépasse ton plafond",
  night: "il est tard",
  velocity: "il y a eu plusieurs opérations en peu de temps",
};

/** Les deux raisons les plus lourdes, dites à voix haute avant de demander le oui. */
function spokenReason(risk: RiskResult): string {
  const parts = risk.factors
    .filter((f) => f.id !== "outbound")
    .sort((a, b) => b.points - a.points)
    .slice(0, 2)
    .map((f) => REASON[f.id])
    .filter((r): r is string => Boolean(r));
  if (!parts.length) return "Je préfère vérifier avec toi.";
  const sentence = parts.join(" et ");
  return `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}.`;
}

const who = (p: { beneficiary?: string; phone?: string }) => p.beneficiary ?? (p.phone ? formatPhone(p.phone) : "ce numéro");
const via = (wallet?: Wallet) => (wallet ? ` par ${WALLET_LABEL[wallet]}` : "");

const NOTHING_TO_CONFIRM = "Il n'y a rien à confirmer pour le moment.";
const ASK_YES_NO = "Dis oui pour confirmer, ou non pour annuler.";

// ---------------------------------------------------------------------------

export function createDialog(deps: DialogDeps): Dialog {
  const { store, cashier } = deps;

  const clear = (s: Session) => {
    s.pending = undefined;
  };

  const cancelOperation = (op: Operation | undefined) => {
    if (op && op.status === "to_confirm") store.updateOperation(op.id, { status: "cancelled" });
  };

  // --- Début d'une commande -------------------------------------------------

  function startCommand(s: Session, intent: Intent): TurnResult {
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

  function advance(s: Session, p: Pending): TurnResult {
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

  // --- Évaluation par Argus, puis relecture ---------------------------------

  function evaluate(s: Session, p: Pending): TurnResult {
    const amount = p.amount as number;
    const config = getConfig();
    const now = store.now();

    if (p.kind === "collect" && amount > config.ceilingXof) {
      clear(s);
      return turn(line`Ce montant dépasse ton plafond de ${amt(config.ceilingXof)} francs. Un conseiller Jèko peut t'expliquer comment le relever.`);
    }

    const risk = scoreRisk(
      {
        kind: p.kind,
        amount,
        beneficiaryKnown: p.kind === "send" ? store.isKnownContact({ name: p.beneficiary, phone: p.phone }) : true,
        avgTicket: store.avgTicket(),
        previousOps: store.previousOps(now),
        now,
      },
      config,
    );

    const base = {
      kind: p.kind,
      amount,
      wallet: p.wallet,
      beneficiary: p.beneficiary,
      phone: p.phone,
      score: risk.score,
      decision: risk.decision,
      factors: risk.factors,
      verifiedByVoice: false,
    };

    if (risk.decision === "block") {
      const op = store.addOperation({ ...base, status: "blocked" });
      store.addAlert({
        level: "warning",
        type: "blocked",
        title: "Opération bloquée : rappel à faire",
        detail: `${p.kind === "send" ? "Transfert" : "Encaissement"} de ${formatXof(amount)} FCFA${p.kind === "send" ? ` vers ${who(p)}` : ""} refusé. Un conseiller doit rappeler le marchand.`,
        operationId: op.id,
        score: risk.score,
        factors: risk.factors,
      });
      clear(s);
      return plain("Je ne peux pas faire ça maintenant, pour ta sécurité. Un conseiller Jèko va te rappeler.");
    }

    const op = store.addOperation({ ...base, status: "to_confirm" });
    p.stage = "confirm";
    p.operationId = op.id;
    s.pending = p;

    const lead = risk.decision === "verify" ? `Attention. ${spokenReason(risk)} ` : "";
    if (p.kind === "collect") return turn(line`${lead}Tu veux encaisser ${amt(amount)} francs${via(p.wallet)}. Tu confirmes ?`, true);
    const ask = risk.decision === "verify" ? "C'est bien toi qui décides ?" : "Tu confirmes ?";
    return turn(line`${lead}Tu envoies ${amt(amount)} francs${via(p.wallet)} à ${who(p)}. ${ask}`, true);
  }

  // --- Exécution : seulement après un oui ------------------------------------

  function execute(s: Session, op: Operation): TurnResult {
    clear(s);
    if (op.status !== "to_confirm") return plain(NOTHING_TO_CONFIRM);

    try {
      if (op.kind === "collect") {
        const req = cashier.createPaymentRequest({ amount: op.amount, wallet: op.wallet });
        store.updateOperation(op.id, { status: "awaiting_payment", paymentId: req.id });
        return turn(
          line`C'est lancé. Le client peut scanner et payer.`,
          false,
          op.wallet ? { id: req.id, amount: op.amount, wallet: op.wallet } : { id: req.id, amount: op.amount },
        );
      }
      cashier.createTransfer({ amount: op.amount, to: op.beneficiary ?? op.phone ?? "inconnu" });
    } catch {
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
      return plain("Je n'ai pas pu faire l'opération. Réessaie dans un instant.");
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
    return turn(line`C'est envoyé. ${amt(op.amount)} francs à ${who(op)}.`);
  }

  // --- Les trois situations d'une session ------------------------------------

  function handleConfirm(s: Session, p: Pending, text: string): TurnResult {
    const op = store.getOperation(p.operationId);
    if (!op) {
      clear(s);
      return plain(NOTHING_TO_CONFIRM);
    }

    const guarded = deps.guard?.(text, op);
    if (guarded) {
      clear(s);
      return guarded;
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

  function handleMissing(s: Session, p: Pending, text: string): TurnResult {
    const intent = parseIntent(text);
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

  function handleIdle(s: Session, text: string): TurnResult {
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
        // Provisoire : la base de réponses sourcées arrive avec feature/support-prospects.
        return plain("Je n'ai pas la réponse à ça. Un conseiller Jèko peut t'aider dans l'application.");
      default:
        if (isYes(text) || isNo(text)) return plain(NOTHING_TO_CONFIRM);
        return plain("Je n'ai pas bien compris. Tu peux dire par exemple : encaisse cinq mille francs, ou : combien j'ai encaissé aujourd'hui ?");
    }
  }

  return {
    handleTurn(sessionId: string, rawText: string): TurnResult {
      const s = store.getSession(sessionId);
      const text = rawText.trim();
      if (!text) return plain("Je n'ai pas entendu. Tu peux répéter ?", s.pending?.stage === "confirm");
      if (s.pending?.stage === "confirm") return handleConfirm(s, s.pending, text);
      if (s.pending) return handleMissing(s, s.pending, text);
      return handleIdle(s, text);
    },
  };
}
