"use client";
import { useState } from "react";
import type { Bootstrap, InspectionResult } from "@/lib/contracts";
import {
  buildWebhookBody,
  webhookPresets,
  type WebhookScenario,
} from "@/lib/webhooks";
import type { RequestFn } from "./Console";
export function Webhooks({
  boot,
  request,
  onResult,
}: {
  boot: Bootstrap;
  request: RequestFn;
  onResult: (run: InspectionResult) => Promise<void>;
}) {
  const [scenario, setScenario] = useState<WebhookScenario>("valid");
  const [rawMode, setRawMode] = useState(false),
    [body, setBody] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const preset = webhookPresets.find((p) => p.id === scenario)!;
  const bytes = new TextEncoder().encode(body).length;
  const reset = (next: WebhookScenario = scenario) =>
    setBody(
      buildWebhookBody(
        next,
        boot.registration.installation_id || "<verified-installation-id>",
      ),
    );
  return (
    <div className="two-column">
      <section className="panel">
        <span className="eyebrow">INBOUND EVENT RECEIPT</span>
        <h2>Send an event to Campus</h2>
        {!boot.registration.client_id && (
          <div className="notice">
            Save and select a registered app profile before sending events.
          </div>
        )}
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            try {
              const run = (await request("webhooks", "POST", {
                scenario,
                ...(rawMode ? { body } : {}),
              })) as InspectionResult;
              await onResult(run);
            } catch (error) {
              setError(
                error instanceof Error
                  ? error.message
                  : "Webhook inspection unavailable",
              );
            } finally {
              setBusy(false);
            }
          }}
        >
          <label htmlFor="webhook-scenario">Webhook scenario</label>
          <select
            id="webhook-scenario"
            value={scenario}
            disabled={busy}
            onChange={(e) => {
              const next = e.target.value as WebhookScenario;
              setScenario(next);
              if (rawMode) reset(next);
            }}
          >
            {webhookPresets.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
          <p className="caption">
            Expected Campus HTTP {preset.status}
            {"field" in preset
              ? ` on ${preset.field}`
              : " with the supplied ID and status received"}
            .
          </p>
          <label className="webhook-mode">
            <input
              type="checkbox"
              checked={rawMode}
              disabled={busy}
              onChange={(e) => {
                setRawMode(e.target.checked);
                if (e.target.checked) reset();
              }}
            />{" "}
            Edit raw event JSON
          </label>
          {rawMode ? (
            <>
              <label htmlFor="webhook-envelope">Event envelope</label>
              <textarea
                id="webhook-envelope"
                className="webhook-editor"
                rows={16}
                value={body}
                disabled={busy}
                onChange={(e) => setBody(e.target.value)}
                spellCheck={false}
              />
              <p className="caption">
                {bytes.toLocaleString()} UTF-8 bytes · Campus limit 262,144 ·
                Inspector forwarding cap 300,000. Text is sent unchanged,
                including invalid JSON. The selected scenario determines
                expected status.
              </p>
              {!boot.registration.installation_id && (
                <p className="notice">
                  Replace the installation placeholder with your verified
                  installation UUID, or turn off raw editing to use the token
                  installation automatically.
                </p>
              )}
              <button
                type="button"
                className="secondary"
                disabled={busy}
                onClick={() => reset()}
              >
                Reset envelope with a fresh ID
              </button>
            </>
          ) : (
            <p className="caption">
              The server generates a fresh event ID and timestamp, uses
              qa.inspection.completed and empty data, and applies the selected
              preset. Installation comes from the verified service token.
            </p>
          )}
          <button
            disabled={
              busy ||
              !boot.registration.client_id ||
              (rawMode && bytes > 300000)
            }
          >
            {busy ? "Sending…" : "Send webhook →"}
          </button>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
        </form>
      </section>
      <section className="panel help-panel">
        <span className="eyebrow">BEFORE YOU SEND</span>
        <h2>One event, a traceable receipt.</h2>
        <p>
          Each submission obtains and verifies a fresh service token. Tokens
          stay on the Inspector server.
        </p>
        <p>
          Allow qa.inspection.completed in this installation’s event types and
          campus.webhooks.write in its scopes. Existing registered apps may need
          their allowlist updated.
        </p>
        <p>
          Installation:{" "}
          <code>
            {boot.registration.installation_id ||
              "Resolved from the verified token"}
          </code>
        </p>
        <p>
          Submitting a valid event creates a Campus receipt record. HTTP 202
          confirms acceptance; check the Campus database and audit separately to
          verify ownership, envelope, timestamps and comparison hash.
        </p>
        <p>
          No automatic retry occurs. After a timeout, receipt may be unknown.
          Check Campus before sending again. In raw mode, reset the envelope
          when you need a new event ID.
        </p>
        <p>
          Request logs and exports omit event bodies, credentials and upstream
          descriptions. Use the editable envelope only for synthetic QA data.
        </p>
      </section>
    </div>
  );
}
