import { getConfig } from "../../../lib/config";
import { duressStatus } from "../../../lib/duress";
import { guarded, json } from "../../../lib/http";
import { getRuntime } from "../../../lib/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** État de santé. Indique ce qui est configuré, jamais les valeurs : ni clé AethexAI, ni phrase secrète. */
export async function GET() {
  return guarded(() => {
    const rt = getRuntime();
    return json({
      ok: true,
      aethex: getConfig().aethex.configured,
      duress: duressStatus(rt.getPhrase()),
      demoMode: rt.demoMode,
    });
  });
}
