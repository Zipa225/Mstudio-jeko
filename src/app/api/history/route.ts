import { guarded, json } from "../../../lib/http";
import { buildHistory } from "../../../lib/history";
import { DEMO_KYC } from "../../../lib/kyc";
import { getRuntime } from "../../../lib/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * L'historique de la commerçante : ses opérations avec un statut en mots simples. Pas de score ni de raison d'Argus
 * (c'est l'écran de l'analyste), et une opération retenue par la phrase de contrainte s'y montre comme un succès.
 * En démonstration seulement, `kycHint` rappelle au présentateur les deux informations du personnage d'Awa.
 */
export async function GET() {
  return guarded(() => {
    const rt = getRuntime();
    const items = buildHistory(rt.store);
    if (!rt.demoMode) return json({ items });
    const [year, month, day] = DEMO_KYC.birthDate.split("-");
    return json({ items, kycHint: `${day}/${month}/${year} et ${DEMO_KYC.idLast4}` });
  });
}
