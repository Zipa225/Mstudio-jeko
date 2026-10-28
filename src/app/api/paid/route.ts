import { guarded, json, readJson } from "../../../lib/http";
import { JekoApiError } from "../../../lib/jekoMock";
import { getRuntime } from "../../../lib/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Simule le client qui paie (démonstration seulement). La fausse caisse fabrique le webhook signé, le récepteur le
 * vérifie, et seulement alors l'annonce « Paiement reçu » est renvoyée pour être dite par la voix.
 */
export async function POST(req: Request) {
  return guarded(async () => {
    const rt = getRuntime();
    if (!rt.demoMode) return json({ error: "demo_only" }, 403);
    // Avec la vraie caisse, c'est le client qui paie pour de vrai : le webhook de Jèko fait foi, jamais ce bouton.
    if (rt.cashierMode === "live") return json({ error: "live_mode" }, 409);

    const body = await readJson(req);
    if (!body.ok) return body.response;
    const { paymentId } = body.data;
    if (typeof paymentId !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(paymentId)) return json({ error: "invalid_payment" }, 400);

    let delivery;
    try {
      delivery = rt.mock.simulateClientPayment(paymentId);
    } catch (e) {
      if (e instanceof JekoApiError && e.code === "already_paid") return json({ error: "already_paid" }, 409);
      if (e instanceof JekoApiError) return json({ error: "unknown_payment" }, 404);
      throw e;
    }

    const outcome = rt.receive(delivery);
    if (!outcome.ok) return json({ error: outcome.reason }, outcome.status);
    if (!outcome.announcement) return json({ ok: true, duplicate: true });
    rt.allowSpeech(outcome.announcement.speech);
    return json({ ok: true, ...outcome.announcement });
  });
}
