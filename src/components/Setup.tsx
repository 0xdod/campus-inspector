"use client";
import { SavedProfiles } from "./SavedProfiles";
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
  const [message, setMessage] = useState("");
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
        <p role="status" className="caption">
          {message}
        </p>
        <p className="caption">
          Do not enter Campus admin bearer tokens here. No webhook event is
          sent.
        </p>
      </section>
      <div>
        <SavedProfiles boot={boot} request={request} onSave={onSave} />
        <section className="panel">
          <h3>Platform key observations</h3>
          <p>{boot.jwksObservation.status}</p>
          <p className="caption">
            {boot.jwksObservation.observedAt ||
              "Keys are fetched during token verification."}{" "}
            This does not prove Campus’s five-minute key cache.
          </p>
        </section>
      </div>
    </div>
  );
}
