import { guarded, json, readJson, SESSION_ID } from "../../../lib/http";
import { checkUnblock, KYC_MAX_ATTEMPTS } from "../../../lib/kyc";
import { getRuntime } from "../../../lib/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const OPERATION_ID = /^[A-Za-z0-9-]{1,64}$/;

/**
 * Débloque une opération retenue par Argus : la commerçante prouve son identité (KYC statique : date de naissance et
 * quatre derniers chiffres de la pièce d'identité). Réussite : l'opération redevient « à confirmer » et la réponse est
 * la relecture, avec Oui et Non ; rien n'est exécuté sans ce « oui ». Échec : 403 avec le nombre d'essais restants,
 * 423 une fois les essais épuisés (l'opération reste bloquée, l'analyste est prévenu).
 */
export async function POST(req: Request) {
  return guarded(async () => {
    const rt = getRuntime();
    const body = await readJson(req);
    if (!body.ok) return body.response;
    const { sessionId, operationId, birthDate, idLast4 } = body.data;
    if (typeof sessionId !== "string" || !SESSION_ID.test(sessionId)) return json({ error: "invalid_session" }, 400);
    if (typeof operationId !== "string" || !OPERATION_ID.test(operationId)) return json({ error: "invalid_operation" }, 400);

    const check = checkUnblock(rt.store, operationId, { birthDate, idLast4 });
    if (!check.ok) {
      if (check.reason === "not_blocked") return json({ error: "not_blocked" }, 409);
      if (check.reason === "locked") {
        return json({ error: "locked", message: "Trop d'essais. Un conseiller Jèko va te rappeler." }, 423);
      }
      const left = check.attemptsLeft;
      return json(
        { error: "wrong", attemptsLeft: left, message: `Ces informations ne correspondent pas. Il te reste ${left} essai${left > 1 ? "s" : ""} sur ${KYC_MAX_ATTEMPTS}.` },
        403,
      );
    }

    const result = await rt.dialog.resumeBlocked(sessionId, operationId);
    rt.allowSpeech(result.speech);
    return json({ ok: true, ...result });
  });
}
