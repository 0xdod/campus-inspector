import type { NextConfig } from "next";
const config: NextConfig = {
  allowedDevOrigins: ['c42e-102-88-166-104.ngrok-free.app'],
  logging: { incomingRequests: false },
  output: "standalone",
  poweredByHeader: false,
  serverExternalPackages: ["better-sqlite3"],
  outputFileTracingIncludes: { "/*": ["./migrations/*.sql"] },
  experimental: { cpus: 2 },
};
export default config;
