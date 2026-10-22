import { beforeAll, afterAll, beforeEach, it, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fixtureCampus } from "../fixtures/campus";
import { readConfig, type Config } from "@/server/config";
import { Store } from "@/server/db/store";
import { loadKeys } from "@/server/crypto/keys";
import { verifyToken, platformKeys } from "@/server/crypto/verify";
import {
  startLaunch,
  callback,
  publicInitiation,
} from "@/server/launches/launch";
import { form } from "@/server/http";
import { runOAuth } from "@/server/oauth/scenarios";
import { scenarios } from "@/lib/contracts";
import type { JWTPayload } from "jose";
let dir: string,
  s: Store,
  c: Config,
  keys: Awaited<ReturnType<typeof loadKeys>>,
  fixture: Awaited<ReturnType<typeof fixtureCampus>>;
beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "protocol-"));
  s = new Store(dir);
  keys = await loadKeys(dir);
  fixture = await fixtureCampus({ appJWK: keys.jwk });
  c = readConfig({
    PUBLIC_URL: "http://localhost:8090",
    CAMPUS_BASE_URL: fixture.base + "/api/backend",
    CAMPUS_ISSUER: fixture.issuer,
    ALLOW_LOCAL_HTTP: "true",
    INSPECTOR_PASSWORD: "fixture-only-password",
  });
});
afterAll(async () => {
  await fixture.close();
  s.close();
  rmSync(dir, { force: true, recursive: true });
});
beforeEach(() => {
  fixture.setMode("normal");
  fixture.changeToken((c) => c);
  s.setRegistration({
    client_id: "fixture-client",
    installation_id: "fixture-install",
  });
});
it("builds the exact browser request, snapshots bindings and consumes before verification", async () => {
  const url = new URL(
    startLaunch(c, s, {
      login_hint: "7",
      reference: "SENTINEL-REFERENCE",
      nonce: "SENTINEL-NONCE",
    }),
  );
  expect(url.pathname).toBe("/api/backend/apps/oidc/login");
  expect(url.searchParams.get("scope")).toBe("openid");
  expect(url.searchParams.get("target_link_uri")).toBe(
    c.publicUrl + "/oidc/callback",
  );
  expect(url.searchParams.get("response_mode")).toBe("form_post");
  const state = url.searchParams.get("state")!;
  const run = await callback(
    c,
    s,
    state,
    await fixture.sign(fixture.identity("SENTINEL-NONCE")),
  );
  expect(run.status).toBe("passed");
  expect(JSON.stringify(s.history())).not.toContain("SENTINEL");
  await expect(callback(c, s, state, "invalid")).rejects.toThrow(
    "already used",
  );
});
it("consumes state even for a malformed JWT and marks trusted checks not run", async () => {
  const url = new URL(
    startLaunch(c, s, { login_hint: "7", reference: "opaque" }),
  );
  const state = url.searchParams.get("state")!;
  const run = await callback(c, s, state, "invalid");
  expect(run.status).toBe("failed");
  expect(run.checks.find((c) => c.name === "Subject")?.status).toBe("not_run");
  await expect(callback(c, s, state, "invalid")).rejects.toThrow();
});
it("binds initiation to configured issuer, client and target, rejecting duplicate parameters", () => {
  const p = new URLSearchParams({
    iss: c.issuer,
    login_hint: "7",
    login_message_hint: "opaque",
  });
  expect(publicInitiation(c, s, p)).toContain("/apps/oidc/login");
  for (const [field, value] of [
    ["iss", c.issuer.replace(/\/$/, "")],
    ["client_id", "foreign"],
    ["target_link_uri", "https://evil.example"],
  ]) {
    const bad = new URLSearchParams(p);
    bad.set(field, value);
    expect(() => publicInitiation(c, s, bad)).toThrow();
  }
  expect(() => form("iss=a&iss=b", ["iss"])).toThrow();
  expect(() => form("state=%ZZ", ["state"])).toThrow();
});
const badClaims: [string, (c: JWTPayload) => JWTPayload][] = [
  ["issuer", (c) => ({ ...c, iss: "https://wrong.example" })],
  ["audience", (c) => ({ ...c, aud: "foreign" })],
  ["subject", (c) => ({ ...c, sub: "8" })],
  ["azp", (c) => ({ ...c, azp: "other" })],
  ["nonce", (c) => ({ ...c, nonce: "wrong" })],
  ["expiry", (c) => ({ ...c, exp: 0 })],
  ["missing iat", (c) => ({ ...c, iat: undefined })],
  [
    "future iat",
    (c) => ({
      ...c,
      iat: Math.floor(Date.now() / 1000) + 31,
      exp: Math.floor(Date.now() / 1000) + 331,
    }),
  ],
  ["lifetime", (c) => ({ ...c, exp: (c.iat as number) + 301 })],
  ["nbf", (c) => ({ ...c, nbf: Math.floor(Date.now() / 1000) + 60 })],
  ["roles", (c) => ({ ...c, "https://miva.campus/claims/roles": [7] })],
  ["tenant", (c) => ({ ...c, "https://miva.campus/claims/tenant_id": "" })],
  [
    "installation",
    (c) => ({ ...c, "https://miva.campus/claims/installation_id": "other" }),
  ],
];
it.each(badClaims)("rejects identity %s mismatch", async (_, change) => {
  const result = await verifyToken(
    c,
    await fixture.sign(change(fixture.identity("nonce"))),
    {
      kind: "oidc",
      client: "fixture-client",
      user: "7",
      nonce: "nonce",
      installation: "fixture-install",
    },
  );
  expect(result.checks.some((c) => c.status === "failed")).toBe(true);
});
it.each(["HS256", "none"])(
  "rejects algorithm substitution %s without identity checks",
  async (alg) => {
    const real = await fixture.sign(fixture.identity("nonce"));
    const token =
      Buffer.from(JSON.stringify({ alg, kid: fixture.jwk.kid })).toString(
        "base64url",
      ) +
      "." +
      real.split(".").slice(1).join(".");
    const result = await verifyToken(c, token, {
      kind: "oidc",
      client: "fixture-client",
      user: "7",
      nonce: "nonce",
    });
    expect(result.verified).toBe(false);
    expect(result.checks.find((c) => c.name === "Subject")?.status).toBe(
      "not_run",
    );
  },
);
it.each([
  "jwks_redirect",
  "jwks_oversized",
  "jwks_private",
  "jwks_duplicate",
  "jwks_malformed",
])("blocks unsafe JWKS %s", async (mode) => {
  fixture.setMode(mode);
  await expect(platformKeys(c)).rejects.toThrow();
  const u = new URL(
    startLaunch(c, s, { login_hint: "7", reference: "opaque" }),
  );
  const run = await callback(
    c,
    s,
    u.searchParams.get("state")!,
    await fixture.sign(fixture.identity(u.searchParams.get("nonce")!)),
  );
  expect(run.status).toBe("blocked");
});
it.each(scenarios)(
  "executes OAuth scenario %s against real HTTP/signatures",
  async (scenario) => {
    const run = await runOAuth(c, s, keys, {
      scenario,
      scope: "campus.webhooks.write",
    });
    expect(run.status).toBe("passed");
    expect(run.exchanges?.at(-1)?.status).toBe(run.expected?.status);
    if (scenario === "jti_replay") {
      expect(fixture.requests()).toHaveLength(2);
      expect(fixture.requests()[0].get("client_assertion")).toBe(
        fixture.requests()[1].get("client_assertion"),
      );
    }
    expect(JSON.stringify(run)).not.toContain("SENTINEL");
    expect(JSON.stringify(run)).not.toContain(
      fixture.requests()[0].get("client_assertion")!,
    );
  },
);
it("blocks replay when 200 {} did not issue a fully verified token", async () => {
  fixture.setMode("empty_first");
  const run = await runOAuth(c, s, keys, {
    scenario: "jti_replay",
    scope: "campus.webhooks.write",
  });
  expect(run.status).toBe("blocked");
  expect(fixture.requests()).toHaveLength(1);
});
it.each(["rate_limit", "non_json", "server_error", "redirect"])(
  "preserves blocked upstream evidence for %s without retries",
  async (mode) => {
    fixture.setMode(mode);
    const run = await runOAuth(c, s, keys, {
      scenario: "valid",
      scope: "campus.webhooks.write",
    });
    expect(run.status).toBe("blocked");
    expect(fixture.requests()).toHaveLength(1);
    expect(JSON.stringify(run)).not.toContain("SENTINEL");
    if (mode === "rate_limit") {
      expect(run.exchanges?.[0].status).toBe(429);
      expect(run.exchanges?.[0].rateLimit["retry-after"]).toBe("60");
    }
  },
);
it("derives supported successful scope from the request and reports unsupported scope truthfully", async () => {
  const good = await runOAuth(c, s, keys, {
    scenario: "valid",
    scope: "unsupported campus.webhooks.write",
  });
  expect(good.status).toBe("passed");
  const bad = await runOAuth(c, s, keys, {
    scenario: "valid",
    scope: "unsupported",
  });
  expect(bad.status).toBe("failed");
  expect(bad.exchanges?.[0].error).toBe("invalid_scope");
});
it.each(["bad_envelope", "bad_binding", "bad_lifetime"])(
  "rejects invalid service token %s",
  async (mode) => {
    fixture.setMode(mode);
    if (mode === "bad_binding")
      fixture.changeToken((c) => ({ ...c, client_id: "foreign" }));
    if (mode === "bad_lifetime")
      fixture.changeToken((c) => ({ ...c, exp: (c.iat as number) + 300 }));
    const run = await runOAuth(c, s, keys, {
      scenario: "valid",
      scope: "campus.webhooks.write",
    });
    expect(run.status).toBe("failed");
  },
);
it("pins resolved localhost DNS without allowing auto-select to bypass address validation", async () => {
  const local = {
    ...c,
    campusBase: c.campusBase.replace("127.0.0.1", "localhost"),
  };
  expect(await platformKeys(local)).toHaveLength(1);
});
it("blocks a JWKS timeout and does not retry", async () => {
  fixture.setMode("jwks_timeout");
  await expect(platformKeys(c)).rejects.toThrow();
}, 7000);
it("never trusts claims from a tampered signature or unknown kid", async () => {
  const signed = await fixture.sign(fixture.identity("nonce"));
  for (const token of [
    signed.slice(0, -20) + "A".repeat(20),
    await fixture.sign(fixture.identity("nonce"), { kid: "unknown" }),
  ]) {
    const result = await verifyToken(c, token, {
      kind: "oidc",
      client: "fixture-client",
      user: "7",
      nonce: "nonce",
    });
    expect(result.verified).toBe(false);
    expect(result.checks.find((c) => c.name === "Subject")?.status).toBe(
      "not_run",
    );
  }
});
it("does not follow token-controlled jku or x5u destinations", async () => {
  const result = await verifyToken(
    c,
    await fixture.sign(fixture.identity("nonce"), {
      jku: "http://169.254.169.254/private",
      x5u: "http://127.0.0.1/private",
    }),
    {
      kind: "oidc",
      client: "fixture-client",
      user: "7",
      nonce: "nonce",
      installation: "fixture-install",
    },
  );
  expect(result.checks.every((c) => c.status === "passed")).toBe(true);
});
it("preserves JWKS rate-limit evidence when token verification is blocked", async () => {
  fixture.setMode("jwks_rate_limit");
  const u = new URL(
    startLaunch(c, s, { login_hint: "7", reference: "opaque" }),
  );
  const run = await callback(
    c,
    s,
    u.searchParams.get("state")!,
    await fixture.sign(fixture.identity(u.searchParams.get("nonce")!)),
  );
  expect(run.status).toBe("blocked");
  expect(run.exchanges?.[0]).toMatchObject({
    endpoint: "jwks",
    status: 429,
    rateLimit: { "retry-after": "60" },
  });
});
it("never reports a persisted success after SQLite rejects evidence", async () => {
  const u = new URL(
    startLaunch(c, s, { login_hint: "7", reference: "opaque" }),
  );
  s.db.exec(
    "CREATE TEMP TRIGGER fail_run BEFORE INSERT ON runs BEGIN SELECT RAISE(ABORT, 'storage unavailable'); END",
  );
  try {
    const { handle } = await import("@/server/http");
    const { vi } = await import("vitest");
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await handle(async () =>
      Response.json(
        await callback(
          c,
          s,
          u.searchParams.get("state")!,
          await fixture.sign(fixture.identity(u.searchParams.get("nonce")!)),
        ),
      ),
    );
    expect(response.status).toBe(500);
    expect((await response.json()).message).toBe("Unexpected server error");
    log.mockRestore();
    expect(s.consumeLaunch(u.searchParams.get("state")!)).toBeUndefined();
  } finally {
    s.db.exec("DROP TRIGGER fail_run");
  }
});
