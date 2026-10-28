import { it, expect, vi } from "vitest";
import { z } from "zod";
import { bodyJSON, bodyForm, handle, fail } from "@/server/http";
it.each(["null", "[]", '{"client_id":4}'])(
  "returns field-oriented errors for invalid shape %s",
  async (raw) => {
    const response = await handle(async () => {
      z.object({ client_id: z.string() }).parse(
        await bodyJSON(
          new Request("https://inspector.example", {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: raw,
          }),
        ),
      );
      return Response.json({});
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      status: "Bad Request",
      message: "Validation failed",
      errors: [{ field: raw.startsWith("{") ? "client_id" : "body" }],
    });
  },
);
it.each(["{broken", "x".repeat(16385)])(
  "rejects malformed or oversized JSON",
  async (body) => {
    const response = await handle(async () => {
      await bodyJSON(
        new Request("https://inspector.example", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body,
        }),
      );
      return Response.json({});
    });
    expect(response.status).toBe(400);
    expect(JSON.stringify(await response.json())).not.toMatch(
      /SyntaxError|unmarshal|json:/,
    );
  },
);
it("rejects duplicate form fields before parsing credentials", async () => {
  const response = await handle(async () => {
    await bodyForm(
      new Request("https://inspector.example", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: "state=a&state=b&id_token=hidden",
      }),
      ["state", "id_token"],
    );
    return Response.json({});
  });
  expect(response.status).toBe(400);
  expect((await response.json()).errors[0].field).toBe("state");
});
it("returns generic 500 and logs no error content for unexpected storage failure", async () => {
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  const response = await handle(() => {
    throw new Error("SQLITE private SENTINEL-CREDENTIAL");
  });
  expect(response.status).toBe(500);
  expect(JSON.stringify(await response.json())).not.toMatch(/SQLITE|SENTINEL/);
  expect(log).toHaveBeenCalledWith(
    "inspector_request_failed",
    expect.any(String),
  );
  log.mockRestore();
});
it.each([401, 403, 404, 422, 429])(
  "preserves meaningful status %s",
  async (status) => {
    const response = await handle(() =>
      fail(status, "fixture", "Expected safe failure"),
    );
    expect(response.status).toBe(status);
  },
);
it("returns 400 for a nonnumeric original user ID instead of a runtime conversion error", async () => {
  const { launchSchema } = await import("@/server/launches/launch");
  const response = await handle(() => {
    launchSchema.parse({ login_hint: "not-a-number", reference: "opaque" });
    return Response.json({});
  });
  expect(response.status).toBe(400);
  expect((await response.json()).errors[0].field).toBe("login_hint");
});
it("preserves API errors originating from a separate server bundle", async () => {
  const { AppError } = await import("@/server/http");
  vi.resetModules();
  const { AppError: OtherBundleError } = await import("@/server/http");
  const error = new OtherBundleError(
    404,
    "profile_id",
    "Saved profile not found",
  );
  expect(error).not.toBeInstanceOf(AppError);
  const response = await handle(() => {
    throw error;
  });
  expect(response.status).toBe(404);
  expect((await response.json()).errors[0].field).toBe("profile_id");
});

it("permits a bounded webhook wrapper without increasing other route limits", async () => {
  const raw = JSON.stringify({ body: "x".repeat(262145) });
  const req = () =>
    new Request("https://inspector.example/api/webhooks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: raw,
    });
  await expect(bodyJSON(req())).rejects.toThrow("size limit");
  expect(await bodyJSON(req(), 2 * 1024 * 1024)).toMatchObject({
    body: "x".repeat(262145),
  });
});
