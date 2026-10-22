export type CheckResult = {
  name: string;
  status: "passed" | "failed" | "not_run";
  message: string;
};
export type InspectionResult = {
  profile?: { id: string; name: string; campusBase: string; issuer: string };
  id: string;
  kind: "oidc" | "oauth";
  status: "passed" | "failed" | "blocked";
  createdAt: string;
  checks: CheckResult[];
  scenario?: string;
  durationMs?: number;
  expected?: { status: number; error?: string };
  exchanges?: {
    endpoint?: "token" | "jwks";
    status: number;
    error?: string;
    response: Record<string, unknown>;
    rateLimit: Record<string, string>;
  }[];
  request?: Record<string, unknown>;
  header?: Record<string, unknown>;
  claims?: Record<string, unknown>;
  verified?: boolean;
};
export type Registration = { client_id: string; installation_id?: string };
export type AppProfile = Registration & {
  id: string;
  name: string;
  campusBase: string;
  issuer: string;
  createdAt: string;
  updatedAt: string;
};
export type ProfileInput = Registration & {
  name: string;
  campusBase: string;
  issuer: string;
};
export type Bootstrap = {
  profiles: AppProfile[];
  activeProfileId: string | null;
  publicUrl: string;
  campusBase: string;
  issuer: string;
  csrf: string;
  registration: Registration;
  registrationJSON: Record<string, unknown>;
  jwksObservation: { status: string; observedAt?: string; keyCount?: number };
};
export const scenarios = [
  "valid",
  "missing_scope",
  "missing_assertion",
  "expired_assertion",
  "wrong_audience",
  "foreign_key",
  "jti_replay",
] as const;
export type Scenario = (typeof scenarios)[number];
