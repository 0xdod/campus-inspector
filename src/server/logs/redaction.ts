import "server-only";
import { randomUUID } from "node:crypto";
import type { HttpLog } from "@/lib/contracts";
import { oauthError, safeHeader } from "@/server/evidence/redaction";
const sensitive = new Set([
  "client_assertion",
  "access_token",
  "id_token",
  "refresh_token",
  "password",
  "state",
  "nonce",
  "jti",
  "login_message_hint",
  "reference",
  "code",
  "csrf",
]);
const requestFields = new Set([
  "grant_type",
  "client_assertion_type",
  "scope",
  "client_id",
  "installation_id",
  "login_hint",
  "redirect_uri",
  "response_type",
  "response_mode",
  "prompt",
  "target_link_uri",
  "iss",
]);
function technicalText(value: unknown) {
  return typeof value === "string" &&
    value.length <= 2048 &&
    !/[\x00-\x1f\x7f@]/.test(value) &&
    !/[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/.test(value)
    ? value
    : "[REDACTED]";
}
export function httpRequestBody(
  form: URLSearchParams,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const field of new Set(form.keys())) {
    if (sensitive.has(field)) result[field] = "[REDACTED]";
    else if (requestFields.has(field))
      result[field] = technicalText(form.get(field));
  }
  return result;
}
export function redactedURL(raw: string) {
  try {
    const url = new URL(raw);
    url.username = "";
    url.password = "";
    url.hash = "";
    const safe = httpRequestBody(url.searchParams);
    url.search = new URLSearchParams(
      Object.entries(safe).map(([key, value]) => [key, String(value)]),
    ).toString();
    return url.toString();
  } catch {
    return "[Invalid URL omitted]";
  }
}
export function httpResponseBody(
  raw: unknown,
  kind: HttpLog["kind"],
): Record<string, unknown> | string {
  if (raw === null || raw === undefined)
    return "[Non-JSON or empty response body omitted]";
  if (typeof raw !== "object" || Array.isArray(raw))
    return "[Unrecognized response body omitted]";
  const body = raw as Record<string, unknown>;
  if (kind === "jwks") {
    if (!Array.isArray(body.keys)) return { keys: "[Malformed JWKS body]" };
    return {
      keys: body.keys.slice(0, 16).map((value) => {
        if (!value || typeof value !== "object") return "[Malformed key]";
        const key = value as Record<string, unknown>;
        const result: Record<string, unknown> = { ...safeHeader(key) };
        for (const field of ["kty", "use"])
          if (typeof key[field] === "string")
            result[field] = technicalText(key[field]);
        for (const field of ["n", "e"])
          if (
            typeof key[field] === "string" &&
            key[field].length <= 2048 &&
            /^[A-Za-z0-9_-]+$/.test(key[field])
          )
            result[field] = key[field];
        for (const field of ["d", "p", "q", "dp", "dq", "qi", "oth", "k"])
          if (field in key) result[field] = "[REDACTED]";
        return result;
      }),
    };
  }
  const result: Record<string, unknown> = {};
  for (const field of [
    "access_token",
    "id_token",
    "refresh_token",
    "client_assertion",
    "error_description",
  ])
    if (field in body) result[field] = "[REDACTED]";
  if ("error" in body)
    result.error = oauthError(body) || "[Unrecognized OAuth error redacted]";
  if ("token_type" in body)
    result.token_type = ["Bearer", "MAC"].includes(String(body.token_type))
      ? body.token_type
      : "[Unrecognized token type redacted]";
  if ("expires_in" in body)
    result.expires_in =
      typeof body.expires_in === "number" && Number.isFinite(body.expires_in)
        ? body.expires_in
        : "[Invalid expiry type]";
  if ("scope" in body) result.scope = technicalText(body.scope);
  const known = new Set([
    "access_token",
    "id_token",
    "refresh_token",
    "client_assertion",
    "error_description",
    "error",
    "token_type",
    "expires_in",
    "scope",
  ]);
  if (Object.keys(body).some((key) => !known.has(key)))
    result._omitted = "Additional upstream fields omitted";
  return result;
}
export function safeContentType(value: string | null | undefined) {
  const type = value?.split(";")[0].trim().toLowerCase();
  return type &&
    [
      "application/json",
      "application/jwk-set+json",
      "application/x-www-form-urlencoded",
      "text/html",
      "text/plain",
    ].includes(type)
    ? type
    : "[unspecified or unsupported]";
}
export function newHttpLog(
  kind: HttpLog["kind"],
  direction: HttpLog["direction"],
  request: HttpLog["request"],
): HttpLog {
  return {
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    kind,
    direction,
    outcome: "unobserved",
    request,
  };
}
