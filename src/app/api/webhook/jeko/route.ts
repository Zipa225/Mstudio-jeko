import { guarded, json, readText } from "../../../../lib/http";
import { getRuntime } from "../../../../lib/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Récepteur du webhook Jèko TRANSACTION_COMPLETED. Le corps est lu tel quel, car c'est lui qui est signé.
 * La signature (Jeko-Signature) est vérifiée avant toute autre chose.
 */
export async function POST(req: Request) {
  return guarded(async () => {
    const body = await readText(req, 65_536);
    if (!body.ok) return body.response;

    const headers = Object.fromEntries(req.headers.entries());
    const outcome = getRuntime().receive({ rawBody: body.data, headers });
    if (!outcome.ok) return json({ ok: false, reason: outcome.reason }, outcome.status);
    return json({ ok: true, duplicate: outcome.duplicate });
  });
}
