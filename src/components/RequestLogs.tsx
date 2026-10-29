"use client";
import { useEffect, useState } from "react";
import type { HttpLog, HttpLogSummary } from "@/lib/contracts";
import { HttpLogDetail } from "./HttpLogDetail";
export function RequestLogs({ runId }: { runId?: string }) {
  const [logs, setLogs] = useState<HttpLogSummary[]>(),
    [selected, setSelected] = useState<string>(),
    [detail, setDetail] = useState<HttpLog>(),
    [error, setError] = useState(""),
    [detailError, setDetailError] = useState(""),
    [kind, setKind] = useState("all"),
    [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/logs" + (runId ? "?run_id=" + encodeURIComponent(runId) : ""), {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (res) => {
        if (!res.ok)
          throw new Error(
            res.status === 401
              ? "Sign in to view request logs"
              : "Could not load request logs",
          );
        return (await res.json()) as HttpLogSummary[];
      })
      .then((data) => {
        setLogs(data);
        setSelected(data[0]?.id);
        setKind("all");
        setError("");
        setDetailError("");
      })
      .catch((e) => {
        if (e.name !== "AbortError") setError(e.message);
      });
    return () => controller.abort();
  }, [runId, refresh]);
  useEffect(() => {
    if (!selected) return;
    const controller = new AbortController();
    fetch("/api/logs/" + encodeURIComponent(selected), {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (res) => {
        if (!res.ok)
          throw new Error(
            res.status === 404
              ? "This log has expired or was removed by retention"
              : "Could not load request details",
          );
        return (await res.json()) as HttpLog;
      })
      .then((data) => {
        setDetail(data);
        setDetailError("");
      })
      .catch((e) => {
        if (e.name !== "AbortError") setDetailError(e.message);
      });
    return () => controller.abort();
  }, [selected, refresh]);
  const visible = logs?.filter((log) => kind === "all" || log.kind === kind);
  return (
    <section
      className={runId ? "run-traffic" : "panel"}
      aria-label="Request and response logs"
    >
      <div className="section-title">
        <div>
          <span className="eyebrow">OBSERVED INTEGRATION TRAFFIC</span>
          <h2>Request & response logs</h2>
        </div>
        <button
          className="secondary"
          onClick={() => setRefresh((value) => value + 1)}
        >
          ↻ Reload logs
        </button>
      </div>
      <p className="caption">
        Request and response bodies are redacted before storage. Passwords,
        tokens, assertions, state, nonce and launch references are never shown.
        At most 500 entries are kept for 24 hours.
      </p>
      {error ? (
        <p role="alert" className="error">
          {error}
        </p>
      ) : !logs ? (
        <p role="status">Loading request logs…</p>
      ) : !logs.length ? (
        <div className="empty">
          <h3>No request logs yet.</h3>
          <p>
            {runId
              ? "Older inspections may predate request logging."
              : "Start a launch or OAuth scenario to record integration traffic."}
          </p>
        </div>
      ) : (
        <>
          <div className="log-filters">
            <label htmlFor={runId ? "run-log-kind" : "log-kind"}>
              Traffic type
            </label>
            <select
              id={runId ? "run-log-kind" : "log-kind"}
              value={kind}
              onChange={(e) => {
                const next = e.target.value;
                setKind(next);
                setSelected(
                  logs.find((log) => next === "all" || log.kind === next)?.id,
                );
                setDetailError("");
              }}
            >
              <option value="all">All traffic</option>
              <option value="oauth">OAuth</option>
              <option value="webhook">Webhook</option>
              <option value="jwks">JWKS</option>
              <option value="oidc">OIDC</option>
            </select>
            <span className="caption">{visible?.length} entries</span>
          </div>
          {!visible?.length ? (
            <p>No entries match this traffic type.</p>
          ) : (
            <div className="http-log-grid">
              <div className="http-log-list" aria-label="Recorded requests">
                {visible.map((log) => (
                  <button
                    key={log.id}
                    className={selected === log.id ? "selected" : ""}
                    aria-pressed={selected === log.id}
                    onClick={() => {
                      setSelected(log.id);
                      setDetailError("");
                    }}
                  >
                    <span>
                      <strong>
                        {log.method} · {log.kind.toUpperCase()}
                      </strong>
                      <code>{log.url}</code>
                      <small>
                        {new Date(log.createdAt).toLocaleTimeString()}
                        {log.profile ? " · " + log.profile.name : ""}
                      </small>
                    </span>
                    <span className="badge neutral">
                      {log.status ??
                        (log.outcome === "unavailable"
                          ? "Unavailable"
                          : "Unobserved")}
                    </span>
                  </button>
                ))}
              </div>
              <div>
                {detailError ? (
                  <p role="alert" className="error">
                    {detailError}
                  </p>
                ) : detail && detail.id === selected ? (
                  <HttpLogDetail log={detail} />
                ) : (
                  <p role="status">Loading request details…</p>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}
