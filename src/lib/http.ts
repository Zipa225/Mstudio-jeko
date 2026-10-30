// Petits outils communs aux routes. Réponses sans cache, corps limités en taille, erreurs sans détail interne.

export const SESSION_ID = /^[A-Za-z0-9_-]{1,64}$/;

export const json = (data: unknown, status = 200): Response =>
  Response.json(data, { status, headers: { "Cache-Control": "no-store" } });

export const internalError = (): Response => json({ error: "internal_error" }, 500);

export type Body<T> = { ok: true; data: T } | { ok: false; response: Response };

/** Lit le corps en texte, sans dépasser `maxBytes`. */
export async function readText(req: Request, maxBytes: number): Promise<Body<string>> {
  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) return { ok: false, response: json({ error: "too_large" }, 413) };
  const text = await req.text();
  if (Buffer.byteLength(text, "utf8") > maxBytes) return { ok: false, response: json({ error: "too_large" }, 413) };
  return { ok: true, data: text };
}

/** Lit un corps JSON objet. 415 si ce n'est pas du JSON, 413 si trop gros, 400 si illisible. */
export async function readJson(req: Request, maxBytes = 10_000): Promise<Body<Record<string, unknown>>> {
  if (!(req.headers.get("content-type") ?? "").toLowerCase().includes("application/json")) {
    return { ok: false, response: json({ error: "unsupported_media_type" }, 415) };
  }
  const body = await readText(req, maxBytes);
  if (!body.ok) return body;
  try {
    const data: unknown = JSON.parse(body.data);
    if (typeof data !== "object" || data === null || Array.isArray(data)) throw new Error("not an object");
    return { ok: true, data: data as Record<string, unknown> };
  } catch {
    return { ok: false, response: json({ error: "invalid_json" }, 400) };
  }
}

/** Attrape toute erreur inattendue : le client reçoit un message générique, jamais une trace. */
export async function guarded(handler: () => Promise<Response> | Response): Promise<Response> {
  try {
    return await handler();
  } catch {
    return internalError();
  }
}
