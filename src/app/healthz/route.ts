import { methodNotAllowed } from "@/server/http";
import { runtime as appRuntime } from "@/server/runtime";
import { handle, json } from "@/server/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export function GET() {
  return handle(async () => {
    await appRuntime();
    return json({ status: "ready" });
  });
}

export const POST = () => methodNotAllowed(["GET"]);

export const PUT = () => methodNotAllowed(["GET"]);

export const PATCH = () => methodNotAllowed(["GET"]);

export const DELETE = () => methodNotAllowed(["GET"]);

export const HEAD = () => methodNotAllowed(["GET"]);

export const OPTIONS = () => methodNotAllowed(["GET"]);
