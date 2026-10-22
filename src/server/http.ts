import "server-only";
import { z } from "zod";
import { randomUUID } from "node:crypto";
// Startup instrumentation and route handlers can load separate module copies.
// A shared symbol preserves our error contract across those server bundles.
const appErrorBrand = Symbol.for("campus.inspector.app-error");
export class AppError extends Error {
  readonly [appErrorBrand] = true;
  constructor(
    readonly code: number,
    readonly field: string,
    readonly safeMessage: string,
  ) {
    super(safeMessage);
  }
}
function isAppError(error: unknown): error is AppError {
  if (typeof error !== "object" || error === null) return false;
  const candidate = error as Partial<AppError>;
  return (
    candidate[appErrorBrand] === true &&
    typeof candidate.code === "number" &&
    typeof candidate.field === "string" &&
    typeof candidate.safeMessage === "string"
  );
}
export function fail(code: number, field: string, message: string): never {
  throw new AppError(code, field, message);
}
export const json = (data: unknown, status = 200, headers: HeadersInit = {}) =>
  Response.json(data, {
    status,
    headers: { "Cache-Control": "no-store", ...headers },
  });
const statuses: Record<number, string> = {
  400: "Bad Request",
  401: "Unauthorized",
  403: "Forbidden",
  404: "Not Found",
  405: "Method Not Allowed",
  422: "Unprocessable Entity",
  429: "Too Many Requests",
  500: "Internal Server Error",
};
export async function handle(fn: () => Promise<Response> | Response) {
  const requestId = randomUUID();
  try {
    return await fn();
  } catch (e) {
    if (e instanceof z.ZodError) {
      return json(
        {
          status: "Bad Request",
          message: "Validation failed",
          errors: e.issues.map((i) => ({
            field: i.path.join(".") || "body",
            message: `${i.path.join(".") || "body"}: ${i.code === "invalid_type" ? "incorrect or missing datatype" : i.message}`,
          })),
        },
        400,
      );
    }
    if (isAppError(e))
      return json(
        {
          status: statuses[e.code],
          message: e.code === 400 ? "Validation failed" : e.safeMessage,
          errors: [{ field: e.field, message: e.safeMessage }],
        },
        e.code,
      );
    console.error("inspector_request_failed", requestId);
    return json(
      {
        status: "Internal Server Error",
        message: "Unexpected server error",
        errors: [],
      },
      500,
      { "X-Request-Id": requestId },
    );
  }
}
export async function boundedText(req: Request, max = 16384) {
  const declared = Number(req.headers.get("content-length") || 0);
  if (declared > max) fail(400, "body", "body exceeds the size limit");
  const reader = req.body?.getReader();
  if (!reader) return "";
  const parts: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.length;
    if (length > max) {
      await reader.cancel();
      fail(400, "body", "body exceeds the size limit");
    }
    parts.push(value);
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(
      Buffer.concat(parts),
    );
  } catch {
    fail(400, "body", "body must contain valid UTF-8");
  }
}
export async function bodyJSON(req: Request) {
  if (req.headers.get("content-type")?.split(";")[0] !== "application/json")
    fail(400, "body", "body must use application/json");
  const text = await boundedText(req);
  try {
    return JSON.parse(text) as unknown;
  } catch {
    fail(400, "body", "body must contain valid JSON");
  }
}
export function form(raw: string, fields: string[]) {
  if (/%(?![a-f0-9]{2})/i.test(raw))
    fail(400, "body", "body contains malformed form encoding");
  try {
    decodeURIComponent(raw.replaceAll("+", " "));
  } catch {
    fail(400, "body", "body contains malformed form encoding");
  }
  const values = new URLSearchParams(raw);
  for (const field of fields)
    if (values.getAll(field).length > 1)
      fail(400, field, `${field} must appear once`);
  return values;
}
export async function bodyForm(req: Request, fields: string[]) {
  if (
    req.headers.get("content-type")?.split(";")[0] !==
    "application/x-www-form-urlencoded"
  )
    fail(400, "body", "body must use application/x-www-form-urlencoded");
  return form(await boundedText(req, 32768), fields);
}
export const textID = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[A-Za-z0-9_.:-]+$/, "use a bounded technical identifier");
export function methodNotAllowed(allowed: string[]) {
  return json(
    { status: "Method Not Allowed", message: "Unsupported method", errors: [] },
    405,
    { Allow: allowed.join(", ") },
  );
}
