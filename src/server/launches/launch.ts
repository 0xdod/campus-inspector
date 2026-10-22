import "server-only";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { campusURL, type Config } from "@/server/config";
import { secret, type Store } from "@/server/db/store";
import { fail } from "@/server/http";
import { verifyToken } from "@/server/crypto/verify";
import { UpstreamError } from "@/server/campus/client";
import type { ProfileConfig } from "@/server/profiles/service";
import { newHttpLog, redactedURL } from "@/server/logs/redaction";
import type { InspectionResult, HttpLog } from "@/lib/contracts";
const boundedText = z
  .string()
  .min(1)
  .max(2048)
  .refine(
    (v) => !!v.trim() && !/[\x00-\x1f\x7f]/.test(v),
    "must be nonempty text without control characters",
  );
const userIDPattern = /^[1-9][0-9]{0,18}$/;
export const launchSchema = z
  .object({
    login_hint: z
      .string()
      .regex(userIDPattern, "A positive original user ID is required")
      .refine(
        (v) => userIDPattern.test(v) && BigInt(v) <= 9223372036854775807n,
        "User ID is out of range",
      ),
    reference: boundedText,
    nonce: boundedText.optional(),
  })
  .strict();
export function startLaunch(
  c: ProfileConfig,
  s: Store,
  input: z.infer<typeof launchSchema>,
) {
  const r = c.profile || s.registration();
  if (!r.client_id)
    fail(422, "client_id", "Save the registered Campus client ID first");
  const parsed = launchSchema.parse(input);
  const state = secret(),
    nonce = parsed.nonce || secret();
  const now = Date.now();
  const snapshot = {
    created: now,
    campusBase: c.campusBase,
    issuer: c.issuer,
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
    user: parsed.login_hint,
    client: r.client_id,
    installation: r.installation_id,
    nonce,
    expires: now + 300000,
  };
  const url = new URL(campusURL(c, "/apps/oidc/login"));
  url.search = new URLSearchParams({
    state,
    nonce,
    login_hint: parsed.login_hint,
    client_id: r.client_id,
    redirect_uri: c.publicUrl + "/oidc/callback",
    login_message_hint: parsed.reference,
    scope: "openid",
    response_type: "id_token",
    response_mode: "form_post",
    prompt: "none",
    target_link_uri: c.publicUrl + "/oidc/callback",
  }).toString();
  const log = newHttpLog("oidc", "browser_redirect", {
    method: "GET",
    url: redactedURL(url.toString()),
    headers: {},
    body: null,
  });
  log.profile = snapshot.profile;
  log.note =
    "Prepared browser redirect. The inspector cannot observe the Campus response unless a callback arrives.";
  s.db.transaction(() => {
    s.addLaunch(state, { ...snapshot, logId: log.id });
    s.saveHttpLog(log);
  })();
  return url.toString();
}
export function publicInitiation(
  c: ProfileConfig,
  s: Store,
  p: URLSearchParams,
) {
  if (p.get("iss") !== c.issuer)
    fail(400, "iss", "iss must exactly match the configured Campus issuer");
  const r = c.profile || s.registration();
  if (!r.client_id)
    fail(422, "client_id", "Save the registered Campus client ID first");
  if (p.has("client_id") && p.get("client_id") !== r.client_id)
    fail(400, "client_id", "client_id must match registration");
  if (
    p.has("target_link_uri") &&
    p.get("target_link_uri") !== c.publicUrl + "/oidc/callback"
  )
    fail(
      400,
      "target_link_uri",
      "target_link_uri must match the configured callback",
    );
  const launch = z
    .object({
      login_hint: launchSchema.shape.login_hint,
      login_message_hint: boundedText,
    })
    .parse({
      login_hint: p.get("login_hint"),
      login_message_hint: p.get("login_message_hint"),
    });
  return startLaunch(c, s, {
    login_hint: launch.login_hint,
    reference: launch.login_message_hint,
  });
}
export async function callback(
  c: Config,
  s: Store,
  state: string,
  token: string,
) {
  const snapshot = s.consumeLaunch(state);
  if (!snapshot)
    fail(400, "state", "State is unknown, expired or already used");
  if (!snapshot.campusBase || !snapshot.issuer)
    fail(
      400,
      "state",
      "This launch predates saved profiles; start a fresh launch",
    );
  const run: InspectionResult = {
    id: randomUUID(),
    kind: "oidc",
    profile: snapshot.profile,
    status: "failed",
    createdAt: new Date().toISOString(),
    checks: [
      {
        name: "State correlation",
        status: "passed",
        message: "A live single-use transaction was atomically consumed",
      },
    ],
    request: {
      user: snapshot.user,
      client_id: snapshot.client,
      installation_id: snapshot.installation,
      method: "POST",
      content_type: "application/x-www-form-urlencoded",
    },
  };
  const record = (log: HttpLog) =>
    s.saveHttpLog({ ...log, runId: run.id, profile: run.profile });
  try {
    const result = await verifyToken(
      {
        ...c,
        campusBase: snapshot.campusBase,
        issuer: snapshot.issuer,
      },
      token,
      { kind: "oidc", ...snapshot },
      record,
    );
    run.checks.push(...result.checks);
    run.header = result.header;
    run.claims = result.claims;
    run.verified = result.verified;
    run.status = result.checks.every((c) => c.status === "passed")
      ? "passed"
      : "failed";
  } catch (e) {
    if (!(e instanceof UpstreamError)) throw e;
    run.status = "blocked";
    if (e.response)
      run.exchanges = [
        {
          endpoint: "jwks",
          status: e.response.status,
          rateLimit: e.response.rateLimit,
          response: { details: "JWKS fetch rejected" },
        },
      ];
    run.checks.push({
      name: "Campus JWKS",
      status: "not_run",
      message: "Public keys unavailable or rejected; verification blocked",
    });
  }
  return s.db.transaction(() => {
    s.saveRun(run);
    if (snapshot.logId) s.linkHttpLog(snapshot.logId, run.id);
    return run;
  })();
}
