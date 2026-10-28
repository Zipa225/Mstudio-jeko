// Moteur de risque local : le score « Argus simplifié » à six critères (risk.ts), derrière l'interface commune.
// Il sert de moteur par défaut, et de secours quand l'API Argus est injoignable.

import { getConfig } from "./config";
import type { RiskAssessment, RiskRequest, SyncRisk } from "./ports";
import { scoreRisk, type RiskSettings } from "./risk";

export function createLocalRisk(settings: () => RiskSettings = getConfig): SyncRisk {
  return {
    assess(request: RiskRequest): RiskAssessment {
      const result = scoreRisk(
        {
          kind: request.kind,
          amount: request.amount,
          beneficiaryKnown: request.beneficiaryKnown,
          avgTicket: request.avgTicket,
          previousOps: request.previousOps,
          now: request.now,
        },
        settings(),
      );
      return { score: result.score, decision: result.decision, factors: result.factors, source: "local" };
    },
  };
}
