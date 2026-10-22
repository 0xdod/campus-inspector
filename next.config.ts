import type { NextConfig } from "next";
const config: NextConfig = {
  logging: { incomingRequests: false },
  output: "standalone",
  poweredByHeader: false,
  serverExternalPackages: ["better-sqlite3"],
  outputFileTracingIncludes: { "/*": ["./migrations/*.sql"] },
  experimental: { cpus: 2 },
};
export default config;
