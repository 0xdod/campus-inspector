import { methodNotAllowed } from "@/server/http";
import { z } from "zod";
import { runtime as appRuntime } from "@/server/runtime";
import { bodyForm, handle } from "@/server/http";
import { callback } from "@/server/launches/launch";
import { quota } from "@/server/auth/auth";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export function POST(req: Request) {
  return handle(async () => {
    const { config, store } = await appRuntime();
    quota(store, "public-callback", 60);
    const params = await bodyForm(req, ["state", "id_token"]);
    const { state, id_token } = z
      .object({
        state: z.string().min(1).max(256),
        id_token: z.string().min(1).max(24576),
      })
      .parse({ state: params.get("state"), id_token: params.get("id_token") });
    const run = await callback(config, store, state, id_token);
    return new Response(null, {
      status: 303,
      headers: {
        Location: config.publicUrl + "/?run=" + run.id,
        "Cache-Control": "no-store",
      },
    });
  });
}

export const GET = () => methodNotAllowed(["POST"]);

export const PUT = () => methodNotAllowed(["POST"]);

export const PATCH = () => methodNotAllowed(["POST"]);

export const DELETE = () => methodNotAllowed(["POST"]);

export const HEAD = () => methodNotAllowed(["POST"]);

export const OPTIONS = () => methodNotAllowed(["POST"]);
