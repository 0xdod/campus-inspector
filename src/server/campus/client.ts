import "server-only";
import type { HttpLog } from "@/lib/contracts";
import {
  newHttpLog,
  httpRequestBody,
  httpResponseBody,
  redactedURL,
  safeContentType,
} from "@/server/logs/redaction";
import { lookup } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import { request as httpRequest } from "node:http";
import { BlockList, isIP } from "node:net";
import { campusURL, loopback, type Config } from "@/server/config";
const blocked = new BlockList();
const blocked6 = new BlockList();
for (const [address, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const)
  blocked.addSubnet(address, prefix, "ipv4");
for (const [address, prefix] of [
  ["::", 96],
  ["::ffff:0:0", 96],
  ["64:ff9b::", 96],
  ["100::", 64],
  ["2001::", 23],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
] as const)
  blocked6.addSubnet(address, prefix, "ipv6");
export const forbiddenAddress = (address: string) =>
  !isIP(address) ||
  (isIP(address) === 6
    ? blocked6.check(address, "ipv6")
    : blocked.check(address, "ipv4"));
export class UpstreamError extends Error {
  constructor(
    readonly response?: { status: number; rateLimit: Record<string, string> },
  ) {
    super("Campus transport or JWKS prerequisite unavailable");
  }
}
export type JSONCampusBody = { raw: string; bearer?: string };
type CampusBody = URLSearchParams | JSONCampusBody;
const rawBody = (body?: CampusBody) =>
  body instanceof URLSearchParams ? body.toString() : body?.raw;
const contentType = (body: CampusBody) =>
  body instanceof URLSearchParams
    ? "application/x-www-form-urlencoded"
    : "application/json";
async function performCampusRequest(
  c: Config,
  path: string,
  body?: CampusBody,
): Promise<{
  status: number;
  body: unknown;
  rateLimit: Record<string, string>;
  headers: Record<string, string>;
}> {
  const u = new URL(campusURL(c, path));
  const hostname = u.hostname.replace(/^\[|\]$/g, "");
  // OAuth can include Campus fetching this app's JWKS through a second tunnel.
  const requestTimeoutMs = path === "/apps/oauth2/token" ? 15000 : 5000;
  try {
    const addresses = isIP(hostname)
      ? [{ address: hostname, family: isIP(hostname) }]
      : await Promise.race([
          lookup(hostname, { all: true }),
          new Promise<never>((_, reject) => {
            const t = setTimeout(() => reject(new UpstreamError()), 5000);
            t.unref();
          }),
        ]);
    if (
      !addresses.length ||
      (!(c.local && loopback(hostname)) &&
        addresses.some((a) => forbiddenAddress(a.address)))
    )
      throw new UpstreamError();
    if (
      c.local &&
      loopback(hostname) &&
      addresses.some((a) => !loopback(a.address))
    )
      throw new UpstreamError();
    const address = addresses.find((a) => a.family === 4) || addresses[0];
    return await new Promise((resolve, reject) => {
      const request = u.protocol === "https:" ? httpsRequest : httpRequest;
      const req = request(
        u,
        {
          method: body ? "POST" : "GET",
          family: address.family,
          lookup: (_host, _options, cb) =>
            cb(null, address.address, address.family),
          headers: {
            ...(body && !(body instanceof URLSearchParams) && body.bearer
              ? { authorization: "Bearer " + body.bearer }
              : {}),
            accept: "application/json",
            ...(body
              ? {
                  "content-type": contentType(body),
                  "content-length": Buffer.byteLength(rawBody(body)!),
                }
              : {}),
          },
        },
        (res) => {
          const chunks: Buffer[] = [];
          let size = 0;
          res.on("data", (chunk: Buffer) => {
            size += chunk.length;
            if (size > 65536) {
              res.destroy();
              req.destroy(new UpstreamError());
            } else chunks.push(chunk);
          });
          res.on("error", () => reject(new UpstreamError()));
          res.on("end", () => {
            clearTimeout(deadline);
            let data: unknown;
            try {
              data = JSON.parse(Buffer.concat(chunks).toString("utf8"));
            } catch {
              data = null;
            }
            const rateLimit: Record<string, string> = {};
            for (const name of [
              "retry-after",
              "ratelimit-limit",
              "ratelimit-remaining",
              "ratelimit-reset",
              "x-ratelimit-limit",
              "x-ratelimit-remaining",
              "x-ratelimit-reset",
            ]) {
              const value = res.headers[name];
              if (typeof value === "string" && /^\d{1,12}$/.test(value))
                rateLimit[name] = value;
            }
            resolve({
              status: res.statusCode || 502,
              body: data,
              rateLimit,
              headers: {
                "content-type": safeContentType(res.headers["content-type"]),
                ...rateLimit,
              },
            });
          });
        },
      );
      const deadline = setTimeout(
        () => req.destroy(new UpstreamError()),
        requestTimeoutMs,
      );
      deadline.unref();
      req.on("error", () => {
        clearTimeout(deadline);
        reject(new UpstreamError());
      });
      req.end(rawBody(body));
    });
  } catch {
    throw new UpstreamError();
  }
}

export type HttpLogRecorder = (log: HttpLog) => void;
export async function campusRequest(
  c: Config,
  path: string,
  body?: CampusBody,
  record?: HttpLogRecorder,
) {
  const started = Date.now();
  const kind =
    path === "/.well-known/jwks.json"
      ? "jwks"
      : path === "/apps/webhooks"
        ? "webhook"
        : "oauth";
  const log = newHttpLog(kind, "server", {
    method: body ? "POST" : "GET",
    url: redactedURL(campusURL(c, path)),
    headers: {
      accept: "application/json",
      ...(body ? { "content-type": contentType(body) } : {}),
    },
    body:
      body instanceof URLSearchParams
        ? httpRequestBody(body)
        : body
          ? { bytes: Buffer.byteLength(body.raw), envelope: "[REDACTED]" }
          : null,
  });
  let result: Awaited<ReturnType<typeof performCampusRequest>>;
  try {
    result = await performCampusRequest(c, path, body);
  } catch (error) {
    record?.({
      ...log,
      outcome: "unavailable",
      durationMs: Date.now() - started,
      note: "No complete response received: network, timeout, response limit or destination checks prevented completion.",
    });
    throw error;
  }
  record?.({
    ...log,
    outcome: "completed",
    durationMs: Date.now() - started,
    response: {
      status: result.status,
      headers: result.headers,
      body: httpResponseBody(result.body, kind),
    },
    note: "Credential values and unrecognized upstream fields are redacted.",
  });
  return result;
}
