import { describe, it, expect } from "vitest";
import { readConfig, campusURL, audience } from "@/server/config";
import { Store } from "@/server/db/store";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const env = {
  PUBLIC_URL: "http://localhost:8090",
  CAMPUS_BASE_URL: "http://localhost:8081/api/backend/",
  CAMPUS_ISSUER: "https://issuer.example/",
  INSPECTOR_PASSWORD: "test-only-long-password",
  ALLOW_LOCAL_HTTP: "true",
};
describe("configuration", () => {
  it("keeps issuer exact and appends gateway paths", () => {
    const c = readConfig(env);
    expect(c.issuer).toBe(env.CAMPUS_ISSUER);
    expect(campusURL(c, "/apps/oidc/login")).toBe(
      "http://localhost:8081/api/backend/apps/oidc/login",
    );
    expect(audience(c, "/apps/oauth2/token")).toBe(
      "https://issuer.example/apps/oauth2/token",
    );
  });
  it("requires HTTPS or explicit loopback opt-in and strong password", () => {
    expect(() => readConfig({ ...env, ALLOW_LOCAL_HTTP: "false" })).toThrow();
    expect(() =>
      readConfig({ ...env, PUBLIC_URL: "http://public.example" }),
    ).toThrow();
    expect(() => readConfig({ ...env, INSPECTOR_PASSWORD: "short" })).toThrow();
  });
});
describe("durable storage", () => {
  it("preserves registration and allows exactly one of ten consumes", async () => {
    const dir = mkdtempSync(join(tmpdir(), "inspector-"));
    const s = new Store(dir);
    try {
      s.setRegistration({
        client_id: "fixture-client",
        installation_id: "fixture-install",
      });
      s.addLaunch("state-secret", {
        created: Date.now(),
        user: "7",
        client: "fixture-client",
        installation: "fixture-install",
        nonce: "nonce-secret",
        expires: Date.now() + 300000,
      });
      const outcomes = await Promise.all(
        Array.from({ length: 10 }, async () => s.consumeLaunch("state-secret")),
      );
      expect(outcomes.filter(Boolean)).toHaveLength(1);
      expect(s.db.prepare("SELECT * FROM launches").all()).toHaveLength(0);
      const session = s.newSession();
      s.saveRun({
        id: "fixture-durable-run",
        kind: "oidc",
        status: "blocked",
        createdAt: new Date().toISOString(),
        checks: [],
      });
      s.close();
      const restart = new Store(dir);
      expect(restart.registration().client_id).toBe("fixture-client");
      expect(restart.session(session.token)?.csrf).toBe(session.csrf);
      expect(restart.run("fixture-durable-run")?.status).toBe("blocked");
      restart.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it("expires history and limits runs to 200", () => {
    const dir = mkdtempSync(join(tmpdir(), "inspector-"));
    const s = new Store(dir);
    try {
      for (let i = 0; i < 205; i++)
        s.saveRun({
          id: String(i),
          kind: "oauth",
          status: "passed",
          createdAt: new Date().toISOString(),
          checks: [],
        });
      expect(s.history()).toHaveLength(200);
      expect(s.history(Date.now() + 86400001)).toHaveLength(0);
    } finally {
      s.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
it("expires sessions and launch snapshots and physically prunes stale records", () => {
  const dir = mkdtempSync(join(tmpdir(), "expiry-"));
  const s = new Store(dir);
  try {
    const session = s.newSession();
    s.addLaunch("expired-state", {
      created: Date.now() - 300001,
      user: "7",
      client: "fixture-client",
      nonce: "private-nonce",
      expires: Date.now() - 1,
    });
    expect(s.consumeLaunch("expired-state")).toBeUndefined();
    s.db.prepare("UPDATE sessions SET expires=?").run(Date.now() - 1);
    expect(s.session(session.token)).toBeUndefined();
    s.prune();
    expect(s.db.prepare("SELECT count(*) AS n FROM sessions").get()).toEqual({
      n: 0,
    });
    expect(s.db.prepare("SELECT count(*) AS n FROM launches").get()).toEqual({
      n: 0,
    });
  } finally {
    s.close();
    rmSync(dir, { force: true, recursive: true });
  }
});
it("appends a direct backend path without changing the issuer", () => {
  const c = readConfig({ ...env, CAMPUS_BASE_URL: "http://localhost:8081" });
  expect(campusURL(c, "/.well-known/jwks.json")).toBe(
    "http://localhost:8081/.well-known/jwks.json",
  );
});
it("canonicalizes the public origin while preserving exact issuer", () => {
  const c = readConfig({
    ...env,
    PUBLIC_URL: "https://Inspector.Example:443/",
    CAMPUS_ISSUER: "https://Issuer.Example/",
  });
  expect(c.publicUrl).toBe("https://inspector.example");
  expect(c.issuer).toBe("https://Issuer.Example/");
});
