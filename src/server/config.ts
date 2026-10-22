import "server-only";
import { resolve } from "node:path";
export type Config = {
  publicUrl: string;
  campusBase: string;
  issuer: string;
  password: string;
  dataDir: string;
  local: boolean;
};
export function loopback(host: string) {
  return ["localhost", "127.0.0.1", "[::1]", "::1"].includes(host);
}
export function readConfig(
  env: Record<string, string | undefined> = process.env,
): Config {
  const local = env.ALLOW_LOCAL_HTTP === "true";
  function url(name: string, origin = false) {
    const raw = env[name];
    if (!raw) throw new Error(`Missing ${name}`);
    let u: URL;
    try {
      u = new URL(raw);
    } catch {
      throw new Error(`Invalid ${name}`);
    }
    if (
      u.username ||
      u.password ||
      u.search ||
      u.hash ||
      !["http:", "https:"].includes(u.protocol) ||
      (u.protocol !== "https:" && !(local && loopback(u.hostname))) ||
      (origin && u.pathname !== "/")
    )
      throw new Error(`Invalid ${name}`);
    return raw;
  }
  const publicUrl = url("PUBLIC_URL", true).replace(/\/$/, "");
  const campusBase = url("CAMPUS_BASE_URL").replace(/\/+$/, "");
  const issuer = url("CAMPUS_ISSUER");
  if (
    !env.INSPECTOR_PASSWORD ||
    env.INSPECTOR_PASSWORD.length < 16 ||
    env.INSPECTOR_PASSWORD.length > 1024
  )
    throw new Error("INSPECTOR_PASSWORD requires 16–1024 characters");
  return {
    publicUrl,
    campusBase,
    issuer,
    password: env.INSPECTOR_PASSWORD,
    dataDir: resolve(env.DATA_DIR || "data"),
    local,
  };
}
export function campusURL(c: Config, path: string) {
  return c.campusBase.replace(/\/+$/, "") + path;
}
export function audience(c: Config, path: string) {
  return c.issuer.replace(/\/+$/, "") + path;
}
