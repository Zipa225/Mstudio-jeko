import { duressStatus } from "../../../lib/duress";
import { getConfig } from "../../../lib/config";
import { guarded, json } from "../../../lib/http";
import { getRuntime } from "../../../lib/runtime";
import type { OperationStatus } from "../../../lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATUSES: OperationStatus[] = [
  "to_confirm", "awaiting_payment", "paid", "executed", "cancelled", "held", "blocked", "failed",
];

/** Le plus récent d'abord ; à horodatage égal, le dernier ajouté d'abord. */
const newestFirst = <T extends { ts: number }>(items: T[]): T[] =>
  items.map((item, i) => ({ item, i })).sort((a, b) => b.item.ts - a.item.ts || b.i - a.i).map((x) => x.item);

/** L'état pour l'écran analyste. Ne contient ni clé, ni phrase secrète : seulement l'état de la détection. */
export async function GET() {
  return guarded(() => {
    const rt = getRuntime();
    const { store } = rt;
    const config = getConfig();
    const counts = Object.fromEntries(STATUSES.map((s) => [s, 0])) as Record<OperationStatus, number>;
    for (const op of store.operations) counts[op.status]++;

    return json({
      now: store.now().getTime(),
      merchant: { name: store.merchant.name, shop: store.merchant.shop },
      thresholds: config.thresholds,
      ceiling: config.ceilingXof,
      duress: duressStatus(rt.getPhrase()),
      demoMode: rt.demoMode,
      counts,
      criticalAlerts: store.alerts.filter((a) => a.level === "critical").length,
      operations: newestFirst(store.operations).slice(0, 40),
      alerts: newestFirst(store.alerts).slice(0, 20),
    });
  });
}
