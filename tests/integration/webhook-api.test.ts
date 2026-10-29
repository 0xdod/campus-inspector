import { beforeAll, afterAll, beforeEach, it, expect, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "@/server/db/store";
import { readConfig } from "@/server/config";
import { loadKeys } from "@/server/crypto/keys";
import { fixtureCampus } from "../fixtures/campus";
const shared = vi.hoisted(() => ({ runtime: vi.fn() }));
vi.mock("@/server/runtime", () => ({ runtime: shared.runtime }));
import { api } from "@/server/api";
let dir: string,
  store: Store,
  fixture: Awaited<ReturnType<typeof fixtureCampus>>,
  session: { token: string; csrf: string };
beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "webhook-api-"));
  store = new Store(dir);
  const keys = await loadKeys(dir);
  fixture = await fixtureCampus({ appJWK: keys.jwk });
  const config = readConfig({
    PUBLIC_URL: "http://localhost:8090",
    CAMPUS_BASE_URL: fixture.base + "/api/backend",
    CAMPUS_ISSUER: fixture.issuer,
    ALLOW_LOCAL_HTTP: "true",
    INSPECTOR_PASSWORD: "fixture-only-password",
  });
  shared.runtime.mockResolvedValue({ config, store, keys });
  session = store.newSession();
  store.setRegistration({
    client_id: "fixture-client",
    installation_id: "fixture-install",
  });
});
afterAll(async () => {
  await fixture.close();
  store.close();
  rmSync(dir, { force: true, recursive: true });
});
beforeEach(() => {
  store.db.prepare("DELETE FROM quotas").run();
  fixture.setMode("normal");
});
const headers = () => ({
  "content-type": "application/json",
  origin: "http://localhost:8090",
  cookie: `inspector_session=${session.token}`,
  "x-csrf-token": session.csrf,
});
const req = (body: string, h: HeadersInit = headers(), method = "POST") =>
  new Request("http://localhost:8090/api/webhooks", {
    method,
    headers: h,
    ...(method === "POST" ? { body } : {}),
  });
it("requires a signed-in operator and CSRF before upstream calls", async () => {
  expect(
    (await api(req("{}", { "content-type": "application/json" }))).status,
  ).toBe(401);
  expect(
    (await api(req("{}", { ...headers(), "x-csrf-token": "wrong" }))).status,
  ).toBe(403);
  expect(
    (await api(req("{}", { ...headers(), origin: "https://foreign.example" })))
      .status,
  ).toBe(403);
  expect(fixture.requests()).toHaveLength(0);
  expect(fixture.webhooks()).toHaveLength(0);
});
it("advertises only POST", async () => {
  const res = await api(req("", headers(), "GET"));
  expect(res.status).toBe(405);
  expect(res.headers.get("allow")).toBe("POST");
});
it.each([
  "{bad",
  '{"scenario":4}',
  '{"scenario":"valid","body":4}',
  '{"scenario":"unknown"}',
])(
  "rejects invalid local control requests before contacting Campus",
  async (body) => {
    const res = await api(req(body));
    expect(res.status).toBe(400);
    expect((await res.json()).errors[0].field).toBeDefined();
    expect(fixture.requests()).toHaveLength(0);
  },
);
it("forwards an oversized Campus event and reports the upstream 413 inside a saved inspection", async () => {
  const res = await api(req(JSON.stringify({ scenario: "over_limit" })));
  expect(res.status).toBe(200);
  const run = await res.json();
  expect(run.status).toBe("passed");
  expect(run.exchanges.at(-1)).toMatchObject({
    endpoint: "webhook",
    status: 413,
  });
  expect(res.headers.get("cache-control")).toBe("no-store");
});
it("rejects oversized control wrappers without upstream traffic", async () => {
  const res = await api(
    req(
      JSON.stringify({ scenario: "valid", body: "x".repeat(2 * 1024 * 1024) }),
    ),
  );
  expect(res.status).toBe(400);
  expect(fixture.requests()).toHaveLength(0);
});
it("distinguishes the local operator quota from Campus rate limits", async () => {
  for (let i = 0; i < 10; i++) store.quota("operator-webhooks", 10);
  const res = await api(req('{"scenario":"valid"}'));
  expect(res.status).toBe(429);
  expect((await res.json()).errors[0].field).toBe("quota");
  expect(fixture.requests()).toHaveLength(0);
});

it("rejects a multibyte event over the Inspector cap before token issuance", async () => {
  const res = await api(
    req(JSON.stringify({ scenario: "valid", body: "é".repeat(150001) })),
  );
  expect(res.status).toBe(400);
  expect((await res.json()).errors[0].field).toBe("body");
  expect(fixture.requests()).toHaveLength(0);
  expect(fixture.webhooks()).toHaveLength(0);
});
