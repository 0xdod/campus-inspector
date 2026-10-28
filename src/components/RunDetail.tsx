import { RequestLogs } from "./RequestLogs";
import type { InspectionResult } from "@/lib/contracts";
export function RunDetail({
  run,
  onBack,
}: {
  run: InspectionResult;
  onBack: () => void;
}) {
  return (
    <div className="run-detail">
      <button className="text-button" onClick={onBack}>
        ← All inspections
      </button>
      <div className="section-title">
        <div>
          <h3>
            {run.kind === "oidc"
              ? "OIDC launch"
              : (run.kind === "webhook" ? "Webhook · " : "") +
                run.scenario?.replaceAll("_", " ")}
          </h3>
          <p className="caption">
            {new Date(run.createdAt).toLocaleString()} · <code>{run.id}</code>
            {run.durationMs !== undefined && ` · ${run.durationMs}ms`}
          </p>
        </div>
        <span
          role="status"
          aria-label="Inspection result"
          className={"badge " + run.status}
        >
          {run.status}
        </span>
      </div>
      {run.profile && (
        <p className="caption">
          Profile at run time: <strong>{run.profile.name}</strong>
          <br />
          Request base <code>{run.profile.campusBase}</code>
          <br />
          Expected issuer <code>{run.profile.issuer}</code>
        </p>
      )}
      {run.expected && (
        <p>
          Expected HTTP {run.expected.status} {run.expected.error}
        </p>
      )}
      <ol className="checks">
        {run.checks.map((c, i) => (
          <li key={i}>
            <span className={"check-icon " + c.status} aria-hidden="true">
              {c.status === "passed" ? "✓" : c.status === "failed" ? "×" : "–"}
            </span>
            <div>
              <strong>
                {c.name}{" "}
                <span className="caption">{c.status.replaceAll("_", " ")}</span>
              </strong>
              <p>{c.message}</p>
            </div>
          </li>
        ))}
      </ol>
      <RequestLogs runId={run.id} />
      {run.exchanges?.map((exchange, i) => (
        <details key={i} open>
          <summary>
            Exchange {i + 1}
            {exchange.endpoint ? " · " + exchange.endpoint.toUpperCase() : ""} ·
            actual HTTP {exchange.status}
            {exchange.error ? " · " + exchange.error : ""}
          </summary>
          <pre>
            {JSON.stringify(
              { response: exchange.response, rateLimit: exchange.rateLimit },
              null,
              2,
            )}
          </pre>
        </details>
      ))}
      {run.request && (
        <details>
          <summary>Redacted request metadata</summary>
          <pre>{JSON.stringify(run.request, null, 2)}</pre>
        </details>
      )}
      {run.claims && (
        <details open>
          <summary>
            Technical claims ·{" "}
            {run.verified
              ? "signature verified; review binding checks above"
              : "UNVERIFIED decoded data"}
          </summary>
          <p className="caption">
            Allowlisted technical claims only. Identity and authorization are
            trusted only when all required checks pass.
          </p>
          <pre>
            {JSON.stringify(
              { header: run.header, claims: run.claims },
              null,
              2,
            )}
          </pre>
        </details>
      )}
    </div>
  );
}
