import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import {
  generateKeyPair,
  exportJWK,
  SignJWT,
  decodeJwt,
  compactVerify,
  importJWK,
  type JWTPayload,
  type JWK,
} from "jose";
export async function fixtureCampus(
  options: {
    port?: number;
    inspector?: string;
    appJWK?: JWK;
    issuer?: string;
  } = {},
) {
  const key = await generateKeyPair("RS256", { modulusLength: 2048 });
  const jwk = {
    ...(await exportJWK(key.publicKey)),
    kid: "fixture-campus-key",
    alg: "RS256",
    use: "sig",
  };
  const inspector = options.inspector || "http://localhost:8090";
  const issuer = options.issuer || "https://fixture-campus.example/";
  let mode = "normal";
  let tokenChange: (claims: JWTPayload) => JWTPayload = (c) => c;
  const seen = new Set<string>(),
    references = new Set<string>();
  let requests: URLSearchParams[] = [];
  let webhooks: { body: string; authorization: string }[] = [];
  const sign = async (
    claims: JWTPayload,
    header: Record<string, unknown> = {},
  ) =>
    new SignJWT(claims)
      .setProtectedHeader({ alg: "RS256", kid: jwk.kid, ...header })
      .sign(key.privateKey);
  const identity = (nonce: string, user = "7", client = "fixture-client") => ({
    iss: issuer,
    sub: user,
    aud: client,
    azp: client,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 300,
    nonce,
    "https://miva.campus/claims/tenant_id": "2",
    "https://miva.campus/claims/installation_id": "fixture-install",
    "https://miva.campus/claims/roles": ["Learner"],
    email: "SENTINEL-PROFILE@example.invalid",
  });
  const service = () => ({
    iss: issuer,
    sub: "fixture-client",
    client_id: "fixture-client",
    aud: issuer.replace(/\/+$/, "") + "/apps/webhooks",
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 3600,
    scope: "campus.webhooks.write",
    installation_id: "fixture-install",
  });
  const send = (res: ServerResponse, status: number, body: unknown) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };
  async function handler(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url || "/", inspector);
    const path = url.pathname.replace(/^\/api\/backend/, "");
    if (path === "/.well-known/jwks.json") {
      if (mode === "jwks_rate_limit") {
        res.setHeader("Retry-After", "60");
        send(res, 429, { error: "temporarily_unavailable" });
        return;
      }
      if (mode === "jwks_redirect") {
        res.writeHead(302, { location: inspector });
        res.end();
        return;
      }
      if (mode === "jwks_timeout") return;
      if (mode === "jwks_oversized") {
        res.end(" ".repeat(65537));
        return;
      }
      if (mode === "jwks_private") {
        send(res, 200, { keys: [{ ...jwk, d: "private" }] });
        return;
      }
      if (mode === "jwks_duplicate") {
        send(res, 200, { keys: [jwk, jwk] });
        return;
      }
      if (mode === "jwks_malformed") {
        send(res, 200, { keys: [{}] });
        return;
      }
      send(res, 200, { keys: [jwk] });
      return;
    }
    if (path === "/apps/oidc/login") {
      const p = url.searchParams;
      const ref = p.get("login_message_hint") || "";
      if (!ref.startsWith("fixture-reference-") || references.has(ref)) {
        send(res, 400, { message: "Fixture reference unavailable" });
        return;
      }
      references.add(ref);
      const token = await sign(
        tokenChange(
          identity(
            p.get("nonce") || "",
            p.get("login_hint") || "",
            p.get("client_id") || "",
          ),
        ),
      );
      const callback = p.get("redirect_uri");
      if (callback !== inspector + "/oidc/callback") {
        send(res, 400, {});
        return;
      }
      res.writeHead(200, { "content-type": "text/html" });
      res.end(
        `<html><body><form method="post" action="${callback}"><input name="state" value="${p.get("state")}"><input name="id_token" value="${token}"></form><script>document.forms[0].submit()</script></body></html>`,
      );
      return;
    }
    if (path === "/apps/webhooks") {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const raw = Buffer.concat(chunks).toString("utf8");
      webhooks.push({
        body: raw,
        authorization: req.headers.authorization || "",
      });
      const error = (status: number, field: string) =>
        send(res, status, {
          status:
            status === 400
              ? "Bad Request"
              : status === 401
                ? "Unauthorized"
                : status === 413
                  ? "Request Entity Too Large"
                  : "Unprocessable Entity",
          message: "Validation failed",
          errors: [{ field, message: "SENTINEL-REFLECTED-PAYLOAD" }],
        });
      if (mode === "webhook_timeout") return;
      if (mode === "webhook_rate_limit") {
        res.setHeader("Retry-After", "60");
        send(res, 429, { message: "SENTINEL" });
        return;
      }
      if (mode === "webhook_server_error") {
        send(res, 500, { message: "SENTINEL" });
        return;
      }
      if (mode === "webhook_redirect") {
        res.writeHead(302, { location: inspector });
        res.end();
        return;
      }
      if (mode === "webhook_non_json") {
        res.end("SENTINEL");
        return;
      }
      try {
        await compactVerify(
          (req.headers.authorization || "").slice(7),
          key.publicKey,
        );
      } catch {
        error(401, "Authorization");
        return;
      }
      if (Buffer.byteLength(raw) > 262144) {
        error(413, "body");
        return;
      }
      let event: Record<string, unknown>;
      try {
        event = JSON.parse(raw);
      } catch {
        error(400, "body");
        return;
      }
      if (
        !event.data ||
        typeof event.data !== "object" ||
        Array.isArray(event.data)
      ) {
        error(400, "data");
        return;
      }
      if (event.installation_id !== "fixture-install") {
        error(422, "installation_id");
        return;
      }
      if (event.type !== "qa.inspection.completed") {
        error(422, "type");
        return;
      }
      send(res, 202, {
        id: mode === "webhook_bad_receipt" ? "wrong" : event.id,
        status: "received",
      });
      return;
    }
    if (path !== "/apps/oauth2/token") {
      send(res, 404, {});
      return;
    }
    const buffers: Buffer[] = [];
    for await (const chunk of req) buffers.push(Buffer.from(chunk));
    const form = new URLSearchParams(Buffer.concat(buffers).toString());
    requests.push(form);
    if (mode === "token_timeout") return;
    if (mode === "token_slow")
      await new Promise((resolve) => setTimeout(resolve, 6000));
    if (mode === "rate_limit") {
      res.setHeader("Retry-After", "60");
      send(res, 429, {
        error: "SENTINEL-REFLECTED-TOKEN",
        error_description: form.get("client_assertion"),
      });
      return;
    }
    if (mode === "non_json") {
      res.writeHead(502);
      res.end("SENTINEL-UPSTREAM-PRIVATE");
      return;
    }
    if (mode === "empty_first") {
      send(
        res,
        requests.length === 1 ? 200 : 401,
        requests.length === 1 ? {} : { error: "invalid_client" },
      );
      return;
    }
    if (mode === "server_error") {
      send(res, 500, { error: "server_error" });
      return;
    }
    if (mode === "redirect") {
      res.writeHead(302, { location: inspector });
      res.end();
      return;
    }
    const reject = (code: string, status = 400) =>
      send(res, status, {
        error: code,
        error_description: "SENTINEL-REFLECTED-CREDENTIAL",
      });
    const assertion = form.get("client_assertion");
    if (!assertion) {
      reject("invalid_request");
      return;
    }
    if (!form.get("scope")?.trim()) {
      reject("invalid_scope");
      return;
    }
    let claims: JWTPayload;
    try {
      const appJWK =
        options.appJWK ||
        (await (await fetch(inspector + "/.well-known/jwks.json")).json())
          .keys[0];
      await compactVerify(assertion, await importJWK(appJWK, "RS256"));
      claims = decodeJwt(assertion);
      if (
        claims.iss !== "fixture-client" ||
        claims.sub !== "fixture-client" ||
        claims.aud !== issuer.replace(/\/+$/, "") + "/apps/oauth2/token" ||
        typeof claims.exp !== "number" ||
        claims.exp <= Date.now() / 1000 ||
        !claims.jti ||
        seen.has(claims.jti)
      )
        throw new Error();
    } catch {
      reject("invalid_client", 401);
      return;
    }
    if (!form.get("scope")?.split(" ").includes("campus.webhooks.write")) {
      reject("invalid_scope");
      return;
    }
    seen.add(claims.jti!);
    send(res, 200, {
      access_token: await sign(tokenChange(service())),
      token_type: mode === "bad_envelope" ? "MAC" : "Bearer",
      expires_in: 3600,
      scope: "campus.webhooks.write",
    });
  }
  const server = createServer((req, res) => {
    void handler(req, res).catch(() => send(res, 500, {}));
  });
  await new Promise<void>((resolve) =>
    server.listen(options.port || 0, "127.0.0.1", resolve),
  );
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("No fixture address");
  return {
    base: `http://127.0.0.1:${address.port}`,
    issuer,
    jwk,
    sign,
    identity,
    service,
    setMode: (value: string) => {
      mode = value;
      requests = [];
      webhooks = [];
    },
    changeToken: (fn: (c: JWTPayload) => JWTPayload) => {
      tokenChange = fn;
    },
    requests: () => requests,
    webhooks: () => webhooks,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close((e) => (e ? reject(e) : resolve()));
      }),
  };
}
