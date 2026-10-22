import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import assert from "node:assert/strict";
const suffix = process.pid + "-" + randomBytes(3).toString("hex");
const name = "campus-inspector-smoke-" + suffix,
  volume = name + "-data",
  image = "campus-inspector:smoke";
const docker = (...args) =>
  execFileSync("docker", args, {
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  }).trim();
let base;
const password = randomBytes(24).toString("hex");
async function waitReady() {
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(base + "/healthz")).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("Image did not become ready");
}
async function api(path, method = "GET", body, headers = {}) {
  const response = await fetch(base + path, {
    method,
    headers: { "content-type": "application/json", ...headers },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { response, body: await response.json() };
}
try {
  console.log("Building production image");
  execFileSync("docker", ["build", "-t", image, "."], { stdio: "inherit" });
  docker("volume", "create", volume);
  docker(
    "run",
    "-d",
    "--name",
    name,
    "--read-only",
    "--cap-drop=ALL",
    "--security-opt=no-new-privileges:true",
    "--tmpfs",
    "/tmp:rw,noexec,nosuid,size=64m,uid=1000,gid=1000",
    "--tmpfs",
    "/app/.next/cache:rw,noexec,nosuid,size=64m,uid=1000,gid=1000",
    "-v",
    volume + ":/data",
    "-p",
    "127.0.0.1::8090",
    "-e",
    "PUBLIC_URL=http://localhost:8090",
    "-e",
    "CAMPUS_BASE_URL=http://127.0.0.1:8081/api/backend",
    "-e",
    "CAMPUS_ISSUER=https://fixture-campus.example/",
    "-e",
    "INSPECTOR_PASSWORD=" + password,
    "-e",
    "ALLOW_LOCAL_HTTP=true",
    image,
  );
  const port = docker("port", name, "8090/tcp").split(":").at(-1);
  base = "http://127.0.0.1:" + port;
  await waitReady();
  assert.equal((await fetch(base + "/api/history")).status, 401);
  const initial = await api("/.well-known/jwks.json");
  assert.equal(initial.response.status, 200);
  assert.deepEqual(Object.keys(initial.body.keys[0]).sort(), [
    "alg",
    "e",
    "kid",
    "kty",
    "n",
    "use",
  ]);
  const login = await api(
    "/api/session",
    "POST",
    { password },
    { origin: "http://localhost:8090" },
  );
  assert.equal(login.response.status, 200);
  const cookie = login.response.headers.get("set-cookie").split(";")[0];
  const boot = await api("/api/bootstrap", "GET", undefined, { cookie });
  const headers = {
    cookie,
    origin: "http://localhost:8090",
    "x-csrf-token": boot.body.csrf,
  };
  assert.equal(
    (
      await api(
        "/api/registration",
        "PUT",
        { client_id: "fixture-client", installation_id: "fixture-install" },
        headers,
      )
    ).response.status,
    200,
  );
  // No Campus server is running in this container: this MUST persist a blocked run.
  const run = await api("/api/oauth", "POST", { scenario: "valid" }, headers);
  assert.equal(run.body.status, "blocked");
  docker("restart", name);
  await waitReady();
  assert.deepEqual((await api("/.well-known/jwks.json")).body, initial.body);
  const restarted = await api("/api/bootstrap", "GET", undefined, { cookie });
  assert.equal(restarted.body.registration.client_id, "fixture-client");
  const history = await api("/api/history", "GET", undefined, { cookie });
  assert.equal(history.body[0].id, run.body.id);
  assert.equal(docker("exec", name, "id", "-u"), "1000");
  assert.ok(!docker("logs", name).includes(password));
  console.log(
    "Docker verified: read-only, non-root, health/JWKS/auth, durable key, registration, session and blocked history across restart.",
  );
} catch (e) {
  try {
    console.error(docker("logs", name).replaceAll(password, "[REDACTED]"));
  } catch {}
  console.error(String(e.message).replaceAll(password, "[REDACTED]"));
  process.exitCode = 1;
} finally {
  try {
    docker("rm", "-f", name);
  } catch {}
  try {
    docker("volume", "rm", volume);
  } catch {}
}
