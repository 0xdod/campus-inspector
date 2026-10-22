import "server-only";
import type { HttpLog, InspectionResult } from "@/lib/contracts";
import type { Store } from "@/server/db/store";
import { newHttpLog, redactedURL, safeContentType } from "./redaction";
export async function recordInbound(
  s: Store,
  req: Request,
  response: Response,
  body: HttpLog["request"]["body"],
  started: number,
  context?: { runId?: string; profile?: InspectionResult["profile"] },
  publicUrl?: string,
) {
  const url = new URL(req.url);
  const target = publicUrl
    ? new URL(url.pathname + url.search, publicUrl).toString()
    : req.url;
  const log = newHttpLog("oidc", "inbound", {
    method: req.method,
    url: redactedURL(target),
    headers: req.headers.has("content-type")
      ? { "content-type": safeContentType(req.headers.get("content-type")) }
      : {},
    body,
  });
  const headers: Record<string, string> = {};
  if (response.headers.has("content-type"))
    headers["content-type"] = safeContentType(
      response.headers.get("content-type"),
    );
  if (response.headers.has("location"))
    headers.location = redactedURL(response.headers.get("location")!);
  const responseBody = response.headers
    .get("content-type")
    ?.startsWith("application/json")
    ? ((await response.clone().json()) as Record<string, unknown>)
    : null;
  return s.saveHttpLog({
    ...log,
    ...context,
    createdAt: new Date(started).toISOString(),
    durationMs: Date.now() - started,
    outcome: "completed",
    response: { status: response.status, headers, body: responseBody },
    note: "Integration request observed by the inspector. Credentials are redacted.",
  });
}
