"use client";
import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Bootstrap, InspectionResult } from "@/lib/contracts";
import { SavedProfiles } from "./SavedProfiles";
import { Setup } from "./Setup";
import { Playgrounds } from "./Playgrounds";
import { History } from "./History";
import { Overview } from "./Overview";
type Tab = "overview" | "setup" | "profiles" | "launch" | "oauth" | "history";
const nav: { id: Tab; label: string; symbol: string }[] = [
  { id: "overview", label: "Overview", symbol: "◫" },
  { id: "setup", label: "App setup", symbol: "◇" },
  { id: "profiles", label: "Saved apps", symbol: "▦" },
  { id: "launch", label: "Launch inspector", symbol: "↗" },
  { id: "oauth", label: "OAuth playground", symbol: "⇄" },
  { id: "history", label: "Run history", symbol: "◷" },
];
export function Console() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("overview");
  const [boot, setBoot] = useState<Bootstrap>();
  const [runs, setRuns] = useState<InspectionResult[]>([]);
  const [selected, setSelected] = useState<InspectionResult>();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const request = useCallback(
    async (path: string, method = "GET", body?: unknown) => {
      const res = await fetch("/api/" + path, {
        method,
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
          ...(boot ? { "x-csrf-token": boot.csrf } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      const data = await res.json();
      if (res.status === 401) {
        router.replace("/signin");
        throw new Error("Session expired");
      }
      if (!res.ok)
        throw new Error(
          data.errors?.[0]?.message || data.message || "Request failed",
        );
      return data;
    },
    [boot, router],
  );
  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/bootstrap", { cache: "no-store" });
      if (res.status === 401) {
        router.replace("/signin");
        return;
      }
      if (!res.ok) throw new Error("Could not load inspector configuration");
      const data: Bootstrap = await res.json();
      setBoot(data);
      const list = await fetch("/api/history", { cache: "no-store" });
      if (!list.ok) throw new Error("Could not load history");
      setRuns(await list.json());
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load console");
    } finally {
      setLoading(false);
    }
  }, [router]);
  useEffect(() => {
    // Synchronizes initial console state with the authenticated network source.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [refresh]);
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("run");
    if (id) {
      fetch("/api/history/" + encodeURIComponent(id), { cache: "no-store" })
        .then(async (res) => {
          if (!res.ok)
            throw new Error(
              "Inspection unavailable; sign in again or check retention",
            );
          setSelected(await res.json());
          setTab("history");
        })
        .catch((e) => setError(e.message));
    }
  }, []);
  async function open(run: InspectionResult) {
    try {
      setSelected(await request("history/" + run.id));
      setTab("history");
      window.history.replaceState(null, "", "/?run=" + run.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to open inspection");
    }
  }
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Link className="brand" href="/">
          <span className="brandmark">C</span>
          <span>
            CAMPUS<small>APP INSPECTOR</small>
          </span>
        </Link>
        <div className="workspace-label">DEVELOPER WORKSPACE</div>
        <nav aria-label="Inspector sections">
          {nav.map((item) => (
            <button
              key={item.id}
              aria-label={item.label}
              className={tab === item.id ? "active" : ""}
              aria-current={tab === item.id ? "page" : undefined}
              onClick={() => {
                setTab(item.id);
                setSelected(undefined);
              }}
            >
              <span aria-hidden="true">{item.symbol}</span>
              {item.label}
              {item.id === "history" && <small>{runs.length}</small>}
            </button>
          ))}
        </nav>
        <div className="sidebar-note">
          <span className="status-dot" />
          One active profile
          <p>
            OIDC launch verification
            <br />
            OAuth service authentication
          </p>
        </div>
        <button
          className="signout"
          onClick={async () => {
            try {
              await request("session", "DELETE");
              router.replace("/signin");
            } catch (e) {
              setError(e instanceof Error ? e.message : "Sign-out failed");
            }
          }}
        >
          Sign out ↗
        </button>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <span>
            Workspace <span className="muted">/</span>{" "}
            <strong>{nav.find((n) => n.id === tab)?.label}</strong>
          </span>
          <span className="protocol-tag">CAMPUS APPS · v1</span>
        </header>
        <main id="main">
          <div className="page-heading">
            <div>
              <span className="eyebrow">AUTHENTICATION WORKBENCH</span>
              <h1>
                {tab === "overview"
                  ? "Inspect every connection."
                  : nav.find((n) => n.id === tab)?.label}
              </h1>
              <p>
                {tab === "overview"
                  ? "One place to prepare, launch, and verify your Campus integration."
                  : "Real protocol requests. Traceable checks. Redacted evidence."}
              </p>
            </div>
            <button className="secondary" onClick={() => void refresh()}>
              ↻ Refresh
            </button>
          </div>
          {error && (
            <div role="alert" className="error">
              {error}
              <button className="text-button" onClick={() => void refresh()}>
                Try again
              </button>
            </div>
          )}
          {loading ? (
            <div role="status" className="empty">
              Loading your environment…
            </div>
          ) : boot ? (
            <>
              <section className="environment">
                <span className="env-icon">◎</span>
                <div>
                  <span className="eyebrow">
                    {boot.profiles.find((p) => p.id === boot.activeProfileId)
                      ?.name || "CONFIGURED CAMPUS ENVIRONMENT"}
                  </span>
                  <div className="mono">{boot.campusBase}</div>
                  <div className="caption">
                    Expected issuer <code>{boot.issuer}</code>
                  </div>
                </div>
                <span className="badge neutral">
                  {boot.campusBase.startsWith("http:")
                    ? "Local HTTP enabled"
                    : "HTTPS"}
                </span>
              </section>
              {tab === "overview" && (
                <>
                  <Overview boot={boot} runs={runs} onNavigate={setTab} />
                </>
              )}
              {tab === "profiles" && (
                <SavedProfiles boot={boot} request={request} onSave={refresh} />
              )}
              {tab === "setup" && (
                <Setup boot={boot} request={request} onSave={refresh} />
              )}
              {(tab === "launch" || tab === "oauth") && (
                <Playgrounds
                  kind={tab}
                  ready={!!boot.registration.client_id}
                  request={request}
                  onResult={async (run) => {
                    await refresh();
                    setSelected(run);
                    setTab("history");
                  }}
                />
              )}
              {(tab === "overview" || tab === "history") && (
                <History
                  runs={runs}
                  selected={selected}
                  onOpen={(r) => void open(r)}
                  onBack={() => {
                    setSelected(undefined);
                    window.history.replaceState(null, "", "/");
                  }}
                  onSetup={() => setTab("setup")}
                />
              )}
            </>
          ) : null}
          <footer className="console-footer">
            <span>Campus App Inspector</span>
            <span>
              Tokens stay server-side. Exported evidence omits claims and
              context.
            </span>
          </footer>
        </main>
      </div>
    </div>
  );
}
export type RequestFn = (
  path: string,
  method?: string,
  body?: unknown,
) => Promise<unknown>;
