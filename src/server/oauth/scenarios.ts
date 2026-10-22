import "server-only";
import { SignJWT, generateKeyPair } from "jose";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { scenarios, type InspectionResult } from "@/lib/contracts";
import { audience } from "@/server/config";
import type { ProfileConfig } from "@/server/profiles/service";
import type { Store } from "@/server/db/store";
import type { loadKeys } from "@/server/crypto/keys";
import { campusRequest, UpstreamError } from "@/server/campus/client";
import { fail } from "@/server/http";
import { oauthError, safeEnvelope } from "@/server/evidence/redaction";
import { verifyToken } from "@/server/crypto/verify";
export const oauthSchema = z
  .object({
    scenario: z.enum(scenarios),
    scope: z
      .string()
      .max(256)
      .regex(
        /^[\x20-\x21\x23-\x5b\x5d-\x7e]*$/,
        "scope must use OAuth scope syntax",
      )
      .default("campus.webhooks.write"),
  })
  .strict();
export async function runOAuth(
  c: ProfileConfig,
  s: Store,
  keys: Awaited<ReturnType<typeof loadKeys>>,
  input: z.infer<typeof oauthSchema>,
) {
  const r = c.profile || s.registration();
  if (!r.client_id)
    fail(422, "client_id", "Save the registered Campus client ID first");
  const { scenario, scope } = input;
  const expectations: Record<string, { status: number; error?: string }> = {
    valid: { status: 200 },
    missing_scope: { status: 400, error: "invalid_scope" },
    missing_assertion: { status: 400, error: "invalid_request" },
    expired_assertion: { status: 401, error: "invalid_client" },
    wrong_audience: { status: 401, error: "invalid_client" },
    foreign_key: { status: 401, error: "invalid_client" },
    jti_replay: { status: 401, error: "invalid_client" },
  };
  const started = Date.now();
  const run: InspectionResult = {
    id: randomUUID(),
    kind: "oauth",
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
    scenario,
    status: "blocked",
    createdAt: new Date().toISOString(),
    checks: [],
    expected: expectations[scenario],
    exchanges: [],
    request: {
      method: "POST",
      path: "/apps/oauth2/token",
      grant_type: "client_credentials",
      scope,
      installation_id: r.installation_id,
      client_assertion: "[REDACTED]",
    },
  };
  try {
    const now = Math.floor(Date.now() / 1000);
    const key =
      scenario === "foreign_key"
        ? (await generateKeyPair("RS256", { modulusLength: 2048 })).privateKey
        : keys.privateKey;
    const assertion = await new SignJWT({})
      .setProtectedHeader({ alg: "RS256", kid: keys.kid })
      .setIssuer(r.client_id)
      .setSubject(r.client_id)
      .setAudience(
        scenario === "wrong_audience"
          ? "https://wrong-audience.invalid/token"
          : audience(c, "/apps/oauth2/token"),
      )
      .setIssuedAt(scenario === "expired_assertion" ? now - 600 : now)
      .setExpirationTime(
        scenario === "expired_assertion" ? now - 300 : now + 300,
      )
      .setJti(randomUUID())
      .sign(key);
    const form = new URLSearchParams({
      grant_type: "client_credentials",
      client_assertion_type:
        "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
    });
    if (scenario !== "missing_assertion")
      form.set("client_assertion", assertion);
    if (scenario !== "missing_scope") form.set("scope", scope);
    if (r.installation_id) form.set("installation_id", r.installation_id);
    const exchange = async () => {
      const res = await campusRequest(c, "/apps/oauth2/token", form);
      run.exchanges!.push({
        status: res.status,
        error: oauthError(res.body),
        response: safeEnvelope(res.body),
        rateLimit: res.rateLimit,
      });
      return res;
    };
    const first = await exchange();
    if (
      first.status === 429 ||
      first.status >= 500 ||
      (first.status >= 300 && first.status < 400) ||
      first.body === null
    ) {
      run.checks.push({
        name: "Campus response",
        status: "not_run",
        message:
          "Rate limit, server, redirect or non-JSON response blocked inspection",
      });
    } else if (scenario === "valid" || scenario === "jti_replay") {
      const body = first.body as Record<string, unknown>;
      const granted = scope.split(" ").includes("campus.webhooks.write")
        ? "campus.webhooks.write"
        : "";
      const envelope =
        first.status === 200 &&
        body.token_type === "Bearer" &&
        body.expires_in === 3600 &&
        body.scope === granted &&
        !!granted &&
        typeof body.access_token === "string";
      run.checks.push({
        name: "Bearer envelope",
        status: envelope ? "passed" : "failed",
        message:
          "Expected 200, Bearer, expires_in=3600 and the supported requested grant",
      });
      let valid = false;
      if (envelope) {
        const verified = await verifyToken(c, body.access_token as string, {
          kind: "oauth",
          client: r.client_id,
          installation: r.installation_id,
          scope: granted,
        });
        run.checks.push(...verified.checks);
        run.claims = verified.claims;
        run.header = verified.header;
        run.verified = verified.verified;
        valid = verified.checks.every((c) => c.status === "passed");
      }
      if (scenario === "valid") run.status = valid ? "passed" : "failed";
      else if (!valid) {
        run.status = "blocked";
        run.checks.push({
          name: "Replay prerequisite",
          status: "not_run",
          message:
            "First issuance did not fully verify; exact assertion was not replayed",
        });
      } else {
        const replay = await exchange();
        if (
          replay.status === 429 ||
          replay.status >= 500 ||
          (replay.status >= 300 && replay.status < 400) ||
          replay.body === null
        )
          run.checks.push({
            name: "Replay response",
            status: "not_run",
            message: "Replay response unavailable or rate limited",
          });
        else {
          const pass =
            replay.status === 401 &&
            oauthError(replay.body) === "invalid_client";
          run.status = pass ? "passed" : "failed";
          run.checks.push({
            name: "Exact assertion replay",
            status: pass ? "passed" : "failed",
            message:
              "The unchanged assertion must be rejected with 401 invalid_client",
          });
        }
      }
    } else {
      const expected = expectations[scenario],
        pass =
          first.status === expected.status &&
          oauthError(first.body) === expected.error;
      run.status = pass ? "passed" : "failed";
      run.checks.push({
        name: "Expected rejection",
        status: pass ? "passed" : "failed",
        message: `Expected ${expected.status} ${expected.error}`,
      });
    }
  } catch (e) {
    if (!(e instanceof UpstreamError)) throw e;
    run.status = "blocked";
    if (e.response)
      run.exchanges!.push({
        endpoint: "jwks",
        status: e.response.status,
        rateLimit: e.response.rateLimit,
        response: { details: "JWKS fetch rejected" },
      });
    run.checks.push({
      name: "Campus prerequisite",
      status: "not_run",
      message:
        "Campus transport or public signing keys unavailable or rejected",
    });
  }
  run.durationMs = Date.now() - started;
  return s.saveRun(run);
}
