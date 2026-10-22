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
