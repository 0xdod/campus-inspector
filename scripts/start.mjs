import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
if (existsSync(".env")) process.loadEnvFile(".env");
const args = process.argv.slice(2);
if (
  args.length &&
  (args.length !== 2 ||
    !["--port", "-p"].includes(args[0]) ||
    !/^\d{1,5}$/.test(args[1]) ||
    +args[1] < 1 ||
    +args[1] > 65535)
)
  throw new Error("Usage: npm start -- --port 8090");
const child = spawn(process.execPath, [".next/standalone/server.js"], {
  stdio: "inherit",
  env: {
    ...process.env,
    PORT: args[1] || process.env.PORT || "8090",
    HOSTNAME: process.env.HOSTNAME || "0.0.0.0",
    DATA_DIR: resolve(process.env.DATA_DIR || "data"),
  },
});
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => child.kill(signal));
child.on("exit", (code) => process.exit(code ?? 1));
