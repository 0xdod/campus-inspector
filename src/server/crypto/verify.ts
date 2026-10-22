import "server-only";
import {
  compactVerify,
  decodeJwt,
  decodeProtectedHeader,
  importJWK,
  type JWK,
} from "jose";
import { campusRequest, UpstreamError } from "@/server/campus/client";
import { audience, type Config } from "@/server/config";
import {
  contextPrefix as prefix,
  safeClaims,
  safeHeader,
} from "@/server/evidence/redaction";
import type { CheckResult } from "@/lib/contracts";
let observation: { status: string; observedAt?: string; keyCount?: number } = {
  status: "Not fetched",
};
export const jwksObservation = () => observation;
export async function platformKeys(c: Config): Promise<JWK[]> {
  try {
    const res = await campusRequest(c, "/.well-known/jwks.json");
    if (res.status !== 200)
      throw new UpstreamError({ status: res.status, rateLimit: res.rateLimit });
    const data = res.body as { keys?: unknown } | null;
    if (
      !data ||
      !Array.isArray(data.keys) ||
      !data.keys.length ||
      data.keys.length > 16
    )
      throw new UpstreamError();
    const keys: JWK[] = [];
    const kids = new Set<string>();
    for (const raw of data.keys) {
      if (!raw || typeof raw !== "object") throw new UpstreamError();
      const k = raw as JWK;
      if (
        ["d", "p", "q", "dp", "dq", "qi", "oth", "k"].some(
          (field) => field in k,
        ) ||
        typeof k.kid !== "string" ||
        !k.kid ||
        kids.has(k.kid) ||
        k.kty !== "RSA" ||
        (k.alg && k.alg !== "RS256") ||
        (k.use && k.use !== "sig") ||
        (k.key_ops &&
          (!Array.isArray(k.key_ops) ||
            k.key_ops.some((op) => op !== "verify"))) ||
        typeof k.n !== "string" ||
        typeof k.e !== "string" ||
        Buffer.from(k.n, "base64url").length < 256
      )
        throw new UpstreamError();
      kids.add(k.kid);
      await importJWK(k, "RS256");
      keys.push(k);
    }
    observation = {
      status: "Fetched public signing keys",
      observedAt: new Date().toISOString(),
      keyCount: keys.length,
    };
    return keys;
  } catch (error) {
    observation = {
      status: "Unavailable or rejected",
      observedAt: new Date().toISOString(),
    };
    throw error instanceof UpstreamError ? error : new UpstreamError();
  }
}
export type Binding = {
  kind: "oidc" | "oauth";
  client: string;
  user?: string;
  nonce?: string;
  installation?: string;
  scope?: string;
};
export async function verifyToken(c: Config, token: string, b: Binding) {
  const checks: CheckResult[] = [];
  const check = (name: string, ok: boolean, message: string) => {
    checks.push({ name, status: ok ? "passed" : "failed", message });
  };
  let claims: Record<string, unknown> = {},
    header: Record<string, unknown> = {};
  let verified = false;
  try {
    header = decodeProtectedHeader(token) as Record<string, unknown>;
    claims = decodeJwt(token);
  } catch {
    check("JWT structure", false, "A compact signed JWT is required");
  }
  const names = [
    "Issuer",
    "Audience",
    "Times and lifetime",
    ...(b.kind === "oidc"
      ? [
          "Nonce",
          "Subject",
          "Authorized party",
          "Tenant context",
          "Installation context",
          "Roles",
        ]
      : ["Subject and client", "Scope", "Installation context"]),
  ];
  if (!checks.length) {
    check(
      "Algorithm",
      header.alg === "RS256" && typeof header.kid === "string" && !!header.kid,
      "RS256 with an explicit key ID is required",
    );
    if (
      header.alg === "RS256" &&
      typeof header.kid === "string" &&
      header.kid
    ) {
      const keys = await platformKeys(c);
      const key = keys.find((k) => k.kid === header.kid);
      try {
        if (!key) throw new Error();
        await compactVerify(token, await importJWK(key, "RS256"), {
          algorithms: ["RS256"],
        });
        verified = true;
        check(
          "Signature",
          true,
          "Signature verified using configured Campus JWKS",
        );
      } catch {
        check("Signature", false, "Signature or key ID is invalid");
      }
    }
  }
  if (!verified) {
    for (const name of names)
      checks.push({
        name,
        status: "not_run",
        message: "Not run: signature is untrusted",
      });
    return {
      checks,
      verified: false,
      claims: safeClaims(claims),
      header: safeHeader(header),
    };
  }
  const now = Math.floor(Date.now() / 1000),
    lifetime = b.kind === "oidc" ? 300 : 3600;
  check(
    "Issuer",
    claims.iss === c.issuer,
    "Issuer must exactly match configured Campus issuer",
  );
  const want = b.kind === "oidc" ? b.client : audience(c, "/apps/webhooks");
  check(
    "Audience",
    claims.aud === want ||
      (Array.isArray(claims.aud) &&
        claims.aud.every((x) => typeof x === "string") &&
        claims.aud.includes(want)),
    "Audience must contain the expected recipient",
  );
  check(
    "Times and lifetime",
    Number.isSafeInteger(claims.iat) &&
      Number.isSafeInteger(claims.exp) &&
      (claims.iat as number) <= now + 30 &&
      (claims.exp as number) > now &&
      (claims.exp as number) - (claims.iat as number) === lifetime &&
      (claims.nbf === undefined ||
        (Number.isSafeInteger(claims.nbf) && (claims.nbf as number) <= now)),
    `Required iat/exp, future iat ≤30s, no expiry grace, lifetime exactly ${lifetime}s`,
  );
  if (b.kind === "oidc") {
    check(
      "Nonce",
      claims.nonce === b.nonce,
      "Nonce must match the consumed transaction",
    );
    check(
      "Subject",
      claims.sub === b.user,
      "Subject must match the original user ID",
    );
    check(
      "Authorized party",
      claims.azp === b.client,
      "Authorized party must match the transaction client",
    );
    check(
      "Tenant context",
      typeof claims[prefix + "tenant_id"] === "string" &&
        !!(claims[prefix + "tenant_id"] as string).trim(),
      "A nonempty tenant ID string is required",
    );
    const install = claims[prefix + "installation_id"];
    check(
      "Installation context",
      typeof install === "string" &&
        !!install.trim() &&
        (!b.installation || install === b.installation),
      "Installation must be present and match the transaction when configured",
    );
    check(
      "Roles",
      Array.isArray(claims[prefix + "roles"]) &&
        (claims[prefix + "roles"] as unknown[]).every(
          (r) => typeof r === "string",
        ),
      "Roles must be an array of strings; an empty array is permitted",
    );
  } else {
    check(
      "Subject and client",
      claims.sub === b.client && claims.client_id === b.client,
      "Subject and client_id must match registration",
    );
    check(
      "Scope",
      claims.scope === b.scope,
      "Service token scope must match the supported requested grant",
    );
    check(
      "Installation context",
      typeof claims.installation_id === "string" &&
        !!claims.installation_id.trim() &&
        (!b.installation || claims.installation_id === b.installation),
      "Service installation must be present and match when configured",
    );
  }
  return {
    checks,
    verified: true,
    claims: safeClaims(claims),
    header: safeHeader(header),
  };
}
