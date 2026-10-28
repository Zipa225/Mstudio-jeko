// Contrats entre le dialogue et le monde extérieur. Le dialogue ne connaît pas la fausse caisse :
// on la lui injecte, ce qui permet de vérifier en test qu'elle n'est appelée qu'après un « oui ».

import type { Wallet } from "./intent";

export interface Cashier {
  /** Lance une demande de paiement (encaissement). Le montant est en FCFA. */
  createPaymentRequest(args: { amount: number; wallet?: Wallet }): { id: string };
  /** Lance un transfert sortant. Le montant est en FCFA. */
  createTransfer(args: { amount: number; to: string }): { id: string };
}
