import type { Bootstrap, InspectionResult } from "@/lib/contracts";
export function Overview({
  boot,
  runs,
  onNavigate,
}: {
  boot: Bootstrap;
  runs: InspectionResult[];
  onNavigate: (tab: "setup" | "launch" | "oauth") => void;
}) {
  return (
    <>
      <div className="stats">
        <div>
          <span>Registration</span>
          <strong>
            {boot.registration.client_id ? "IDs saved" : "Setup required"}
          </strong>
          <small>
            {boot.registration.client_id
              ? "Not yet verified by saving IDs"
              : "Connect your registered app"}
          </small>
        </div>
        <div>
          <span>Inspections</span>
          <strong>{runs.length.toString().padStart(2, "0")}</strong>
          <small>Last 24 hours · up to 200</small>
        </div>
        <div>
          <span>Passed</span>
          <strong>
            {runs
              .filter((r) => r.status === "passed")
              .length.toString()
              .padStart(2, "0")}
          </strong>
          <small>Observed expected behavior</small>
        </div>
        <div>
          <span>Needs attention</span>
          <strong>
            {runs
              .filter((r) => r.status !== "passed")
              .length.toString()
              .padStart(2, "0")}
          </strong>
          <small>Failed or blocked inspections</small>
        </div>
      </div>
      <section className="panel journey">
        <div className="section-title">
          <div>
            <span className="eyebrow">THE AUTHENTICATION JOURNEY</span>
            <h2>Follow the handshake.</h2>
          </div>
          <span className="badge neutral">Browser + server</span>
        </div>
        <ol>
          <li>
            <span>01</span>
            <strong>Register the app</strong>
            <p>Publish keys and configure approved URLs in Campus.</p>
            <button className="text-button" onClick={() => onNavigate("setup")}>
              Open setup →
            </button>
          </li>
          <li>
            <span>02</span>
            <strong>Start a launch</strong>
            <p>
              Open the initiation URL from a Campus student or admin launch.
            </p>
            <button
              className="text-button"
              onClick={() => onNavigate("launch")}
            >
              Inspect a launch →
            </button>
          </li>
          <li>
            <span>03</span>
            <strong>Verify the evidence</strong>
            <p>Review signature, bindings, claims, and individual checks.</p>
            <button className="text-button" onClick={() => onNavigate("oauth")}>
              Test OAuth →
            </button>
          </li>
        </ol>
      </section>
    </>
  );
}
