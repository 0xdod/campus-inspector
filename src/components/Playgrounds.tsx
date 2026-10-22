"use client";
import { useState } from "react";
import { BackendLaunchGuide } from "./BackendLaunchGuide";
import { scenarios, type InspectionResult } from "@/lib/contracts";
import type { RequestFn } from "./Console";
export function Playgrounds({
  kind,
  ready,
  request,
  onResult,
}: {
  kind: "launch" | "oauth";
  ready: boolean;
  request: RequestFn;
  onResult: (r: InspectionResult) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <div className="two-column">
      <section className="panel">
        <span className="eyebrow">
          {kind === "launch"
            ? "BROWSER AUTHENTICATION"
            : "SERVER AUTHENTICATION"}
        </span>
        <h2>
          {kind === "launch"
            ? "Manual OIDC launch"
            : "Exercise the token endpoint"}
        </h2>
        {!ready && (
          <div className="notice">
            Save your registered client ID in App setup before running an
            inspection.
          </div>
        )}
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            const formElement = e.currentTarget;
            const form = new FormData(formElement);
            try {
              if (kind === "launch") {
                const response = (await request("launch", "POST", {
                  login_hint: form.get("login_hint"),
                  reference: form.get("reference"),
                  ...(form.get("nonce") ? { nonce: form.get("nonce") } : {}),
                })) as { redirectUrl: string };
                formElement.reset();
                window.location.assign(response.redirectUrl);
              } else {
                await onResult(
                  (await request("oauth", "POST", {
                    scenario: form.get("scenario"),
                    scope: form.get("scope"),
                  })) as InspectionResult,
                );
              }
            } catch (e) {
              setError(e instanceof Error ? e.message : "Inspection failed");
            } finally {
              setBusy(false);
            }
          }}
        >
          {kind === "launch" ? (
            <>
              <label htmlFor="user-id">Original user ID</label>
              <input
                id="user-id"
                name="login_hint"
                inputMode="numeric"
                placeholder="e.g. 7"
                pattern="[1-9][0-9]*"
                maxLength={19}
                required
              />
              <label htmlFor="reference">Fresh prepared launch reference</label>
              <input
                id="reference"
                name="reference"
                type="password"
                autoComplete="off"
                required
                maxLength={2048}
              />
              <p className="caption">
                For advanced QA with a prepared reference. For a normal launch,
                follow the Campus launch instructions alongside this form.
              </p>
              <details>
                <summary>Advanced · nonce replay QA</summary>
                <label htmlFor="nonce">Nonce override (optional)</label>
                <input
                  id="nonce"
                  name="nonce"
                  type="password"
                  autoComplete="off"
                  maxLength={2048}
                />
                <p className="caption">
                  Reuse a nonce across two fresh references to test Campus
                  replay protection. Normal launches use a random nonce.
                </p>
              </details>
            </>
          ) : (
            <>
              <label htmlFor="scenario">Scenario</label>
              <select id="scenario" name="scenario">
                {scenarios.map((s) => (
                  <option key={s} value={s}>
                    {s.replaceAll("_", " ")}
                  </option>
                ))}
              </select>
              <label htmlFor="scope">Requested scope</label>
              <input
                id="scope"
                name="scope"
                defaultValue="campus.webhooks.write"
                maxLength={256}
              />
              <p className="caption">
                Custom scopes are deliberate test inputs. Campus grants only
                supported, allowed requested scopes.
              </p>
            </>
          )}
          <button disabled={!ready || busy}>
            {busy
              ? "Running…"
              : kind === "launch"
                ? "Continue to Campus ↗"
                : "Run scenario →"}
          </button>
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
        </form>
      </section>
      <section className="panel help-panel">
        <span className="eyebrow">BEFORE YOU RUN</span>
        <h2>
          {kind === "launch"
            ? "Launch from Campus"
            : "Expected behavior, measured."}
        </h2>
        {kind === "launch" ? (
          <>
            <BackendLaunchGuide />
            <p>
              If Campus rejects the launch before callback, your browser stays
              on its JSON error. The inspector cannot observe that response or
              create a callback record.
            </p>
            <div className="notice">
              Expired, consumed, revoked-membership, and missing-resource cases
              need distinct prepared fixtures. A bogus reference does not prove
              these behaviors.
            </div>
          </>
        ) : (
          <>
            <p>
              Negative scenarios pass only when the expected HTTP status and
              OAuth error are observed. Network failures, unavailable keys, and
              rate limits block inspection.
            </p>
            <p>
              JTI replay sends the exact same assertion twice. The first bearer
              token must fully verify before the replay is attempted.
            </p>
            <div className="notice">
              Assertions and bearer tokens stay on the server. No request is
              automatically retried.
            </div>
          </>
        )}
      </section>
    </div>
  );
}
