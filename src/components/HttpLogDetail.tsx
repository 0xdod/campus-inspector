import type { HttpLog } from "@/lib/contracts";
function Payload({
  title,
  body,
  headers,
}: {
  title: string;
  body: HttpLog["request"]["body"];
  headers: Record<string, string>;
}) {
  return (
    <section className="http-payload">
      <h3>{title}</h3>
      <pre>
        {body === null
          ? "[No body]"
          : typeof body === "string"
            ? body
            : JSON.stringify(body, null, 2)}
      </pre>
      <details>
        <summary>Headers</summary>
        <pre>{JSON.stringify(headers, null, 2)}</pre>
      </details>
    </section>
  );
}
export function HttpLogDetail({ log }: { log: HttpLog }) {
  return (
    <article className="http-log-detail">
      <div className="section-title">
        <div>
          <span className="eyebrow">
            {log.direction.replaceAll("_", " ")} · {log.kind.toUpperCase()}
          </span>
          <h3>
            <code>
              {log.request.method} {log.request.url}
            </code>
          </h3>
        </div>
        <span
          className={
            "badge " +
            (log.response
              ? "neutral"
              : log.outcome === "unavailable"
                ? "blocked"
                : "neutral")
          }
        >
          {log.response
            ? "HTTP " + log.response.status
            : log.outcome === "unavailable"
              ? "Unavailable"
              : "Not observed"}
        </span>
      </div>
      <p className="caption">
        {new Date(log.createdAt).toLocaleString()}
        {log.durationMs !== undefined ? ` · ${log.durationMs}ms` : ""}
        {log.profile ? " · " + log.profile.name : ""}
      </p>
      {log.note && <p className="caption">{log.note}</p>}
      <div className="http-payloads">
        <Payload
          title="Request body"
          body={log.request.body}
          headers={log.request.headers}
        />
        {log.response ? (
          <Payload
            title="Response body"
            body={log.response.body}
            headers={log.response.headers}
          />
        ) : (
          <section className="http-payload">
            <h3>Response body</h3>
            <p>
              {log.direction === "browser_redirect"
                ? "No Campus response was observed by the inspector. This record captures the prepared redirect."
                : "No complete response was received. No response body is available."}
            </p>
          </section>
        )}
      </div>
    </article>
  );
}
