import "server-only";
import type { InspectionResult } from "@/lib/contracts";
export const contextPrefix = "https://miva.campus/claims/";
const identifier = (v: unknown): v is string =>
  typeof v === "string" &&
  v.length <= 256 &&
  /^[A-Za-z0-9_:.\/-]+$/.test(v) &&
  !v.includes("@") &&
  !/^[^.]+\.[^.]+\.[^.]+$/.test(v);
export function safeClaims(raw: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const field of [
    "iss",
    "sub",
    "aud",
    "azp",
    "client_id",
    "scope",
    contextPrefix + "tenant_id",
    contextPrefix + "installation_id",
    contextPrefix + "roles",
    "installation_id",
  ]) {
    const value = raw[field];
    if (field === "scope" && value === "campus.webhooks.write")
      out[field] = value;
    else if (identifier(value)) out[field] = value;
    else if (
      Array.isArray(value) &&
      value.length <= 32 &&
      value.every(identifier)
    )
      out[field] = value;
  }
  for (const field of ["iat", "exp", "nbf"])
    if (typeof raw[field] === "number" && Number.isSafeInteger(raw[field]))
      out[field] = raw[field];
  return out;
}
export function safeHeader(raw: Record<string, unknown>) {
  return Object.fromEntries(
    ["alg", "kid", "typ"]
      .filter((k) => identifier(raw[k]))
      .map((k) => [k, raw[k]]),
  );
}
const oauthErrors = new Set([
  "invalid_request",
  "invalid_scope",
  "invalid_client",
  "unsupported_grant_type",
  "invalid_grant",
  "unauthorized_client",
  "server_error",
  "temporarily_unavailable",
]);
export function oauthError(body: unknown) {
  if (
    body &&
    typeof body === "object" &&
    "error" in body &&
    typeof body.error === "string" &&
    oauthErrors.has(body.error)
  )
    return body.error;
  return undefined;
}
export function safeEnvelope(body: unknown) {
  const b =
    body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  return {
    ...(oauthError(b) ? { error: oauthError(b) } : {}),
    ...(b.token_type === "Bearer" ? { token_type: "Bearer" } : {}),
    ...(typeof b.expires_in === "number" && Number.isSafeInteger(b.expires_in)
      ? { expires_in: b.expires_in }
      : {}),
    ...(typeof b.scope === "string" &&
    b.scope.length <= 256 &&
    /^[a-z0-9_. -]*$/.test(b.scope)
      ? { scope: b.scope }
      : {}),
    access_token:
      typeof b.access_token === "string" ? "[REDACTED]" : "[absent]",
    details: "Unrecognized fields and upstream descriptions omitted",
  };
}
export function exportEvidence(runs: InspectionResult[]) {
  return runs.map(
    ({
      id,
      kind,
      status,
      createdAt,
      checks,
      scenario,
      durationMs,
      expected,
      exchanges,
    }) => ({
      id,
      kind,
      status,
      createdAt,
      checks,
      scenario,
      durationMs,
      expected,
      exchanges: exchanges?.map((e) => ({
        endpoint: e.endpoint,
        status: e.status,
        error: e.error,
        rateLimit: e.rateLimit,
      })),
    }),
  );
}
