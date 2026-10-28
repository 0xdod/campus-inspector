import "server-only";
import { SignJWT, generateKeyPair } from "jose";
import { randomUUID } from "node:crypto";
import { audience } from "@/server/config";
import type { ProfileConfig } from "@/server/profiles/service";
import type { loadKeys } from "@/server/crypto/keys";
import {
  campusRequest,
  UpstreamError,
  type HttpLogRecorder,
} from "@/server/campus/client";
import { verifyToken } from "@/server/crypto/verify";
import type { Registration } from "@/lib/contracts";
export async function clientAssertion(
  c: ProfileConfig,
  keys: Awaited<ReturnType<typeof loadKeys>>,
  client: string,
  scenario = "valid",
) {
  const now = Math.floor(Date.now() / 1000);
  const key =
    scenario === "foreign_key"
      ? (await generateKeyPair("RS256", { modulusLength: 2048 })).privateKey
      : keys.privateKey;
  return new SignJWT({})
    .setProtectedHeader({ alg: "RS256", kid: keys.kid })
    .setIssuer(client)
    .setSubject(client)
    .setAudience(
      scenario === "wrong_audience"
        ? "https://wrong-audience.invalid/token"
        : audience(c, "/apps/oauth2/token"),
    )
    .setIssuedAt(scenario === "expired_assertion" ? now - 600 : now)
    .setExpirationTime(scenario === "expired_assertion" ? now - 300 : now + 300)
    .setJti(randomUUID())
    .sign(key);
}
export async function verifiedServiceToken(
  c: ProfileConfig,
  token: unknown,
  r: Registration,
  record?: HttpLogRecorder,
) {
  const body = token as Record<string, unknown> | null;
  if (
    !body ||
    body.token_type !== "Bearer" ||
    body.expires_in !== 3600 ||
    body.scope !== "campus.webhooks.write" ||
    typeof body.access_token !== "string"
  )
    return null;
  const verified = await verifyToken(
    c,
    body.access_token,
    {
      kind: "oauth",
      client: r.client_id,
      installation: r.installation_id,
      scope: "campus.webhooks.write",
    },
    record,
  );
  if (
    !verified.verified ||
    !verified.checks.every((check) => check.status === "passed")
  )
    return null;
  const installation = verified.claims.installation_id;
  if (typeof installation !== "string") return null;
  return { token: body.access_token, installation };
}
export async function acquireServiceToken(
  c: ProfileConfig,
  keys: Awaited<ReturnType<typeof loadKeys>>,
  r: Registration,
  record: HttpLogRecorder,
  observe: (res: Awaited<ReturnType<typeof campusRequest>>) => void,
) {
  const assertion = await clientAssertion(c, keys, r.client_id);
  const form = new URLSearchParams({
    grant_type: "client_credentials",
    scope: "campus.webhooks.write",
    client_assertion_type:
      "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
    client_assertion: assertion,
  });
  if (r.installation_id) form.set("installation_id", r.installation_id);
  const response = await campusRequest(c, "/apps/oauth2/token", form, record);
  observe(response);
  if (response.status !== 200) throw new UpstreamError();
  const result = await verifiedServiceToken(c, response.body, r, record);
  if (!result) throw new UpstreamError();
  return result;
}
