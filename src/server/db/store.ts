import "server-only";
import Database from "better-sqlite3";
import { mkdirSync, readFileSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { fail } from "@/server/http";
import type {
  InspectionResult,
  Registration,
  AppProfile,
  ProfileInput,
} from "@/lib/contracts";
export const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export const secret = () => randomBytes(32).toString("base64url");
export type LaunchSnapshot = {
  created: number;
  user: string;
  client: string;
  installation?: string;
  nonce: string;
  expires: number;
  campusBase?: string;
  issuer?: string;
  profile?: InspectionResult["profile"];
};
export class Store {
  readonly db: Database.Database;
  constructor(dir: string) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    chmodSync(dir, 0o700);
    const path = join(dir, "inspector.sqlite");
    this.db = new Database(path);
    chmodSync(path, 0o600);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("busy_timeout = 5000");
    this.db.pragma("secure_delete = ON");
    this.db.exec(
      readFileSync(join(process.cwd(), "migrations/001_initial.sql"), "utf8"),
    );
    this.db.exec(
      readFileSync(
        join(process.cwd(), "migrations/002_app_profiles.sql"),
        "utf8",
      ),
    );
    this.db.pragma("foreign_keys = ON");
    this.prune();
  }
  close() {
    this.db.close();
  }
  prune(now = Date.now()) {
    this.db.transaction(() => {
      for (const table of ["launches", "sessions", "quotas"])
        this.db.prepare(`DELETE FROM ${table} WHERE expires <= ?`).run(now);
      this.db
        .prepare("DELETE FROM runs WHERE created <= ?")
        .run(now - 86400000);
      this.db
        .prepare(
          "DELETE FROM runs WHERE id NOT IN (SELECT id FROM runs ORDER BY created DESC, rowid DESC LIMIT 200)",
        )
        .run();
    })();
  }
  profiles(): AppProfile[] {
    const rows = this.db
      .prepare(
        "SELECT id,name,campus_base AS campusBase,issuer,client AS client_id,installation AS installation_id,created AS createdAt,updated AS updatedAt FROM app_profiles ORDER BY updated DESC,rowid DESC",
      )
      .all() as (AppProfile & { installation_id: string | null })[];
    return rows.map(({ installation_id, ...row }) => ({
      ...row,
      ...(installation_id ? { installation_id } : {}),
    }));
  }
  profile(id: string) {
    return this.profiles().find((p) => p.id === id);
  }
  activeProfile() {
    const row = this.db
      .prepare("SELECT profile_id FROM active_profile WHERE id=1")
      .get() as { profile_id: string } | undefined;
    return row ? this.profile(row.profile_id) : undefined;
  }
  saveProfile(input: ProfileInput, id?: string) {
    return this.db.transaction(() => {
      if (id && !this.profile(id)) fail(404, "id", "Saved profile not found");
      if (!id && this.profiles().length >= 200)
        fail(422, "profiles", "At most 200 saved profiles are supported");
      const profileId = id || randomUUID(),
        now = new Date().toISOString();
      this.db
        .prepare(
          "INSERT INTO app_profiles VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,campus_base=excluded.campus_base,issuer=excluded.issuer,client=excluded.client,installation=excluded.installation,updated=excluded.updated",
        )
        .run(
          profileId,
          input.name,
          input.campusBase,
          input.issuer,
          input.client_id,
          input.installation_id || null,
          now,
          now,
        );
      return this.profile(profileId)!;
    })();
  }
  activateProfile(id: string) {
    return this.db.transaction(() => {
      const profile = this.profile(id);
      if (!profile) fail(404, "profile_id", "Saved profile not found");
      this.db
        .prepare(
          "INSERT INTO active_profile VALUES (1,?) ON CONFLICT(id) DO UPDATE SET profile_id=excluded.profile_id",
        )
        .run(id);
      return profile;
    })();
  }
  importRegistration(config: { campusBase: string; issuer: string }) {
    this.db.transaction(() => {
      if (this.profiles().length) return;
      const registration = this.registration();
      if (!registration.client_id) return;
      const profile = this.saveProfile({
        ...config,
        ...registration,
        name: "Imported app",
      });
      this.activateProfile(profile.id);
    })();
  }
  registration(): Registration {
    const selected = this.activeProfile();
    if (selected)
      return {
        client_id: selected.client_id,
        ...(selected.installation_id
          ? { installation_id: selected.installation_id }
          : {}),
      };
    const r = this.db
      .prepare("SELECT client,installation FROM registration WHERE id=1")
      .get() as { client: string; installation: string | null } | undefined;
    return r
      ? {
          client_id: r.client,
          ...(r.installation ? { installation_id: r.installation } : {}),
        }
      : { client_id: "" };
  }
  setRegistration(r: Registration) {
    this.db
      .prepare(
        "INSERT INTO registration VALUES (1,?,?) ON CONFLICT(id) DO UPDATE SET client=excluded.client,installation=excluded.installation",
      )
      .run(r.client_id, r.installation_id || null);
    this.prune();
  }
  addLaunch(state: string, snapshot: LaunchSnapshot) {
    this.prune();
    this.db
      .prepare("INSERT INTO launches VALUES (?,?,?)")
      .run(hash(state), JSON.stringify(snapshot), snapshot.expires);
  }
  consumeLaunch(state: string, now = Date.now()): LaunchSnapshot | undefined {
    const row = this.db
      .prepare(
        "DELETE FROM launches WHERE state_hash=? RETURNING snapshot,expires",
      )
      .get(hash(state)) as { snapshot: string; expires: number } | undefined;
    return row && row.expires > now
      ? (JSON.parse(row.snapshot) as LaunchSnapshot)
      : undefined;
  }
  newSession(previous?: string) {
    const token = secret(),
      csrf = secret();
    this.db.transaction(() => {
      if (previous)
        this.db
          .prepare("DELETE FROM sessions WHERE token_hash=?")
          .run(hash(previous));
      this.db
        .prepare("INSERT INTO sessions VALUES (?,?,?)")
        .run(hash(token), csrf, Date.now() + 28800000);
      this.prune();
    })();
    return { token, csrf };
  }
  session(token: string) {
    return this.db
      .prepare("SELECT csrf FROM sessions WHERE token_hash=? AND expires>?")
      .get(hash(token), Date.now()) as { csrf: string } | undefined;
  }
  revoke(token: string) {
    this.db.prepare("DELETE FROM sessions WHERE token_hash=?").run(hash(token));
  }
  quota(bucket: string, max: number, windowMs = 60000) {
    this.prune();
    return this.db.transaction(() => {
      const r = this.db
        .prepare(
          "INSERT INTO quotas VALUES (?,1,?) ON CONFLICT(bucket) DO UPDATE SET count=count+1 RETURNING count",
        )
        .get(bucket, Date.now() + windowMs) as { count: number };
      return r.count <= max;
    })();
  }
  saveRun(run: InspectionResult) {
    this.db.transaction(() => {
      this.db
        .prepare("INSERT INTO runs VALUES (?,?,?)")
        .run(run.id, Date.parse(run.createdAt), JSON.stringify(run));
      this.prune();
    })();
    return run;
  }
  history(now = Date.now()): InspectionResult[] {
    return (
      this.db
        .prepare(
          "SELECT evidence FROM runs WHERE created>? ORDER BY created DESC, rowid DESC LIMIT 200",
        )
        .all(now - 86400000) as { evidence: string }[]
    ).map((r) => JSON.parse(r.evidence) as InspectionResult);
  }
  run(id: string) {
    return this.history().find((r) => r.id === id);
  }
}
