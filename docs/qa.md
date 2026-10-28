# Real Campus QA runbook

Automated tests use deterministic local fixture Campus servers and generated RSA keys. They do not prove live staging behavior. Supply live values only through your deployment configuration and operator forms, never committed fixtures.

## Normal student and administrator launches

Register the inspector’s `/oidc/initiate` URL and approved `/oidc/callback` URL in Campus, save the returned client/installation IDs, and activate the matching saved profile. Use the numeric app ID returned by registration for these requests; client and installation IDs are different identifiers.

Against the profile’s Campus request base, use your authorized API client to call either:

- `GET /students/campus-apps/{appId}/launch` with a direct student session (Bearer or student session cookie). No RBAC permission is required.
- `GET /admin/campus-apps/{appId}/launch` with a direct administrator session (Bearer or admin session cookie) and system-scoped `campus_apps.app.read`.

Impersonation is rejected. The app and tenant installation must be active. Both endpoints return HTTP 200 with an initiation URL string in the standard envelope’s `data` field; they do not redirect automatically. Open that exact URL in a browser within five minutes. The backend binds it to the authenticated user, tenant, app, installation and launch type, and supplies `iss`, `login_hint`, `client_id`, `target_link_uri`, `installation_id` and `login_message_hint`. The inspector’s existing public initiation route starts the correlated OIDC flow and verifies the form-post callback. No manual user ID/reference entry or custom harness is needed for this normal path. Request a new URL for every launch; references are single-use.

Keep Campus session credentials in the authorized API client, outside the inspector. Do not save full initiation URLs or references in QA evidence. The operator must sign in to view the resulting inspection; a public callback never creates an operator session.

## Advanced reference preparation

The inspector cannot mint Campus references and has no Campus DB/Redis credentials. For controlled fixtures that cannot be prepared with the normal launch endpoints, an authorized development/test harness can call the backend's injected Campus Apps service `CreateLaunchReference` with the original authenticated UserID, TenantID, AppID, ClientID, InstallationPK, InstallationID, LaunchType (student/admin), and TargetLinkURI. The target must equal this app's registered launch URL and approved callback (`<PUBLIC_URL>/oidc/callback`). Each reference lasts five minutes, is opaque and single-use. No unauthenticated fixture route is added. Use the Launch inspector’s manual form for these prepared references and nonce overrides.

Prepare independent fixtures for valid issuance, expired reference, consumed reference, revoked membership/disabled app or tenant (403), and missing resources (404). Never treat a random invalid reference as proof of expiry or consumption. Nonce replay needs **two fresh references** and the same advanced nonce override; replaying inspector callback state only tests inspector correlation.

Start with the original positive user ID. The inspector redirects to Campus with the prepared reference as login_message_hint. Campus returns form-post id_token/state. If Campus rejects before callback, the browser remains at its JSON error; record that actual response externally in the QA ticket. The inspector cannot observe its status, infer success/failure or fabricate a callback run.

## OAuth expectations

| Scenario | Expected |
| --- | --- |
| valid | 200 and fully verified bearer |
| missing_scope | 400 invalid_scope |
| missing_assertion | 400 invalid_request |
| expired_assertion | 401 invalid_client |
| wrong_audience | 401 invalid_client |
| foreign_key | 401 invalid_client |
| jti_replay | fully verified first issuance, exact assertion replay → 401 invalid_client |

A negative run passes only on the expected rejection; upstream network/keys/timeouts/429/5xx/non-JSON/redirects block the run. A `200 {}` first replay response is blocked and never replayed. Custom requested scope is a deliberate test input; only requested/granted campus.webhooks.write can pass successful issuance validation. Invalid envelopes or binding checks fail.

Use the authenticated history detail to inspect checks. Export JSON excludes claims/context and reflected upstream descriptions. Do not attach raw bearer tokens, assertions, passwords or references to tickets. Record deployment issuer/base, fixture preparation method and exact observed live outcome separately. Live Campus registration, authorized fixtures, public JWKS reachability and Campus-side nonce/key-cache behavior require live validation before asserting staging readiness.

## Inbound webhook QA

Use the [Webhooks playground guide](webhooks.md) for first receipt, error presets, raw-body validation, exact size boundaries and manual database/audit checks. A passing HTTP inspection alone does not verify backend persistence.
