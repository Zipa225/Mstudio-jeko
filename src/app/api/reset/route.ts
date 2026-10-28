import { guarded, json } from "../../../lib/http";
import { getRuntime, resetRuntime } from "../../../lib/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Remet la démonstration à zéro. Réservé au mode démonstration : en usage réel, la route refuse. */
export async function POST() {
  return guarded(() => {
    if (!getRuntime().demoMode) return json({ error: "demo_only" }, 403);
    resetRuntime();
    return json({ ok: true });
  });
}
