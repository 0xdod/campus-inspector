import "server-only";
import { z } from "zod";
import { readConfig, type Config } from "@/server/config";
import type { AppProfile, ProfileInput, Registration } from "@/lib/contracts";
import type { Store } from "@/server/db/store";
import { fail, textID } from "@/server/http";
export const profileSchema = z
  .object({
    name: z.string().trim().min(1, "A profile name is required").max(80),
    campusBase: z.string().min(1).max(2048),
    issuer: z.string().min(1).max(2048),
    client_id: textID,
    installation_id: textID.optional(),
  })
  .strict();
export function profileConfig(
  base: Config,
  profile: AppProfile,
): Config & { profile: AppProfile } {
  return {
    ...base,
    campusBase: profile.campusBase,
    issuer: profile.issuer,
    profile,
  };
}
export type ProfileConfig = Config & { profile?: AppProfile };
export function saveProfile(
  base: Config,
  s: Store,
  input: unknown,
  id?: string,
) {
  const parsed = profileSchema.parse(input);
  const env = {
    PUBLIC_URL: base.publicUrl,
    CAMPUS_BASE_URL: base.campusBase,
    CAMPUS_ISSUER: base.issuer,
    INSPECTOR_PASSWORD: base.password,
    ALLOW_LOCAL_HTTP: String(base.local),
    DATA_DIR: base.dataDir,
  };
  for (const [field, variable] of [
    ["campusBase", "CAMPUS_BASE_URL"],
    ["issuer", "CAMPUS_ISSUER"],
  ] as const) {
    try {
      readConfig({ ...env, [variable]: parsed[field] });
    } catch {
      fail(
        400,
        field,
        `${field} must be an absolute HTTPS URL without credentials, query parameters or a fragment; loopback HTTP requires ALLOW_LOCAL_HTTP=true`,
      );
    }
  }
  return s.saveProfile(
    { ...parsed, campusBase: parsed.campusBase.replace(/\/+$/, "") },
    id,
  );
}
export function saveRegistrationProfile(c: Config, s: Store, r: Registration) {
  return s.db.transaction(() => {
    s.importRegistration(c);
    const existing = s
      .profiles()
      .find(
        (p) =>
          p.campusBase === c.campusBase &&
          p.issuer === c.issuer &&
          p.client_id === r.client_id &&
          (p.installation_id || "") === (r.installation_id || ""),
      );
    const profile =
      existing ||
      saveProfile(c, s, {
        name: `App ${r.client_id}`.slice(0, 80),
        campusBase: c.campusBase,
        issuer: c.issuer,
        ...r,
      } satisfies ProfileInput);
    s.activateProfile(profile.id);
    return profile;
  })();
}
