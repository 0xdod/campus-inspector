"use client";
import type { AppProfile, Bootstrap, ProfileInput } from "@/lib/contracts";
export function ProfileForm({
  profile,
  boot,
  busy,
  onSave,
}: {
  profile?: AppProfile;
  boot: Bootstrap;
  busy: boolean;
  onSave: (input: ProfileInput) => Promise<void>;
}) {
  return (
    <form
      key={profile ? profile.id + profile.updatedAt : "new-profile"}
      onSubmit={async (e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        await onSave({
          name: String(data.get("name")),
          campusBase: String(data.get("campusBase")),
          issuer: String(data.get("issuer")),
          client_id: String(data.get("client_id")),
          ...(data.get("installation_id")
            ? { installation_id: String(data.get("installation_id")) }
            : {}),
        });
      }}
    >
      <h3>{profile ? "Edit saved profile" : "Add an app and platform"}</h3>
      <label htmlFor="profile-name">Profile name</label>
      <input
        id="profile-name"
        name="name"
        required
        maxLength={80}
        defaultValue={profile?.name}
        placeholder="e.g. Campus staging · QA app"
      />
      <label htmlFor="profile-base">Campus request base</label>
      <input
        id="profile-base"
        name="campusBase"
        type="url"
        required
        maxLength={2048}
        defaultValue={profile?.campusBase ?? boot.campusBase}
      />
      <p className="caption">
        Include any gateway prefix, such as /api/backend.
      </p>
      <label htmlFor="profile-issuer">Expected issuer</label>
      <input
        id="profile-issuer"
        name="issuer"
        type="url"
        required
        maxLength={2048}
        defaultValue={profile?.issuer ?? boot.issuer}
      />
      <p className="caption">
        Must match the platform issuer exactly, including its trailing slash.
      </p>
      <label htmlFor="client-id">Client ID</label>
      <input
        id="client-id"
        name="client_id"
        required
        maxLength={256}
        defaultValue={profile?.client_id}
      />
      <label htmlFor="installation-id">
        Installation ID <span className="muted">(optional)</span>
      </label>
      <input
        id="installation-id"
        name="installation_id"
        maxLength={256}
        defaultValue={profile?.installation_id}
      />
      <button disabled={busy}>
        {busy ? "Saving…" : profile ? "Save profile changes" : "Save profile"}
      </button>
    </form>
  );
}
