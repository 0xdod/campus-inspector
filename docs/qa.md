# Real Campus QA runbook

Automated tests use deterministic local fixture Campus servers and generated RSA keys. They do not prove live staging behavior. Supply live values only through your deployment configuration and operator forms, never committed fixtures.

## Authorized reference preparation

The inspector cannot mint Campus references and has no Campus DB/Redis credentials. An authorized development/test harness must call the backend's injected Campus Apps service `CreateLaunchReference` with the original authenticated UserID, TenantID, AppID, ClientID, InstallationPK, InstallationID, LaunchType (student/admin), and TargetLinkURI. The target must equal this app's registered launch URL and approved callback (`<PUBLIC_URL>/oidc/callback`). Each reference lasts five minutes, is opaque and single-use. No unauthenticated fixture route is added.

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
