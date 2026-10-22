# Saved apps and platforms

Open **Saved apps** to keep named profiles for your app registrations. Each profile contains a Campus request base, exact issuer, client ID and optional installation ID. App setup exposes the same manager alongside the public registration endpoints.

- **Add profile** creates a new local record, preserving previous records.
- **Edit** changes that saved record without creating a duplicate. Clearing installation ID removes it from the profile.
- **Use profile** makes it the active environment and app for new inspections. Selection is shared by operators of this deployment and survives restarts. Saving a new profile does not activate it automatically.
- Local edits do not register or change an app in Campus. Perform any actual registration updates through authorized Campus administration.

The configuration in `.env` remains the deployment default until a saved profile is active. PUBLIC_URL, password, signing key, DATA_DIR and the explicit ALLOW_LOCAL_HTTP setting remain deployment configuration. Profile fields never contain bearer tokens or operator secrets. URL safety rules and per-request DNS/socket validation still apply to selected destinations; HTTP remains limited to explicitly enabled loopback development.

The first startup after this update imports the existing registration into an **Imported app** profile using the configured environment, if that registration exists and there are no profiles yet. Rename it with Edit. Only the currently stored legacy registration can be recovered: older values overwritten by the original single-registration implementation were not retained.

There are at most 200 durable profiles. Unlike inspection runs, saved profiles do not expire after 24 hours. The app does not contact Campus while saving or activating a profile; a saved profile is not proof of successful integration.

Each request captures its selected app and environment. Pending launches retain that snapshot even if another profile becomes active or the original profile is edited before callback. Launches pending from before this feature lack an environment snapshot and must be started again with a fresh reference. OAuth runs also use the captured profile. Authenticated history shows the profile and environment used at run time; evidence export continues to omit this context. Public initiation accepts only the active profile; activate the intended profile before starting a platform-initiated launch.

## APIs

All endpoints below require an operator session. POST and PUT also require canonical Origin and the session's X-CSRF-Token. Responses use no-store.

| Method and path | Behavior |
| --- | --- |
| `GET /api/profiles` | List saved profiles, including timestamps (maximum 200). |
| `POST /api/profiles` | Save a new profile; 201. Does not activate it. |
| `PUT /api/profiles/:id` | Replace editable fields of an existing profile; 200 or 404. |
| `PUT /api/active-profile` | Select `{ "profile_id": "saved-profile-id" }`; 200 or 404. |

Create/update bodies contain `name`, `campusBase`, `issuer`, `client_id`, and optional `installation_id`. The server generates immutable `id` and `createdAt`, and updates `updatedAt`. Malformed input/unsafe URLs return field-oriented 400 errors; unsupported methods return 405 with Allow. Exceeding the profile limit returns 422. No profile deletion endpoint is provided.

`GET /api/bootstrap` includes `profiles` and `activeProfileId`, and its existing environment/registration fields reflect the active profile. Existing `PUT /api/registration` callers remain supported: each distinct environment/client/installation save is retained as a profile, and an identical existing profile is reused and activated.

Schema migration `002_app_profiles.sql` adds profile/selection tables without dropping the original registration, keys, sessions or run history. Restart the service once after updating so its cached storage instance loads the migration. For a production build, rebuild and restart as usual.
