import type { InspectionResult } from "@/lib/contracts";
import { RunDetail } from "./RunDetail";
export function History({
  runs,
  selected,
  onOpen,
  onBack,
  onSetup,
}: {
  runs: InspectionResult[];
  selected?: InspectionResult;
  onOpen: (r: InspectionResult) => void;
  onBack: () => void;
  onSetup: () => void;
}) {
  return (
    <section className="panel">
      <div className="section-title">
        <div>
          <span className="eyebrow">OBSERVED EVIDENCE</span>
          <h2>{selected ? "Inspection detail" : "Recent inspections"}</h2>
        </div>
        <a className="button secondary" href="/api/evidence" download>
          ↓ Export JSON
        </a>
      </div>
      {selected ? (
        <RunDetail run={selected} onBack={onBack} />
      ) : runs.length ? (
        <div className="run-list">
          {runs.map((r) => (
            <button key={r.id} onClick={() => onOpen(r)}>
              <span className="run-kind">{r.kind === "oidc" ? "↗" : "⇄"}</span>
              <span>
                <strong>
                  {r.kind === "oidc"
                    ? "OIDC launch"
                    : r.scenario?.replaceAll("_", " ")}
                </strong>
                <small>{new Date(r.createdAt).toLocaleString()}</small>
              </span>
              <span className={"badge " + r.status}>{r.status}</span>
              <span aria-hidden="true">→</span>
            </button>
          ))}
        </div>
      ) : (
        <div className="empty">
          <span aria-hidden="true">⌁</span>
          <h3>Your first inspection starts here.</h3>
          <p>
            Register your app, then run a launch or an OAuth scenario.
            <br />
            Observed evidence will appear here.
          </p>
          <button className="secondary" onClick={onSetup}>
            Set up your app →
          </button>
        </div>
      )}
    </section>
  );
}
