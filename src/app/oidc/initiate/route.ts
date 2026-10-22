import { recordInbound } from "@/server/logs/inbound";
import { httpRequestBody } from "@/server/logs/redaction";
import type { HttpLog } from "@/lib/contracts";
import { methodNotAllowed } from "@/server/http";
import { runtime as appRuntime } from "@/server/runtime";
import { handle, form, bodyForm, fail } from "@/server/http";
import { publicInitiation } from "@/server/launches/launch";
import { quota } from "@/server/auth/auth";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const fields = [
  "iss",
  "login_hint",
  "login_message_hint",
  "client_id",
  "target_link_uri",
];
function initiate(req: Request) {
  return handle(async () => {
    const { config, store } = await appRuntime();
    const started = Date.now();
    let body: HttpLog["request"]["body"] =
      "[Unparsed or rejected body omitted]";
    const response = await handle(async () => {
      quota(store, "public-initiation", 30);
      const raw = new URL(req.url).search.slice(1);
      if (raw.length > 16384) fail(400, "body", "query exceeds the size limit");
      const params =
        req.method === "GET" ? form(raw, fields) : await bodyForm(req, fields);
      body = req.method === "GET" ? null : httpRequestBody(params);
      return new Response(null, {
        status: 303,
        headers: {
          Location: publicInitiation(config, store, params),
          "Cache-Control": "no-store",
        },
      });
    });
    await recordInbound(
      store,
      req,
      response,
      body,
      started,
      {
        profile: config.profile
          ? {
              id: config.profile.id,
              name: config.profile.name,
              campusBase: config.campusBase,
              issuer: config.issuer,
            }
          : undefined,
      },
      config.publicUrl,
    );
    return response;
  });
}
export const GET = initiate,
  POST = initiate;

export const PUT = () => methodNotAllowed(["GET", "POST"]);

export const PATCH = () => methodNotAllowed(["GET", "POST"]);

export const DELETE = () => methodNotAllowed(["GET", "POST"]);

export const HEAD = () => methodNotAllowed(["GET", "POST"]);

export const OPTIONS = () => methodNotAllowed(["GET", "POST"]);
