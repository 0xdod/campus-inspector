import "server-only";
import { z } from "zod";
import { runtime } from "./runtime";
import {
  authenticated,
  cookieToken,
  equal,
  mutation,
  origin,
  quota,
  sessionCookie,
} from "./auth/auth";
import { bodyJSON, fail, handle, json, textID } from "./http";
import { startLaunch, launchSchema } from "./launches/launch";
import { oauthSchema, runOAuth } from "./oauth/scenarios";
import { jwksObservation } from "./crypto/verify";
import { exportEvidence } from "./evidence/redaction";
export function registrationJSON(publicUrl: string) {
  return {
    name: "Campus App Inspector",
    description: "Campus Apps authentication inspection for engineering and QA",
    oidc_initiation_url: publicUrl + "/oidc/initiate",
    jwks_url: publicUrl + "/.well-known/jwks.json",
    launch_url: publicUrl + "/oidc/callback",
    redirect_uris: [publicUrl + "/oidc/callback"],
    allowed_scopes: ["campus.webhooks.write"],
    allowed_event_types: ["qa.inspection.completed"],
  };
}
const methods: Record<string, string[]> = {
  session: ["POST", "DELETE"],
  bootstrap: ["GET"],
  registration: ["PUT"],
  history: ["GET"],
  evidence: ["GET"],
  launch: ["POST"],
  oauth: ["POST"],
};
export function api(req: Request) {
  return handle(async () => {
    const path = new URL(req.url).pathname.slice("/api/".length);
    const isDetail = path.startsWith("history/");
    const allowed = isDetail ? ["GET"] : methods[path];
    if (!allowed) fail(404, "path", "Resource not found");
    if (!allowed.includes(req.method))
      return json(
        {
          status: "Method Not Allowed",
          message: "Unsupported method",
          errors: [],
        },
        405,
        { Allow: allowed.join(", ") },
      );
    const { config: c, store: s, keys } = await runtime();
    if (path === "session" && req.method === "POST") {
      origin(req, c);
      quota(s, "signin-global", 5, 60000);
      const body = z
        .object({ password: z.string().max(1024) })
        .strict()
        .parse(await bodyJSON(req));
      if (!equal(body.password, c.password))
        fail(401, "password", "Invalid operator password");
      const session = s.newSession(cookieToken(req));
      return json({ signedIn: true }, 200, {
        "Set-Cookie": sessionCookie(c, session.token),
      });
    }
    const session = authenticated(req, s);
    if (req.method !== "GET") mutation(req, c, s);
    if (path === "session") {
      s.revoke(cookieToken(req));
      return json({ signedIn: false }, 200, {
        "Set-Cookie": sessionCookie(c, "", 0),
      });
    }
    if (path === "bootstrap")
      return json({
        publicUrl: c.publicUrl,
        campusBase: c.campusBase,
        issuer: c.issuer,
        csrf: session.csrf,
        registration: s.registration(),
        registrationJSON: registrationJSON(c.publicUrl),
        jwksObservation: jwksObservation(),
      });
    if (path === "registration") {
      const body = z
        .object({ client_id: textID, installation_id: textID.optional() })
        .strict()
        .parse(await bodyJSON(req));
      s.setRegistration(body);
      return json(s.registration());
    }
    if (path === "history")
      return json(
        s.history().map(({ id, kind, status, createdAt, scenario }) => ({
          id,
          kind,
          status,
          createdAt,
          scenario,
        })),
      );
    if (isDetail) {
      const id = path.slice("history/".length);
      if (!/^[A-Za-z0-9-]{1,64}$/.test(id))
        fail(400, "id", "id must be a valid history identifier");
      const run = s.run(id);
      if (!run) fail(404, "id", "Inspection not found");
      return json(run);
    }
    if (path === "evidence")
      return json(
        {
          exportedAt: new Date().toISOString(),
          runs: exportEvidence(s.history()),
        },
        200,
        {
          "Content-Disposition":
            'attachment; filename="campus-inspector-evidence.json"',
        },
      );
    if (path === "launch") {
      quota(s, "operator-launch", 20);
      return json({
        redirectUrl: startLaunch(c, s, launchSchema.parse(await bodyJSON(req))),
      });
    }
    if (path === "oauth") {
      quota(s, "operator-oauth", 10);
      return json(
        await runOAuth(c, s, keys, oauthSchema.parse(await bodyJSON(req))),
      );
    }
    fail(404, "path", "Resource not found");
  });
}
