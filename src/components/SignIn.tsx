"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
export function SignIn() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <main className="signin">
      <div className="brand">
        <span className="brandmark">C</span> CAMPUS{" "}
        <span className="mono">/ inspector</span>
      </div>
      <section className="signin-panel">
        <span className="eyebrow">ENGINEERING & QA</span>
        <h1>Look inside the handshake.</h1>
        <p>
          Inspect Campus Apps launches and service authentication against your
          configured environment.
        </p>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            try {
              const password = new FormData(e.currentTarget).get("password");
              const res = await fetch("/api/session", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ password }),
              });
              const body = await res.json();
              if (!res.ok) throw new Error(body.message);
              const run = new URLSearchParams(window.location.search).get(
                "run",
              );
              router.replace(
                run && /^[A-Za-z0-9-]{1,64}$/.test(run) ? "/?run=" + run : "/",
              );
              router.refresh();
            } catch (e) {
              setError(e instanceof Error ? e.message : "Sign-in failed");
              setBusy(false);
            }
          }}
        >
          <label htmlFor="password">Operator password</label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            maxLength={1024}
          />
          <button disabled={busy} type="submit">
            {busy ? "Signing in…" : "Open inspector →"}
          </button>
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
        </form>
        <p className="caption">
          This signs you into the inspector console. Campus authentication is
          inspected separately.
        </p>
      </section>
      <footer>Campus Apps protocol · OIDC + OAuth 2.0</footer>
    </main>
  );
}
