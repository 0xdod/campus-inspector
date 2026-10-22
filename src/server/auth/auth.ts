import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import { fail } from "@/server/http";
import type { Config } from "@/server/config";
import type { Store } from "@/server/db/store";
export const cookieName = "inspector_session";
export function cookieToken(req: Request) {
  return (
    (req.headers.get("cookie") || "")
      .split(";")
      .map((s) => s.trim())
      .find((s) => s.startsWith(cookieName + "="))
      ?.slice(cookieName.length + 1) || ""
  );
}
export function equal(a: string, b: string) {
  return timingSafeEqual(
    createHash("sha256").update(a).digest(),
    createHash("sha256").update(b).digest(),
  );
}
export function origin(req: Request, c: Config) {
  if (req.headers.get("origin") !== c.publicUrl)
    fail(403, "origin", "The request origin is not allowed");
}
export function authenticated(req: Request, s: Store) {
  const session = s.session(cookieToken(req));
  if (!session) fail(401, "session", "Sign in to the operator console");
  return session;
}
export function mutation(req: Request, c: Config, s: Store) {
  const session = authenticated(req, s);
  origin(req, c);
  if (!equal(session.csrf, req.headers.get("x-csrf-token") || ""))
    fail(403, "csrf", "Invalid CSRF token");
  return session;
}
export function sessionCookie(c: Config, token: string, maxAge = 28800) {
  return `${cookieName}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${c.publicUrl.startsWith("https:") ? "; Secure" : ""}`;
}
export function quota(s: Store, bucket: string, max: number, window = 60000) {
  if (!s.quota(bucket, max, window))
    fail(429, "quota", "Request quota exceeded; wait before trying again");
}
