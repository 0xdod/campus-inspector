"use client";
import { useState } from "react";
import type { Bootstrap } from "@/lib/contracts";
import type { RequestFn } from "./Console";
export function Setup({
  boot,
  request,
  onSave,
}: {
  boot: Bootstrap;
  request: RequestFn;
  onSave: () => Promise<void>;
}) {
  const [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <div className="two-column">
      <section className="panel">
        <span className="eyebrow">01 / REGISTER IN CAMPUS</span>
        <h2>Your public integration endpoints</h2>
        <p>
          A Campus administrator must register these URLs with the authorized{" "}
          <code>POST /admin/campus-apps</code> operation.
        </p>
        {[
          ["Public JWKS", "/.well-known/jwks.json"],
          ["OIDC initiation", "/oidc/initiate"],
          ["Approved launch & callback", "/oidc/callback"],
        ].map(([label, path]) => (
          <div className="endpoint" key={path}>
            <span>{label}</span>
            <code>{boot.publicUrl + path}</code>
            <button
              className="text-button"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(boot.publicUrl + path);
                  setMessage("URL copied");
                } catch {
                  setMessage("Clipboard unavailable; select and copy the URL.");
                }
              }}
            >
              Copy
            </button>
          </div>
        ))}
        <div className="notice">
          Campus must reach your public HTTPS JWKS URL. Its SSRF protections
          reject private and localhost URLs. Use a public deployment or HTTPS
          tunnel.
        </div>
        <h3>Registration request</h3>
        <pre>{JSON.stringify(boot.registrationJSON, null, 2)}</pre>
        <button
          className="secondary"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(
                JSON.stringify(boot.registrationJSON, null, 2),
              );
              setMessage("Registration JSON copied");
            } catch {
              setMessage("Clipboard unavailable; select and copy the JSON.");
            }
          }}
        >
          Copy registration JSON
        </button>
        <p className="caption">
          Do not enter Campus admin bearer tokens here. No webhook event is
          sent.
        </p>
      </section>
      <section className="panel">
        <span className="eyebrow">02 / SAVE RETURNED IDS</span>
        <h2>Connect your registration</h2>
        <p>
          After the authorized admin step, save the returned IDs. Saving IDs
          does not register or verify the app.
        </p>
        <form
          key={boot.registration.client_id}
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setMessage("");
            const form = new FormData(e.currentTarget);
            try {
              await request("registration", "PUT", {
                client_id: form.get("client_id"),
                ...(form.get("installation_id")
                  ? { installation_id: form.get("installation_id") }
                  : {}),
              });
              await onSave();
              setMessage(
                "Registration IDs saved. Run a real inspection to verify them.",
              );
            } catch (e) {
              setMessage(e instanceof Error ? e.message : "Save failed");
            } finally {
              setBusy(false);
            }
          }}
        >
          <label htmlFor="client-id">Client ID</label>
          <input
            id="client-id"
            name="client_id"
            defaultValue={boot.registration.client_id}
            required
            maxLength={256}
          />
          <label htmlFor="installation-id">
            Installation ID <span className="muted">(optional)</span>
          </label>
          <input
            id="installation-id"
            name="installation_id"
            defaultValue={boot.registration.installation_id}
            maxLength={256}
          />
          <button disabled={busy}>
            {busy ? "Saving…" : "Save registration IDs"}
          </button>
        </form>
        <div role="status" className="caption">
          {message}
        </div>
        <hr />
        <h3>Platform key observations</h3>
        <p>{boot.jwksObservation.status}</p>
        <p className="caption">
          {boot.jwksObservation.observedAt ||
            "Keys are fetched during token verification."}{" "}
          This does not prove Campus’s five-minute key cache.
        </p>
      </section>
    </div>
  );
}
