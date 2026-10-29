// L'historique tel que la commerçante le voit : une liste d'opérations avec un statut en mots simples.
// Il ne montre ni score ni raison (c'est l'écran de l'analyste) et ne trahit jamais une contrainte : une opération
// « retenue » par la phrase secrète s'affiche comme un succès, exactement comme l'écran qu'elle a vu sur le moment.

import { formatPhone, WALLET_LABEL, type Wallet } from "./intent";
import { KYC_MAX_ATTEMPTS } from "./kyc";
import type { Operation, OperationStatus, Store } from "./store";

export type HistoryState = "done" | "waiting" | "to_confirm" | "cancelled" | "blocked" | "failed";

export interface HistoryItem {
  id: string;
  ts: number;
  kind: "collect" | "send";
  amount: number;
  wallet?: Wallet;
  /** Pour un envoi : le bénéficiaire. */
  who?: string;
  state: HistoryState;
  label: string;
  /** Vrai si la commerçante peut encore tenter de débloquer l'opération. */
  unlockable: boolean;
}

/** Le statut montré à la commerçante. `held` (contrainte) se fait passer pour la suite normale d'un succès. */
export function merchantState(op: Pick<Operation, "kind" | "status">): { state: HistoryState; label: string } {
  const status: OperationStatus = op.status;
  switch (status) {
    case "paid":
      return { state: "done", label: "Payé" };
    case "executed":
      return { state: "done", label: "Envoyé" };
    case "awaiting_payment":
      return { state: "waiting", label: "En attente du client" };
    case "held":
      return op.kind === "send" ? { state: "done", label: "Envoyé" } : { state: "waiting", label: "En attente du client" };
    case "to_confirm":
      return { state: "to_confirm", label: "À confirmer" };
    case "cancelled":
      return { state: "cancelled", label: "Annulée" };
    case "blocked":
      return { state: "blocked", label: "Bloquée" };
    case "failed":
      return { state: "failed", label: "Échouée" };
  }
}

/** Les opérations les plus récentes d'abord ; à horodatage égal, la dernière ajoutée d'abord. */
export function buildHistory(store: Store, limit = 10): HistoryItem[] {
  return store.operations
    .map((op, i) => ({ op, i }))
    .sort((a, b) => b.op.ts - a.op.ts || b.i - a.i)
    .slice(0, limit)
    .map(({ op }) => {
      const { state, label } = merchantState(op);
      const item: HistoryItem = {
        id: op.id,
        ts: op.ts,
        kind: op.kind,
        amount: op.amount,
        state,
        label,
        unlockable: state === "blocked" && (op.kycAttempts ?? 0) < KYC_MAX_ATTEMPTS,
      };
      if (op.wallet) item.wallet = op.wallet;
      if (op.kind === "send") item.who = op.beneficiary ?? (op.phone ? formatPhone(op.phone) : undefined);
      return item;
    });
}

export const walletLabel = (wallet: Wallet | undefined): string | undefined => (wallet ? WALLET_LABEL[wallet] : undefined);
