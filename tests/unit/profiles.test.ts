import { beforeEach, afterEach, it, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Store } from "@/server/db/store";
import { readConfig } from "@/server/config";
import {
  profileConfig,
  saveProfile,
  saveRegistrationProfile,
} from "@/server/profiles/service";
let dir: string, s: Store;
const config = readConfig({
  PUBLIC_URL: "https://inspector.example",
  CAMPUS_BASE_URL: "https://campus.example/api/backend",
  CAMPUS_ISSUER: "https://issuer.example/",
  INSPECTOR_PASSWORD: "fixture-only-password",
});
const first = {
  name: "Campus staging",
  campusBase: config.campusBase,
  issuer: config.issuer,
  client_id: "client-one",
  installation_id: "install-one",
};
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "profiles-"));
  s = new Store(dir);
});
afterEach(() => {
  s.close();
  rmSync(dir, { force: true, recursive: true });
});
it("saves, lists, edits and activates profiles without overwriting earlier apps", () => {
  const a = saveProfile(config, s, first);
  const b = saveProfile(config, s, {
    ...first,
    name: "Other platform",
    campusBase: "https://other.example",
    issuer: "https://other-issuer.example",
    client_id: "client-two",
  });
  expect(s.profiles()).toHaveLength(2);
  s.activateProfile(a.id);
  expect(s.registration().client_id).toBe("client-one");
  const updated = saveProfile(
    config,
    s,
    { ...first, name: "Renamed staging", installation_id: undefined },
    a.id,
  );
  expect(updated.id).toBe(a.id);
  expect(s.profile(a.id)?.installation_id).toBeUndefined();
  expect(s.profile(b.id)?.client_id).toBe("client-two");
  expect(s.activeProfile()?.name).toBe("Renamed staging");
});
it("migrates the existing registration exactly once and persists selection across restart", () => {
  s.setRegistration({
    client_id: "legacy-client",
    installation_id: "legacy-install",
  });
  s.importRegistration(config);
  const imported = s.activeProfile()!;
  expect(imported.client_id).toBe("legacy-client");
  expect(imported.campusBase).toBe(config.campusBase);
  s.importRegistration(config);
  expect(s.profiles()).toHaveLength(1);
  s.close();
  s = new Store(dir);
  s.importRegistration(config);
  expect(s.activeProfile()?.id).toBe(imported.id);
});
it("keeps previous saves through the compatibility registration endpoint", () => {
  const a = saveRegistrationProfile(config, s, { client_id: "client-one" });
  const b = saveRegistrationProfile(config, s, { client_id: "client-two" });
  expect(s.profiles()).toHaveLength(2);
  expect(s.activeProfile()?.id).toBe(b.id);
  expect(
    saveRegistrationProfile(config, s, { client_id: "client-one" }).id,
  ).toBe(a.id);
  expect(s.profiles()).toHaveLength(2);
});
it("rejects malformed, unsafe or unknown profiles without changing selection", () => {
  const a = saveProfile(config, s, first);
  s.activateProfile(a.id);
  for (const campusBase of [
    "http://public.example",
    "https://user:secret@campus.example",
    "https://campus.example?token=private",
  ])
    expect(() => saveProfile(config, s, { ...first, campusBase })).toThrow();
  expect(() => saveProfile(config, s, { ...first, client_id: 4 })).toThrow();
  expect(() => s.activateProfile("missing")).toThrow("not found");
  expect(() => saveProfile(config, s, first, "missing")).toThrow("not found");
  expect(s.activeProfile()?.id).toBe(a.id);
  expect(s.profiles()).toHaveLength(1);
});
it("captures an immutable environment and registration for each request", () => {
  const a = saveProfile(config, s, first);
  const selected = profileConfig(config, a);
  saveProfile(
    config,
    s,
    { ...first, issuer: "https://changed.example/", client_id: "changed" },
    a.id,
  );
  expect(selected.issuer).toBe(config.issuer);
  expect(selected.profile?.client_id).toBe("client-one");
  expect(selected.password).toBe(config.password);
});
it("upgrades a database with only the original schema without losing history or registration", () => {
  s.setRegistration({ client_id: "pre-upgrade-client" });
  s.saveRun({
    id: "pre-upgrade-run",
    kind: "oauth",
    status: "blocked",
    createdAt: new Date().toISOString(),
    checks: [],
  });
  s.db.exec(
    "DROP TABLE active_profile; DROP TABLE app_profiles; DELETE FROM schema_migrations WHERE version=2",
  );
  s.close();
  s = new Store(dir);
  s.importRegistration(config);
  expect(s.activeProfile()?.client_id).toBe("pre-upgrade-client");
  expect(s.run("pre-upgrade-run")?.status).toBe("blocked");
  expect(
    s.db
      .prepare("SELECT version FROM schema_migrations ORDER BY version")
      .all(),
  ).toEqual([{ version: 1 }, { version: 2 }]);
});
it("bounds saved profiles without deleting old entries and still permits edits at capacity", () => {
  for (let i = 0; i < 200; i++)
    s.saveProfile({ ...first, name: `App ${i}`, client_id: `client-${i}` });
  expect(() => saveProfile(config, s, first)).toThrow("At most 200");
  const existing = s.profiles()[0];
  expect(
    saveProfile(
      config,
      s,
      { ...first, name: "Edited at capacity" },
      existing.id,
    ).id,
  ).toBe(existing.id);
  expect(s.profiles()).toHaveLength(200);
});
