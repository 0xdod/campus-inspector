# Verification record — 2026-10-22

This is fixture verification, not live staging evidence. No external deployment, Campus registration or staging fixture mutation was performed.

| Check | Result | Evidence / scope |
| --- | --- | --- |
| `npm ci` | Passed | Clean installation from committed lockfile. |
| `npm run typecheck` | Passed | Next route type generation plus strict TypeScript. |
| `npm run lint` | Passed | Next, React, accessibility and TypeScript ESLint configuration. |
| `npm test` | Passed | 70 unit/integration tests using generated RSA keys, actual SQLite and a loopback Campus HTTP fixture. |
| `npm run build` | Passed | Production Node standalone app, dynamic pages/routes, bundled migrations and static assets. |
| `npm run test:e2e` | Passed | Four Chromium tests against production standalone output. Real browser OIDC form-post, cookie-free callback and no session creation, OAuth replay, setup, export, auth/CSRF, HTTP contracts and responsive UI. |
| Browser runtime | Passed | No page/console errors in the main authenticated journey; mobile screenshot manually inspected. All sections at 320px; overflow checks at 768/1024/1440px. |
| Privacy | Passed for tested fixture sentinels | Unknown/profile claims and reflected credentials omitted; authenticated API payloads scanned for raw compact JWTs; export omits claims/context; production client bundles scanned for private-key markers, fixture password and seeded profile sentinel, with no matches. |
| Production dependency audit | Passed | `npm audit --omit=dev`: zero vulnerabilities. |
| Full dependency audit | Known development-only finding | Five high-severity entries in the eslint-config-next → glob/micromatch/braces chain; no fixed braces release available. No untrusted runtime globs are accepted. |
| Compose syntax | Passed | Validated using the committed example environment; no service launched. |
| Docker image smoke | **Blocked** | Docker Hub timed out loading `node:24.22.1-bookworm-slim` metadata; public ECR mirror returned a rate limit. A direct retry stalled and was stopped. The actual image/restrictions/restart test could not run. `npm run test:docker` and CI implement it; rerun when registry access works. |
| Live Campus integration | **Not run** | Requires authorized registration, public HTTPS JWKS reachability, actual environment configuration and prepared references. |

Regression coverage includes exactly one winner among ten state consumes, consume-before-verification, malformed identity JWT and unknown/tampered key, algorithm substitution, issuer/audience/subject/azp/nonce/context/time/lifetime mismatch, unsafe/private/duplicate/oversized/redirecting/timed-out JWKS, all seven OAuth scenarios, `200 {}` replay gating, invalid service envelopes/bindings/lifetime, upstream 429/non-JSON/redirect/5xx without retry, JWKS 429 evidence, nonnumeric user ID returning 400, storage rejection returning generic 500, expiry/retention/200-run cap and restart durability for key, registration, session and history.

The deterministic fixture implements just the Campus contract needed for these checks; it is not a replacement Campus backend or an authority for live authorization rules. Campus-side reference expiry/consumption, revoked membership, missing resources, nonce enforcement across two fresh references and platform five-minute key caching still need separate live fixtures/observations. Cookie-free callback correlation was verified with an empty browser context; no assumption about SameSite operator cookie delivery is needed.

Screenshots are generated in ignored `test-results/console-desktop.png` and `test-results/console-mobile.png`; failures retain Playwright traces. These contain only fixture identities. Do not commit live evidence containing sensitive technical IDs or roles.

## Saved apps/platforms follow-up

The saved-profile feature was verified with 82 unit/integration tests in the current workspace and five production Chromium browser tests. The browser suite used isolated ports 18090/18091 to preserve the user's running development server. Checks cover add/list/edit/activate/reload, two profiles retained together, CSRF/session/method/validation/404 contracts, original-schema migration without losing registration/history, durable selection, a non-evicting 200-profile bound, and pending launches/OAuth requests remaining bound to their captured profile after switching or editing. A production-only cross-bundle error-class mismatch was reproduced and fixed; unknown profiles now correctly return 404 instead of 500. Typecheck, lint and production build passed. Screenshots were inspected at mobile and desktop widths. Existing deployment configuration edits were preserved.

## Request/response logs follow-up

The traffic-log feature passed 93 unit/integration tests and five Chromium browser tests against the production build on isolated ports 18090/18091. Typecheck, lint and production build passed. Coverage includes actual OAuth and JWKS request/response bodies, separate replay exchanges, callback bodies and responses, unobserved browser redirects, network failures without invented status codes, persistence failures, authenticated read-only log endpoints, redaction, restart durability, and the 500-entry/24-hour retention limits. Browser checks verified global and per-run access, filtering, body inspection, HTTP contracts and fixture credential redaction. Desktop and mobile screenshots were inspected; responsive overflow checks passed. Logs capture new traffic only; existing runs are not backfilled. Existing configuration edits were preserved.

## Backend launch guidance follow-up

The normal setup path now uses the existing authenticated student/admin Campus App launch endpoints and opens the initiation URL returned in `data`. Backend handler and QA contracts were checked in the local backend source; no backend code was changed. The manual reference form remains available for advanced fixtures. All 93 unit/integration tests, five production Chromium tests, typecheck, lint and build passed. The browser suite verifies the endpoint instructions and a public initiation URL with the backend's issuer, user, client, installation, target and reference fields, completing the callback without operator cookies. This is fixture verification; no authenticated live student/admin endpoint was called.

## OAuth timeout follow-up

A live tunnel observation showed Campus returning HTTP 200 after the inspector's five-second request deadline had elapsed; the inspector correctly recorded unavailable evidence, but its deadline was too short for the round trip plus Campus fetching the app's JWKS. OAuth now permits a fifteen-second request deadline, retaining a separate five-second DNS deadline, the five-second platform JWKS request deadline, body limits, destination checks and no retries. A six-second successful token fixture failed before this fix and fully verifies afterward. A hanging OAuth fixture is still blocked with unavailable evidence and exactly one request. All 95 unit/integration tests, lint and typecheck passed. Live OAuth was not reissued by the agent after this change.

## Webhook playground verification — 2026-10-28

- npm test: 131 unit/integration tests passed across 8 files.
- npm run typecheck and npm run lint: passed.
- npm run build: production webpack/standalone build passed.
- npm run test:e2e: all 5 Chromium browser tests passed against that build.
- Browser coverage includes new receipt, wrong-data rejection, forwarding a 262145-byte event to Campus for 413, editable raw envelopes, redacted exports and 320px responsive navigation. Desktop screenshot: test-results/webhooks-desktop.png.
- Integration coverage includes every webhook preset, exact size boundaries, verified token prerequisites, profile isolation, unknown receipt after timeout, no retry, local authentication/CSRF/quota/size controls and credential/payload redaction.
- A multibyte raw body exceeding 300000 UTF-8 bytes is rejected before token acquisition. Existing APIs retain the original 16 KiB JSON cap.
- These checks use an HTTP/RSA fixture. Live Campus tenant ownership, original envelope/hash/timestamps, receipt audit and absence of domain/outbound side effects require the manual checks in webhooks.md; no live Campus event was submitted during this verification.
