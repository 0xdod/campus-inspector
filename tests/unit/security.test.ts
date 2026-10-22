import { it, expect } from "vitest";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadKeys } from "@/server/crypto/keys";
import { Store } from "@/server/db/store";
import { readConfig } from "@/server/config";
import { mutation, sessionCookie } from "@/server/auth/auth";
import {
  exportEvidence,
  safeClaims,
  safeEnvelope,
} from "@/server/evidence/redaction";
import { forbiddenAddress } from "@/server/campus/client";
it("persists only a dedicated private key and publishes a stable public JWK", async () => {
  const dir = mkdtempSync(join(tmpdir(), "keys-"));
  try {
    const first = await loadKeys(dir),
      again = await loadKeys(dir);
    expect(first.jwk).toEqual(again.jwk);
    expect(Object.keys(first.jwk).sort()).toEqual([
      "alg",
      "e",
      "kid",
      "kty",
      "n",
      "use",
    ]);
    expect(statSync(join(dir, "app-signing.pem")).mode & 0o777).toBe(0o600);
  } finally {
    rmSync(dir, { force: true, recursive: true });
  }
});
it("hashes and revokes sessions; mutations require origin and CSRF", () => {
  const dir = mkdtempSync(join(tmpdir(), "auth-"));
  const s = new Store(dir);
  try {
    const c = readConfig({
      PUBLIC_URL: "https://inspector.example",
      CAMPUS_BASE_URL: "https://campus.example",
      CAMPUS_ISSUER: "https://issuer.example",
      INSPECTOR_PASSWORD: "fixture-only-password",
    });
    const session = s.newSession();
    expect(
      readFileSync(join(dir, "inspector.sqlite")).includes(
        Buffer.from(session.token),
      ),
    ).toBe(false);
    const req = (origin: string, csrf: string) =>
      new Request(c.publicUrl, {
        headers: {
          origin,
          "x-csrf-token": csrf,
          cookie: `inspector_session=${session.token}`,
        },
      });
    expect(() =>
      mutation(req("https://evil.example", session.csrf), c, s),
    ).toThrow();
    expect(() => mutation(req(c.publicUrl, "wrong"), c, s)).toThrow();
    expect(mutation(req(c.publicUrl, session.csrf), c, s).csrf).toBe(
      session.csrf,
    );
    expect(sessionCookie(c, session.token)).toContain("; Secure");
    s.revoke(session.token);
    expect(s.session(session.token)).toBeUndefined();
    for (let i = 0; i < 5; i++) expect(s.quota("signin", 5)).toBe(true);
    expect(s.quota("signin", 5)).toBe(false);
  } finally {
    s.close();
    rmSync(dir, { force: true, recursive: true });
  }
});
it("redacts credential fields, unknown claims, reflected upstream text and export context", () => {
  const sentinel = "SENTINEL-CREDENTIAL";
  expect(
    JSON.stringify(
      safeClaims({
        nonce: sentinel,
        jti: sentinel,
        email: sentinel,
        name: sentinel,
        unknown: sentinel,
        sub: "7",
      }),
    ),
  ).not.toContain(sentinel);
  expect(
    JSON.stringify(
      safeEnvelope({
        error: "invalid_client",
        error_description: sentinel,
        access_token: sentinel,
      }),
    ),
  ).not.toContain(sentinel);
  expect(
    JSON.stringify(
      exportEvidence([
        {
          id: "a",
          kind: "oidc",
          status: "failed",
          createdAt: new Date().toISOString(),
          checks: [],
          claims: { sub: sentinel },
          request: { user: sentinel },
        },
      ]),
    ),
  ).not.toContain(sentinel);
});
it("rejects private, reserved and mapped network addresses", () => {
  for (const addr of [
    "127.0.0.1",
    "10.1.1.1",
    "169.254.169.254",
    "192.168.1.1",
    "::1",
    "::ffff:127.0.0.1",
    "fc00::1",
    "2002:7f00:1::",
  ])
    expect(forbiddenAddress(addr), addr).toBe(true);
  expect(forbiddenAddress("8.8.8.8")).toBe(false);
});
