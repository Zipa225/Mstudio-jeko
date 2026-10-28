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
      /** `api` : Argus examine les opérations. `local` : calcul local de secours (Argus non configuré). */
      argus: rt.riskMode,
      /** `aethex` : la voix vient d'AethexAI (clé configurée). `browser` : voix du navigateur en secours. */
      voice: rt.voiceMode,
      demoMode: rt.demoMode,
    });
  });
}
