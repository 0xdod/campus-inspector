import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { InspectionResult, HttpLog } from "@/lib/contracts";
import { buildWebhookBody, webhookPresets } from "@/lib/webhooks";
import type { Store } from "@/server/db/store";
import type { ProfileConfig } from "@/server/profiles/service";
import type { loadKeys } from "@/server/crypto/keys";
import { acquireServiceToken } from "@/server/oauth/token";
import { campusRequest, UpstreamError } from "@/server/campus/client";
import { httpResponseBody } from "@/server/logs/redaction";
import { safeEnvelope } from "@/server/evidence/redaction";
import { fail } from "@/server/http";
export const webhookSchema = z
  .object({
    scenario: z.enum(webhookPresets.map((p) => p.id)),
    body: z
      .string()
      .max(300000)
      .refine(
        (value) => Buffer.byteLength(value) <= 300000,
        "Inspector event body exceeds its 300000-byte forwarding limit",
      )
      .optional(),
  })
  .strict();
export async function runWebhook(
  c: ProfileConfig,
  s: Store,
  keys: Awaited<ReturnType<typeof loadKeys>>,
  input: z.infer<typeof webhookSchema>,
) {
  const registration = { ...(c.profile || s.registration()) };
  if (!registration.client_id)
    fail(422, "client_id", "Save a registered Campus client ID first");
  const preset = webhookPresets.find((p) => p.id === input.scenario)!;
  const started = Date.now();
  const run: InspectionResult = {
    id: randomUUID(),
    kind: "webhook",
    scenario: preset.id,
    status: "blocked",
    createdAt: new Date().toISOString(),
    checks: [],
    expected: { status: preset.status },
    exchanges: [],
    ...(c.profile
      ? {
          profile: {
            id: c.profile.id,
            name: c.profile.name,
            campusBase: c.campusBase,
            issuer: c.issuer,
          },
        }
      : {}),
  };
  const record = (log: HttpLog) =>
    s.saveHttpLog({ ...log, runId: run.id, profile: run.profile });
  let sent = false;
  try {
    const service = await acquireServiceToken(
      c,
      keys,
      registration,
      record,
      (res) =>
        run.exchanges!.push({
          endpoint: "token",
          status: res.status,
          response: safeEnvelope(res.body),
          rateLimit: res.rateLimit,
        }),
    );
    run.checks.push({
      name: "Service token prerequisite",
      status: "passed",
      message:
        "Token signature, lifetime, scope, issuer, audience and installation bindings verified",
    });
    const raw = input.body ?? buildWebhookBody(preset.id, service.installation);
    if (Buffer.byteLength(raw) > 300000)
      fail(
        400,
        "body",
        "Inspector event body exceeds its 300000-byte forwarding limit",
      );
    let eventID: unknown;
    try {
      eventID = JSON.parse(raw).id;
    } catch {
      /* Deliberately invalid test input is forwarded unchanged. */
    }
    run.request = {
      method: "POST",
      path: "/apps/webhooks",
      bytes: Buffer.byteLength(raw),
      envelope: "[REDACTED]",
    };
    if (input.body === undefined && typeof eventID === "string")
      run.request.event_id = eventID;
    sent = true;
    const res = await campusRequest(
      c,
      "/apps/webhooks",
      {
        raw,
        ...(preset.id === "missing_bearer"
          ? {}
          : {
              bearer:
                preset.id === "invalid_bearer"
                  ? "invalid-inspector-token"
                  : service.token,
            }),
      },
      record,
    );
    run.exchanges!.push({
      endpoint: "webhook",
      status: res.status,
      response: httpResponseBody(res.body, "webhook") as Record<
        string,
        unknown
      >,
      rateLimit: res.rateLimit,
    });
    if (
      res.status === 429 ||
      res.status >= 500 ||
      (res.status >= 300 && res.status < 400) ||
      !res.body ||
      typeof res.body !== "object" ||
      Array.isArray(res.body)
    ) {
      run.checks.push({
        name: "Campus webhook response",
        status: "not_run",
        message:
          "Rate limit, server, redirect or non-object response blocked inspection; no automatic retry",
      });
    } else {
      const body = res.body as Record<string, unknown>;
      const statusOK = res.status === preset.status;
      run.checks.push({
        name: "Campus HTTP status",
        status: statusOK ? "passed" : "failed",
        message: `Expected HTTP ${preset.status}; observed ${res.status}`,
      });
      if (preset.status === 202) {
        const match =
          typeof eventID === "string" &&
          body.id === eventID &&
          body.status === "received";
        run.checks.push({
          name: "New event receipt",
          status: match ? "passed" : "failed",
          message:
            "Response must echo the submitted ID with status received. Verify persistence and audit separately in Campus.",
        });
      } else {
        const expectedField = "field" in preset ? preset.field : undefined;
        const errors = body.errors;
        const standard =
          typeof body.status === "string" &&
          typeof body.message === "string" &&
          Array.isArray(errors) &&
          errors.some(
            (e) =>
              e &&
              typeof e === "object" &&
              e.field === expectedField &&
              typeof e.message === "string" &&
              e.message.length > 0,
          );
        run.checks.push({
          name: "Field error contract",
          status: standard ? "passed" : "failed",
          message: `Expected standard status/message/errors with field ${expectedField}`,
        });
      }
      run.status = run.checks.every((check) => check.status === "passed")
        ? "passed"
        : "failed";
    }
  } catch (error) {
    if (!(error instanceof UpstreamError)) throw error;
    if (error.response)
      run.exchanges!.push({
        endpoint: "jwks",
        status: error.response.status,
        response: { details: "Public signing keys unavailable" },
        rateLimit: error.response.rateLimit,
      });
    run.checks.push({
      name: sent ? "Receipt unknown" : "Service token prerequisite",
      status: "not_run",
      message: sent
        ? "No complete response. Campus may have stored this event. Check the submitted ID in Campus before resending; no automatic retry occurred."
        : "Campus token issuance or verification unavailable or rejected. Check registration, installation selection, current app state and token/JWKS exchanges; no webhook was sent.",
    });
  }
  run.durationMs = Date.now() - started;
  return s.saveRun(run);
}
