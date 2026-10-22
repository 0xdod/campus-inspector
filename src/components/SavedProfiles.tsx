"use client";
import { useState } from "react";
import type { AppProfile, Bootstrap, ProfileInput } from "@/lib/contracts";
import type { RequestFn } from "./Console";
import { ProfileForm } from "./ProfileForm";
export function SavedProfiles({
  boot,
  request,
  onSave,
}: {
  boot: Bootstrap;
  request: RequestFn;
  onSave: () => Promise<void>;
}) {
  const [editingId, setEditingId] = useState<string | null>(
    boot.activeProfileId,
  );
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [error, setError] = useState("");
  const editing = boot.profiles.find((p) => p.id === editingId);
  async function save(input: ProfileInput) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const saved = (await request(
        editing ? "profiles/" + editing.id : "profiles",
        editing ? "PUT" : "POST",
        input,
      )) as AppProfile;
      setEditingId(saved.id);
      await onSave();
      setMessage(
        boot.activeProfileId === saved.id
          ? "Profile changes saved. New inspections use the updated settings."
          : "Profile saved. Use it to make this app and platform active.",
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save profile");
    } finally {
      setBusy(false);
    }
  }
  async function activate(profile: AppProfile) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await request("active-profile", "PUT", { profile_id: profile.id });
      await onSave();
      setMessage(`${profile.name} is now active for new inspections.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not activate profile");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel">
      <div className="section-title">
        <div>
          <span className="eyebrow">SAVED APPS & PLATFORMS</span>
          <h2>Your saved profiles</h2>
        </div>
        <button
          className="secondary"
          disabled={busy}
          onClick={() => {
            setEditingId(null);
            setMessage("");
            setError("");
          }}
        >
          ＋ Add profile
        </button>
      </div>
      <p>
        Keep each app’s environment and registration together. Edit a profile or
        use it for new launches and OAuth runs. Saving here does not register or
        update the app in Campus.
      </p>
      <div className="profile-manager-columns">
        <div className="profile-list">
          {boot.profiles.length ? (
            boot.profiles.map((profile) => (
              <article
                className="profile-row"
                key={profile.id}
                aria-label={profile.name}
              >
                <div className="section-title">
                  <h3>{profile.name}</h3>
                  {boot.activeProfileId === profile.id && (
                    <span className="badge passed">Active</span>
                  )}
                </div>
                <dl>
                  <dt>Request base</dt>
                  <dd>
                    <code>{profile.campusBase}</code>
                  </dd>
                  <dt>Issuer</dt>
                  <dd>
                    <code>{profile.issuer}</code>
                  </dd>
                  <dt>Client ID</dt>
                  <dd>
                    <code>{profile.client_id}</code>
                  </dd>
                  {profile.installation_id && (
                    <>
                      <dt>Installation</dt>
                      <dd>
                        <code>{profile.installation_id}</code>
                      </dd>
                    </>
                  )}
                </dl>
                <p className="caption">
                  Saved {new Date(profile.updatedAt).toLocaleString()}
                </p>
                <div className="profile-actions">
                  <button
                    className="secondary"
                    aria-label={"Edit " + profile.name}
                    disabled={busy}
                    onClick={() => {
                      setEditingId(profile.id);
                      setMessage("");
                      setError("");
                    }}
                  >
                    Edit
                  </button>
                  <button
                    aria-label={"Use " + profile.name}
                    disabled={busy || boot.activeProfileId === profile.id}
                    onClick={() => void activate(profile)}
                  >
                    {boot.activeProfileId === profile.id
                      ? "In use"
                      : "Use profile"}
                  </button>
                </div>
              </article>
            ))
          ) : (
            <div className="empty">
              <h3>No saved profiles yet.</h3>
              <p>
                Add the registered app IDs and its Campus environment to keep
                them here.
              </p>
            </div>
          )}
        </div>
        <ProfileForm profile={editing} boot={boot} busy={busy} onSave={save} />
      </div>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <p role="status" className="caption">
        {message}
      </p>
      <p className="caption">
        Profiles persist across restarts and are shared by operators of this
        inspector. Run history keeps the profile used at the time of each
        inspection.
      </p>
    </section>
  );
}
