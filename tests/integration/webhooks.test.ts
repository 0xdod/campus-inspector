import { beforeAll, afterAll, beforeEach, it, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "@/server/db/store";
import { readConfig } from "@/server/config";
import { loadKeys } from "@/server/crypto/keys";
import { fixtureCampus } from "../fixtures/campus";
import { runWebhook, webhookSchema } from "@/server/webhooks/scenarios";
import { buildWebhookBody, webhookPresets } from "@/lib/webhooks";
import { exportEvidence } from "@/server/evidence/redaction";
let dir: string,
  store: Store,
  keys: Awaited<ReturnType<typeof loadKeys>>,
  fixture: Awaited<ReturnType<typeof fixtureCampus>>,
  config: ReturnType<typeof readConfig>;
beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "webhook-"));
  store = new Store(dir);
  keys = await loadKeys(dir);
  fixture = await fixtureCampus({ appJWK: keys.jwk });
  config = readConfig({
    PUBLIC_URL: "http://localhost:8090",
    CAMPUS_BASE_URL: fixture.base + "/api/backend",
    CAMPUS_ISSUER: fixture.issuer,
    ALLOW_LOCAL_HTTP: "true",
    INSPECTOR_PASSWORD: "fixture-only-password",
  });
});
afterAll(async () => {
  await fixture.close();
  store.close();
  rmSync(dir, { recursive: true, force: true });
});
beforeEach(() => {
  store.db.prepare("DELETE FROM active_profile").run();
  fixture.setMode("normal");
  fixture.changeToken((c) => c);
  store.setRegistration({
    client_id: "fixture-client",
    installation_id: "fixture-install",
  });
});
const input = (scenario = "valid") => webhookSchema.parse({ scenario });
it("obtains a verified token, posts a new event and persists only safe evidence", async () => {
  const body = buildWebhookBody("valid", "fixture-install");
  const raw = JSON.stringify({
    ...JSON.parse(body),
    data: { secret: "SENTINEL-PAYLOAD" },
  });
  const run = await runWebhook(
    config,
    store,
    keys,
    webhookSchema.parse({ scenario: "valid", body: raw }),
  );
  expect(run.status).toBe("passed");
  expect(fixture.webhooks()).toHaveLength(1);
  expect(fixture.webhooks()[0].body).toBe(raw);
  expect(fixture.webhooks()[0].authorization).toMatch(/^Bearer /);
  expect(run.exchanges?.map((e) => e.endpoint)).toEqual(["token", "webhook"]);
  expect(store.httpLogs().filter((l) => l.runId === run.id)).toHaveLength(3);
  const evidence = JSON.stringify([
    run,
    store.httpLogs(),
    exportEvidence([run]),
  ]);
  expect(evidence).not.toContain("SENTINEL");
  expect(evidence).not.toContain(fixture.webhooks()[0].authorization.slice(7));
});
it.each(webhookPresets.map((p) => p.id))(
  "evaluates the %s preset against HTTP",
  async (scenario) => {
    const run = await runWebhook(config, store, keys, input(scenario));
    expect(run.status).toBe("passed");
    expect(run.exchanges?.at(-1)?.status).toBe(run.expected?.status);
  },
);
it("forwards malformed raw event text without repairing it", async () => {
  const body = '{"id":"a","id":"b"} trailing';
  const run = await runWebhook(
    config,
    store,
    keys,
    webhookSchema.parse({ scenario: "malformed_json", body }),
  );
  expect(fixture.webhooks()[0].body).toBe(body);
  expect(run.status).toBe("passed");
});
it("never posts after token verification fails", async () => {
  fixture.changeToken((c) => ({ ...c, client_id: "foreign" }));
  const run = await runWebhook(config, store, keys, input());
  expect(run.status).toBe("blocked");
  expect(fixture.webhooks()).toHaveLength(0);
});
it("uses verified installation when registration omits it", async () => {
  store.setRegistration({ client_id: "fixture-client" });
  const run = await runWebhook(config, store, keys, input());
  expect(run.status).toBe("passed");
  expect(JSON.parse(fixture.webhooks()[0].body).installation_id).toBe(
    "fixture-install",
  );
});
it.each([
  "webhook_rate_limit",
  "webhook_server_error",
  "webhook_redirect",
  "webhook_non_json",
  "webhook_bad_receipt",
])("classifies %s without retry", async (mode) => {
  fixture.setMode(mode);
  const run = await runWebhook(config, store, keys, input());
  expect(run.status).toBe(
    mode === "webhook_bad_receipt" ? "failed" : "blocked",
  );
  expect(fixture.webhooks()).toHaveLength(1);
  expect(JSON.stringify([run, store.httpLogs()])).not.toContain("SENTINEL");
  if (mode === "webhook_rate_limit")
    expect(run.exchanges?.at(-1)?.rateLimit["retry-after"]).toBe("60");
});
it("blocks token endpoint errors before sending any event", async () => {
  fixture.setMode("rate_limit");
  const run = await runWebhook(config, store, keys, input());
  expect(run.status).toBe("blocked");
  expect(fixture.webhooks()).toHaveLength(0);
});
it("builds exact UTF-8 boundaries and normalizes optional null presets", () => {
  expect(
    Buffer.byteLength(buildWebhookBody("exact_limit", "fixture-install")),
  ).toBe(262144);
  expect(
    Buffer.byteLength(buildWebhookBody("over_limit", "fixture-install")),
  ).toBe(262145);
  expect(
    JSON.parse(buildWebhookBody("null_actor_subject", "fixture-install")),
  ).toMatchObject({ actor: null, subject: null });
});

it("keeps a run bound to the captured profile after selection changes", async () => {
  const { saveProfile, profileConfig } =
    await import("@/server/profiles/service");
  const original = saveProfile(config, store, {
    name: "Webhook original",
    campusBase: config.campusBase,
    issuer: config.issuer,
    client_id: "fixture-client",
    installation_id: "fixture-install",
  });
  const other = saveProfile(config, store, {
    name: "Webhook other",
    campusBase: "http://127.0.0.1:1",
    issuer: "https://other.example",
    client_id: "other",
  });
  const snapshot = profileConfig(config, original);
  store.activateProfile(other.id);
  const run = await runWebhook(snapshot, store, keys, input());
  expect(run.status).toBe("passed");
  expect(run.profile?.id).toBe(original.id);
  expect(exportEvidence([run])[0]).not.toHaveProperty("profile");
});
it("marks an interrupted send unknown and never retries", async () => {
  fixture.setMode("webhook_timeout");
  const run = await runWebhook(config, store, keys, input());
  expect(run.status).toBe("blocked");
  expect(fixture.webhooks()).toHaveLength(1);
  expect(run.checks.at(-1)?.name).toBe("Receipt unknown");
  expect(run.request?.event_id).toMatch(/^qa-/);
  const log = store
    .httpLogs()
    .find((l) => l.runId === run.id && l.kind === "webhook");
  expect(log?.outcome).toBe("unavailable");
  expect(log?.response).toBeUndefined();
}, 7000);
