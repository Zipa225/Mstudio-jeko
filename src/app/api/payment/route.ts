import { guarded, json } from "../../../lib/http";
import { paymentReceivedTurn } from "../../../lib/dialog";
import { getRuntime } from "../../../lib/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Où en est un paiement ? GET /api/payment?id=<référence>. La page de la vendeuse l'interroge après un encaissement
 * lancé avec la vraie caisse : { status: "waiting" } tant que le webhook signé de Jèko n'est pas arrivé, puis
 * { status: "paid", reply, speech, ... } (l'annonce « Paiement reçu »). Le statut « payé » n'existe que si le webhook a
 * été vérifié (signature, montant, référence) : cette route ne fait que le relire. Un identifiant inconnu, ou celui d'une
 * opération retenue sous contrainte, répond « waiting » comme les autres : rien n'est révélé.
 */
export async function GET(req: Request) {
  return guarded(() => {
    const id = new URL(req.url).searchParams.get("id") ?? "";
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) return json({ error: "invalid_payment" }, 400);

    const rt = getRuntime();
    const op = rt.store.operations.find((o) => o.kind === "collect" && o.paymentId === id);
    if (op?.status !== "paid") return json({ status: "waiting" });

    const announcement = paymentReceivedTurn(op);
    rt.allowSpeech(announcement.speech);
    return json({ status: "paid", ...announcement });
  });
}
