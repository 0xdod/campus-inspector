import { test, expect, type Page } from "@playwright/test";
async function signin(page: Page) {
  await page.goto("/signin");
  await page.getByLabel("Operator password").fill("fixture-only-long-password");
  await page.getByRole("button", { name: "Open inspector" }).click();
  await expect(
    page.getByRole("heading", { name: "Inspect every connection." }),
  ).toBeVisible();
}
test("operator setup, real browser form-post, OAuth and redacted export", async ({
  page,
  request,
}) => {
  const errors: string[] = [];
  const apiResponses: Promise<string>[] = [];
  page.on("response", (res) => {
    if (/\/api\/(history|oauth|bootstrap)/.test(res.url()))
      apiResponses.push(res.text());
  });
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  expect((await request.get("/api/history")).status()).toBe(401);
  await page.goto("/");
  await expect(page).toHaveURL(/\/signin$/);
  await signin(page);
  await expect(
    page.getByRole("heading", { name: "Your first inspection starts here." }),
  ).toBeVisible();
  const boot = await (await page.request.get("/api/bootstrap")).json();
  const missing = await page.request.post("/api/launch", {
    headers: { origin: "http://localhost:8090", "x-csrf-token": boot.csrf },
    data: { login_hint: "7", reference: "fixture-reference-not-used" },
  });
  expect(missing.status()).toBe(422);
  await page.getByRole("button", { name: "App setup", exact: true }).click();
  await page.getByLabel("Client ID", { exact: true }).fill("fixture-client");
  await page.getByLabel("Installation ID").fill("fixture-install");
  await page.getByRole("button", { name: "Save registration IDs" }).click();
  await expect(page.getByRole("status")).toContainText(
    "Registration IDs saved",
  );
  await page
    .getByRole("button", { name: "Launch inspector", exact: true })
    .click();
  await page.getByLabel("Original user ID").fill("7");
  await page
    .getByLabel("Fresh prepared launch reference")
    .fill("fixture-reference-" + Date.now());
  const launch = page.waitForResponse((r) => r.url().endsWith("/api/launch"));
  await page.getByRole("button", { name: "Continue to Campus" }).click();
  await launch;
  await expect(page).toHaveURL(/\?run=/);
  await expect(
    page.getByRole("heading", { name: "OIDC launch", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Signature verified using configured Campus JWKS"),
  ).toBeVisible();
  await expect(page.locator(".run-detail .badge")).toHaveText("passed");
  await page
    .getByRole("button", { name: "OAuth playground", exact: true })
    .click();
  await page.getByLabel("Scenario").selectOption("jti_replay");
  await page.getByRole("button", { name: "Run scenario" }).click();
  await expect(
    page.getByText("The unchanged assertion must be rejected"),
  ).toBeVisible();
  await expect(page.locator(".run-detail .badge")).toHaveText("passed");
  const evidence = await page.request.get("/api/evidence");
  expect(evidence.status()).toBe(200);
  const text = await evidence.text();
  expect(text).not.toContain("claims");
  expect(text).not.toContain("fixture-install");
  expect(text).not.toContain("SENTINEL");
  await page.screenshot({
    path: "test-results/console-desktop.png",
    fullPage: true,
  });
  const payloads = (await Promise.all(apiResponses)).join("\n");
  expect(payloads).not.toContain("SENTINEL");
  expect(payloads).not.toMatch(
    /eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/,
  );
  expect(errors).toEqual([]);
});
test("mobile layout, keyboard sign-in, empty/loading states and sign-out", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 850 });
  await page.goto("/signin");
  await page.getByLabel("Operator password").focus();
  await page.keyboard.type("fixture-only-long-password");
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("button", { name: "Open inspector" }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("heading", { name: "Inspect every connection." }),
  ).toBeVisible();
  for (const section of [
    "Overview",
    "App setup",
    "Launch inspector",
    "OAuth playground",
    "Run history",
  ]) {
    await page.getByRole("button", { name: section, exact: true }).click();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  }
  expect(
    await page
      .locator(".environment > div")
      .evaluate((el) => el.getBoundingClientRect().width),
  ).toBeGreaterThan(160);
  await page.screenshot({
    path: "test-results/console-mobile.png",
    fullPage: true,
  });
  for (const width of [768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  }
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/signin$/);
});
test("HTTP transport errors, methods, CSRF and uncached security headers", async ({
  page,
  request,
}) => {
  const health = await request.get("/healthz");
  expect(health.status()).toBe(200);
  expect(health.headers()["cache-control"]).toContain("no-store");
  expect(health.headers()["x-content-type-options"]).toBe("nosniff");
  const jwks = await (await request.get("/.well-known/jwks.json")).json();
  expect(Object.keys(jwks.keys[0]).sort()).toEqual([
    "alg",
    "e",
    "kid",
    "kty",
    "n",
    "use",
  ]);
  const wrongMethod = await request.put("/api/history");
  expect(wrongMethod.status()).toBe(405);
  expect(wrongMethod.headers().allow).toBe("GET");
  await signin(page);
  const bad = await page.request.put("/api/registration", {
    headers: { origin: "http://localhost:8090" },
    data: { client_id: 4 },
  });
  expect(bad.status()).toBe(403);
  const boot = await (await page.request.get("/api/bootstrap")).json();
  const headers = {
    origin: "http://localhost:8090",
    "x-csrf-token": boot.csrf,
    "content-type": "application/json",
  };
  const malformed = await page.request.put("/api/registration", {
    headers,
    data: "{bad",
  });
  expect(malformed.status()).toBe(400);
  const datatype = await page.request.put("/api/registration", {
    headers,
    data: { client_id: 4 },
  });
  expect(datatype.status()).toBe(400);
  expect((await datatype.json()).errors[0].field).toBe("client_id");
  expect((await page.request.get("/api/history/absent")).status()).toBe(404);
  const signout = await page.request.delete("/api/session", { headers });
  expect(signout.status()).toBe(200);
  expect((await page.request.get("/api/history")).status()).toBe(401);
});
test("public form-post callback works without operator cookies and never creates a session", async ({
  browser,
}) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  const query = new URLSearchParams({
    iss: "https://fixture-campus.example/",
    login_hint: "7",
    login_message_hint: "fixture-reference-no-cookie-" + Date.now(),
  });
  await page.goto("http://localhost:8090/oidc/initiate?" + query);
  await expect(page).toHaveURL(/\/signin\?run=/);
  expect(
    (await context.cookies()).filter((c) => c.name === "inspector_session"),
  ).toHaveLength(0);
  expect((await page.request.get("/api/history")).status()).toBe(401);
  await page.getByLabel("Operator password").fill("fixture-only-long-password");
  await page.getByRole("button", { name: "Open inspector" }).click();
  await expect(page.locator(".run-detail .badge")).toHaveText("passed");
  await context.close();
});
