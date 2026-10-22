import { afterEach, beforeEach, it, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "@/server/db/store";
import {
  httpRequestBody,
  httpResponseBody,
  redactedURL,
  newHttpLog,
} from "@/server/logs/redaction";
let dir: string, s: Store;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "http-logs-"));
  s = new Store(dir);
});
afterEach(() => {
  s.close();
  rmSync(dir, { force: true, recursive: true });
});
it("shows form bodies without assertions, references, state or nonce", () => {
  const form = new URLSearchParams({
    grant_type: "client_credentials",
    client_assertion: "SENTINEL-ASSERTION",
    scope: "campus.webhooks.write",
    state: "SENTINEL-STATE",
    nonce: "SENTINEL-NONCE",
    login_message_hint: "SENTINEL-REFERENCE",
    client_id: "client-fixture",
  });
  const body = httpRequestBody(form);
  expect(body).toMatchObject({
    grant_type: "client_credentials",
    client_assertion: "[REDACTED]",
    scope: "campus.webhooks.write",
    client_id: "client-fixture",
  });
  expect(JSON.stringify(body)).not.toContain("SENTINEL");
  const url = redactedURL("https://campus.example/apps/oidc/login?" + form);
  expect(url).not.toContain("SENTINEL");
  expect(url).toContain("client_id=client-fixture");
});
it("retains the response envelope while redacting tokens and reflected upstream text", () => {
  const body = httpResponseBody(
    {
      access_token: "SENTINEL-TOKEN",
      token_type: "Bearer",
      expires_in: 3600,
      scope: "campus.webhooks.write",
      error: "invalid_client",
      error_description: "SENTINEL-REFLECTED",
      other: "SENTINEL-UNKNOWN",
    },
    "oauth",
  );
  expect(body).toMatchObject({
    access_token: "[REDACTED]",
    token_type: "Bearer",
    expires_in: 3600,
    error: "invalid_client",
    error_description: "[REDACTED]",
  });
  expect(JSON.stringify(body)).not.toContain("SENTINEL");
});
it("never logs private JWK fields or opaque non-JSON upstream text", () => {
  const body = httpResponseBody(
    {
      keys: [
        {
          kty: "RSA",
          kid: "public-key",
          alg: "RS256",
          use: "sig",
          n: "public-modulus",
          e: "AQAB",
          d: "SENTINEL-PRIVATE",
        },
      ],
    },
    "jwks",
  );
  expect(JSON.stringify(body)).not.toContain("SENTINEL");
  expect(JSON.stringify(body)).toContain("public-key");
  expect(httpResponseBody(null, "oauth")).toBe(
    "[Non-JSON or empty response body omitted]",
  );
});
it("persists redacted logs and associates prepared browser redirects with a run", () => {
  const log = newHttpLog("oidc", "browser_redirect", {
    method: "GET",
    url: "https://campus.example/apps/oidc/login",
    headers: {},
    body: null,
  });
  s.saveHttpLog(log);
  s.linkHttpLog(log.id, "run-fixture");
  expect(s.httpLog(log.id)?.runId).toBe("run-fixture");
  s.close();
  s = new Store(dir);
  expect(s.httpLogs()).toHaveLength(1);
  expect(s.httpLog(log.id)?.request.body).toBeNull();
});
it("retains at most 500 logs and excludes expired entries", () => {
  for (let i = 0; i < 505; i++)
    s.saveHttpLog(
      newHttpLog("oauth", "server", {
        method: "POST",
        url: "https://campus.example/apps/oauth2/token",
        headers: {},
        body: { grant_type: "client_credentials" },
      }),
    );
  expect(s.httpLogs()).toHaveLength(500);
  expect(s.httpLogs(Date.now() + 86400001)).toHaveLength(0);
  s.prune(Date.now() + 86400001);
  expect(s.db.prepare("SELECT count(*) AS count FROM http_logs").get()).toEqual(
    { count: 0 },
  );
});
