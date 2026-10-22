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
      s.close();
      const restart = new Store(dir);
      expect(restart.registration().client_id).toBe("fixture-client");
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
