# Agent handoff: rebuild Campus App Inspector in Next.js

## Assignment

Create a **new, separate repository** named `campus-app-inspector` containing a standalone full-stack Next.js application. Next.js must serve both the React frontend and backend route handlers. Do not require Go, import Campus backend code, or put the new implementation inside the Campus backend repository. This document is the implementation brief; the existing Go inspector is a behavioral reference, not the requested architecture.

Audience: Campus engineers and QA inspecting real third-party app authentication against a configurable Campus environment. The app must expose public integration endpoints and a protected operator console. It must be deployable as one Docker service with persistent storage. Webhook event submission is deferred.

Reference experience: https://lti-whisperer.lovable.app/ — clear launch inspection, decoded claims, and verification traces. Do not copy its branding or imply this is a generic LTI implementation: implement the actual Campus Apps protocol below.

## Assumptions and decisions

- One Next.js App Router project, TypeScript strict mode, Node.js runtime for backend handlers; no separate Express service, Go binary, or Edge runtime for cryptography/storage.
- One configured Campus environment and one registered app per deployment; one replica initially.
- Docker with a persistent volume is the primary deployment target. Serverless hosting without durable shared storage is outside this version's deployment contract.
- Use SQLite with migrations and transactions for durable registration, pending launches, sessions, and redacted history. Use a maintained Node SQLite driver compatible with the chosen Node LTS image; pin dependencies and commit a lockfile.
- Use `jose` for RS256/JWK/JWT work, Zod for transport validation, Vitest for unit/integration tests, and Playwright for browser tests. Use React and CSS/Tailwind for an accessible responsive console.
- During implementation, verify supported Next.js/React/Node versions and relevant APIs against official documentation. Record exact pinned versions and rationale in the README. This spec intentionally does not guess future package versions.
- A shared operator password is sufficient for this QA tool; individual accounts and SSO are deferred.
- No live staging credentials, references, tokens, or private keys belong in the repository or test fixtures.

## Existing reference material

If available, inspect these files in the original Campus backend checkout:

- `tools/campus-app-inspector/README.md`, `DESIGN.md`, `oidc.go`, `oauth.go`, `tokens.go`, `server.go`, `store.go`, and their tests.
- `docs/qa/campus-apps-oidc-login.md` for fixture preparation.
- Campus Apps service/handler code and ticket acceptance criteria for protocol details.

Translate behavior into TypeScript rather than wrapping or running the Go app. Requirements and accepted Campus contracts take precedence over accidental old behavior. When a discrepancy is discovered, document it and test the business rule. The new repository must be independently buildable without access to this checkout.

## Configuration and environment selection

Server-only environment variables:

| Variable | Meaning |
| --- | --- |
| `PUBLIC_URL` | Canonical inspector origin; HTTPS outside explicit local development |
| `CAMPUS_BASE_URL` | Backend request base, optionally including the configured gateway prefix |
| `CAMPUS_ISSUER` | Exact JWT/launch issuer, matching Campus `lti.platform_url` |
| `INSPECTOR_PASSWORD` | Required strong shared operator secret, minimum 16 characters |
| `DATA_DIR` | Persistent writable directory, default `/data` in Docker |
| `ALLOW_LOCAL_HTTP` | Explicit opt-in for loopback HTTP during development only |

Never expose secrets through `NEXT_PUBLIC_*`, client bundles, server-component props, error messages, or logs. Validate configuration at startup. Show the non-secret configured request base and expected issuer prominently in the console so QA can distinguish local and staging.

The previous preview used inspector `http://localhost:8090` and Campus `http://localhost:8081`; these are examples, not production defaults. Its temporary ngrok issuer must not be hardcoded. Request base and issuer are separate: requests can go to a local backend while JWTs identify a configured HTTPS issuer. Preserve issuer equality exactly, including trailing slash. When deriving service audience paths, remove trailing slashes before appending the path.

Append endpoint paths to the configured base without accidentally discarding a gateway prefix. Tests must cover both a direct base and a base ending `/api/backend`.

## User experience

Deliver a polished responsive console with keyboard access, labeled inputs, visible focus, readable contrast, loading/empty/error states, and no horizontal overflow at mobile widths.

1. **Sign-in:** inspector password, secure session, sign-out. Clarify that this is separate from Campus authentication.
2. **Overview:** configured environment, registration readiness, history counts, recent runs, and a brief authentication journey diagram. No fabricated successful data.
3. **App setup:** public JWKS, OIDC initiation and callback URLs; copyable Campus registration JSON; save returned `client_id` and optional `installation_id`. Saving IDs does not register or verify the app. Explain the authorized admin registration step.
4. **Launch inspector:** original user ID plus fresh prepared launch reference; advanced nonce override for replay QA. Start a real browser redirect. History/detail view with timestamp, result, request metadata, safe token header/claims, and individual validation checks. Label unverified decoded claims explicitly.
5. **OAuth playground:** scenario selector, run action, expected/actual HTTP status and OAuth error, duration, redacted request/response, token validation checks, and history.
6. **Evidence export:** download redacted JSON suitable for QA tickets; omit decoded claims and request context in exported evidence.

Use `passed`, `failed`, and `blocked` distinctly. A negative scenario passes only when the expected rejection is observed. Network/JWKS/fixture failures are blocked, never passes. Identify rate-limit responses and preserve their evidence; do not auto-retry destructive-to-evidence or replay-sensitive requests.

## Routes and boundaries

All dynamic/authenticated routes must be uncached (`Cache-Control: no-store`); explicitly opt out of Next.js caching for Campus fetches and private data. Cryptographic/storage modules must be server-only.

| Route | Access and behavior |
| --- | --- |
| `GET /healthz` | Public minimal process readiness; does not claim Campus connectivity |
| `GET /.well-known/jwks.json` | Public RSA signing JWK only; stable `kid` across restarts |
| `GET, POST /oidc/initiate` | Public bounded Campus initiation; validates configured issuer and registration |
| `POST /oidc/callback` | Public form-post endpoint correlated by single-use server state |
| `POST /api/session` | Password sign-in, rate limited, origin checked |
| `DELETE /api/session` | Authenticated sign-out with CSRF protection |
| `GET /api/bootstrap` | Authenticated non-secret config, registration, session CSRF token, JWKS observations |
| `PUT /api/registration` | Authenticated CSRF-protected registration ID update |
| `GET /api/history` | Authenticated bounded history list |
| `GET /api/history/[id]` | Authenticated redacted detail or 404 |
| `GET /api/evidence` | Authenticated privacy-safe JSON export |
| `POST /api/launch` | Authenticated CSRF-protected manual launch; returns redirect URL |
| `POST /api/oauth` | Authenticated CSRF-protected scenario execution; returns persisted evidence |

Console pages and APIs require operator authentication. Callback and initiation must remain reachable without operator cookies. A callback must never create an operator session. Unsupported methods return 405 with `Allow`; unknown resources return 404.

Inspector JSON errors use `{ "status": "Bad Request", "message": "Validation failed", "errors": [{ "field": "reference", "message": "A fresh launch reference is required" }] }`. Use 400 for malformed shape/types, 401 missing/invalid session, 403 authorization/CSRF rejection, 404 absent records, 422 missing registration/business prerequisites, 429 quotas, 500 unexpected failures with generic messages. Campus OAuth protocol errors retain their original meaning inside redacted run evidence; do not rewrite upstream protocol responses to look successful.

## App registration and keys

Generate a dedicated RSA key of at least 2048 bits once; persist it securely outside the image/source tree, mode 0600 where applicable. Never reuse the platform private key. Publish only `kty`, `kid`, `use`, `alg`, `n`, `e`; no private key parameters. Restart must preserve keys and registration.

Generate registration JSON from the actual Campus admin contract, including initiation URL `<PUBLIC_URL>/oidc/initiate`, launch/approved redirect `<PUBLIC_URL>/oidc/callback`, public JWKS URL, `campus.webhooks.write` scope, and any required installation/event fields. A placeholder event type may be `qa.inspection.completed`; no event is sent. Document the authorized `POST /admin/campus-apps` operation but do not collect or store Campus admin bearer tokens.

Campus must reach this inspector's registered public HTTPS JWKS URL. Campus SSRF protections reject localhost/private JWKS URLs. Explain the need for a public deployment or HTTPS tunnel; never disable Campus SSRF or TLS verification.

## OIDC flow contract

### Start

Manual input: `login_hint` is the original positive user ID, `reference` is an opaque prepared Campus launch reference, optional `nonce` override is bounded valid nonempty text. Normal launches use cryptographically random nonce and state. Hash state at rest; retain nonce only server-side until consumption/expiry. Persist a five-minute transaction snapshot containing original user, client and installation IDs, nonce, creation/expiry times. Never persist the raw launch reference or log the redirect query.

Redirect the browser to `<CAMPUS_BASE_URL>/apps/oidc/login` with:

- `state`, `nonce`, `login_hint`, `client_id`
- `redirect_uri=<PUBLIC_URL>/oidc/callback`
- `login_message_hint=<prepared reference>`
- `scope=openid`, `response_type=id_token`, `response_mode=form_post`, `prompt=none`
- `target_link_uri=<PUBLIC_URL>/oidc/callback`

Public initiation accepts GET query or POST form fields `iss`, `login_hint`, `login_message_hint`, optional `client_id` and `target_link_uri`. Reject duplicated critical parameters, wrong issuer, mismatched supplied client/target, missing registration, and malformed user/reference. Target is always the configured callback; never an arbitrary user-provided redirect.

### Callback

Require bounded `application/x-www-form-urlencoded` POST containing exactly one `state` and one `id_token`. Atomically consume a live transaction once, before verification; even invalid JWTs cannot reuse that state. Concurrent callbacks must yield exactly one successful state consumption. Correlation must work for cross-site form POST without a SameSite=Lax operator cookie.

Fetch platform public keys only from `<CAMPUS_BASE_URL>/.well-known/jwks.json`, with timeout, bounded body (64 KiB), no redirects, and bounded key count (16). Accept supported public RSA signing keys only; reject ambiguous duplicate `kid` and private material. Never follow JWT `jku`/`x5u`, derive issuer/network targets from the JWT, or permit algorithm substitution.

Validate:

- RS256 signature and recognized `kid`.
- Exact configured issuer and audience containing the transaction client ID.
- Required `iat` and `exp`, nonexpired token, valid optional `nbf`; allow at most 30 seconds future `iat`, document time policy.
- Exactly 300-second `exp - iat` identity-token lifetime.
- Nonce matches transaction; `sub` matches original user hint; `azp` matches client ID.
- Nonempty string `https://miva.campus/claims/tenant_id` and `https://miva.campus/claims/installation_id`.
- Roles array `https://miva.campus/claims/roles`, validating its element types against the actual contract.
- Installation matches configured transaction installation when present.

Do not run identity checks as if trusted when signature validation fails. Display those checks as not run. Persist only redacted evidence, then 303 redirect to a console URL selecting the run. Verification failure is a failed inspection, not an authenticated operator. Storage failure must not show a successful persisted run.

If Campus rejects a launch before callback, the browser remains at Campus's JSON error. Explain this limitation; do not invent a callback record or infer a status the inspector never observed.

### Fixture boundary

The inspector cannot mint Campus references. It has no Campus database/Redis credentials and adds no unauthenticated fixture endpoint. Document obtaining references through an authorized development harness calling Campus `CreateLaunchReference`, binding user, tenant, app, installation and approved callback. References expire after five minutes and are single use.

Real QA still needs separate fixtures for valid issuance, expired reference, consumed reference, revoked membership/disabled resources (403), missing resources (404), and nonce replay across **two fresh references**. Replaying callback state tests inspector correlation, not Campus nonce enforcement. A bogus reference rejection does not prove expiry or consumed-reference behavior.

## OAuth playground contract

Send server-side form-urlencoded POST to `<CAMPUS_BASE_URL>/apps/oauth2/token`:

- `grant_type=client_credentials`
- `client_assertion_type=urn:ietf:params:oauth:client-assertion-type:jwt-bearer`
- `client_assertion=<server-signed JWT>`
- `scope=campus.webhooks.write` by default
- optional registered `installation_id`

RS256 assertion claims: `iss=sub=client_id`, `aud=<CAMPUS_ISSUER trimmed of trailing slash>/apps/oauth2/token`, current `iat`, expiry five minutes later, fresh random `jti`; header includes registered key `kid`.

| Scenario | Expected |
| --- | --- |
| Valid | 200 and fully verified service bearer token |
| Missing scope | 400 `invalid_scope` |
| Missing assertion | 400 `invalid_request` |
| Expired assertion | 401 `invalid_client` |
| Wrong audience | 401 `invalid_client` |
| Foreign signing key | 401 `invalid_client` |
| JTI replay | First issuance fully verifies; exact assertion reused then 401 `invalid_client` |

The foreign-key scenario uses an ephemeral unrelated key, without replacing the registered key. Replay is **blocked** if first issuance is not a valid, fully verified bearer token: `200 {}` followed by 401 must never pass. Do not generate a new assertion/JTI for replay's second request.

For valid issuance verify envelope `token_type=Bearer`, `expires_in=3600`, expected scope, then signature, issuer, audience `<issuer trimmed>/apps/webhooks`, times, exactly 3600-second lifetime, `sub` and `client_id` equal registered client, matching scope and installation when configured. Treat custom scope input as a deliberately selected test value; derive expected successful scope from the supported requested/granted contract rather than leaving a misleading hardcoded assertion. Unsupported scopes should be reported truthfully.

Bound request/response sizes and timeouts. Never send raw assertions or access tokens to the browser or history. Preserve status/error and sanitized rate-limit metadata. JWKS fetch observations may aid debugging but do not independently prove Campus's five-minute key cache.

## Persistence, security, and privacy

- Use transactional state consumption, durable registration updates, stable keys, and bounded history: maximum 200 runs, 24-hour retention. Expired rows must be excluded on reads and pruned at startup/writes/periodic maintenance. Pending launches expire after five minutes. Avoid accumulating consumed transactions forever.
- Session tokens must be high-entropy, stored hashed, expire after eight hours, use HttpOnly cookies, Secure in HTTPS, SameSite=Lax, Path=/, no broad Domain. Rotate on sign-in and revoke on sign-out. Rate-limit sign-in and integration endpoints; document proxy trust and quotas.
- Password comparison must avoid secret-dependent timing. Apply origin validation and CSRF tokens to operator mutations. Cross-site integration callbacks are protected by state/signature, not blanket same-origin middleware. Do not accidentally block legitimate callbacks using generic CSRF rules.
- No raw tokens, assertions, passwords, references, state, nonce or JTI in logs, history, exports, telemetry or error strings. Redact reflected credential-shaped upstream text. Retain only an explicit allowlist of technical claims; names, emails and arbitrary profile claims are redacted. Treat persisted technical IDs/roles as sensitive.
- Export omits decoded claims/context. The authenticated UI may show safe technical claims and clear verified/unverified labels. Render untrusted text as text, never raw HTML.
- Configured Campus destination is trusted deployment configuration; operator requests cannot choose arbitrary network targets. Restrict server fetches to that base, reject redirects, verify TLS; public production destinations must not resolve to forbidden internal networks. Allow explicit loopback configuration only for local development. Guard against DNS rebinding where public URLs are validated.
- Set a Next.js-compatible CSP (nonce-based where required), frame protection, nosniff, no-referrer, and no-store for sensitive responses. Never weaken CSP with broad unsafe script allowances solely to make hydration work.
- Apply payload limits before unbounded form/JSON parsing. Generic server errors contain no SQL, stack traces or provider internals. Log safe run/request IDs for troubleshooting.

## Suggested repository structure

```text
src/app/                   # React pages/layouts and route handlers
src/components/            # Accessible inspector UI
src/server/config.ts       # Validated server-only configuration
src/server/auth/           # Sessions, password, origin/CSRF, quotas
src/server/campus/         # Bounded HTTP client and protocol definitions
src/server/crypto/         # Stable app keys, JWKS, assertion signing, JWT verification
src/server/launches/       # Transaction lifecycle and callback inspections
src/server/oauth/          # Scenario execution and service-token validation
src/server/evidence/       # Redaction, retention and exports
src/server/db/             # SQLite connection, migrations and repositories
src/lib/contracts.ts       # Safe request/response types shared with UI
migrations/
tests/unit/
tests/integration/
e2e/
docs/                      # Architecture, registration and QA runbook
Dockerfile
compose.yaml
.env.example
README.md
```

Keep business/protocol logic out of React components and thin route handlers. Use explicit types and shared schemas, avoid `any`, and keep server secrets out of shared modules. Example API contract:

```ts
export type CheckResult = {
  name: string;
  status: 'passed' | 'failed' | 'not_run';
  message: string;
};

export type InspectionResult = {
  id: string;
  kind: 'oidc' | 'oauth';
  status: 'passed' | 'failed' | 'blocked';
  createdAt: string;
  checks: CheckResult[];
};
```

## Required commands and deployment

Provide working npm scripts and document:

```sh
npm ci
npm run dev -- --port 8090
npm run typecheck
npm run lint
npm test
npm run test:e2e
npm run build
npm run start -- --port 8090
docker compose up -d --build
```

Use Next.js standalone output and a multi-stage Docker build. Runtime must be non-root, include required native SQLite dependencies, expose the configured port, and support a persistent `/data` volume. Compose should drop capabilities, set no-new-privileges and use a read-only root filesystem with explicit writable mounts for data and any required Next.js runtime cache/temp paths. Test these constraints with the actual image. Healthcheck targets `/healthz`.

TLS terminates at the ingress; document canonical URL/proxy setup and trusted headers. Single-replica restriction must be explicit. Do not claim Vercel/serverless compatibility with local SQLite or an ephemeral filesystem. Include CI for install, typecheck, lint, tests, production build and Docker smoke verification.

## Test and acceptance matrix

Use deterministic fixture Campus servers and generated test RSA keys. Tests assert externally observable behavior and protocol contracts.

- Configuration: issuer/request-base separation, trailing slash handling, gateway prefix preservation, production HTTPS and local opt-in.
- Keys: public JWKS contains no private fields; stable key/kid across restart; invalid/unwritable storage fails safely.
- Authentication: protected pages/APIs, secure cookie flags, expiry, sign-out revocation, wrong-password quota, CSRF/origin rejection, no callback-created sessions.
- OIDC happy path: actual browser navigation to fixture Campus, HTML form-post back, state correlation despite absent cross-site cookie, validation trace and history selection.
- OIDC negatives: malformed/duplicate/oversized input, unknown/expired/used state, ten concurrent consumes with exactly one winner, tampered signature/algorithm/kid, wrong issuer/audience/sub/azp/nonce, invalid times/lifetime/context/installation.
- JWKS failure: timeout, oversized/malformed keys, redirects, private fields, ambiguous kid, unsupported keys; unavailable prerequisites are blocked.
- OAuth: every scenario table row, exact form/assertion claims, full valid bearer verification, missing/malformed bearer envelope, wrong binding/lifetime, and replay's false-positive regression (`200 {}` then 401).
- Upstream 429, non-JSON, timeout and 5xx produce truthful evidence without automatic success/retry.
- Storage: restart durability, retention/record limit, expiry cleanup, transactional rollback and generic 500 on persistence failure.
- Privacy: inspect browser network payloads, DB/history, logs, evidence export and production bundles for seeded sentinel credentials; none may leak. Confirm unknown claims and reflected token text are redacted.
- HTTP: invalid JSON/type errors400 with field paths, missing prerequisites422, missing records404, wrong methods405, unexpected500 with generic messages.
- UI: mobile and desktop, keyboard navigation, labels/focus, loading/empty/error states, copy/export, no overflow; no console errors.
- Deployment: build and run the production Docker image with real restrictions, mount persistence, restart and verify key/registration/history stability; health200, public JWKS200, private history401.

Automated fixtures are not live staging evidence. README/QA report must distinguish fixture-verified behavior, actual live observations, and blocked checks.

## Implementation order and boundaries

1. Initialize the separate repository and lock stack/runtime versions; add this spec and a short architecture decision record.
2. Deliver a vertical slice: persistent configuration/key, public JWKS, protected console and app registration setup.
3. Deliver real OIDC start/callback/state consumption with tests, then inspection UI/history.
4. Deliver OAuth scenarios and verified service tokens, including replay regression.
5. Add evidence/privacy/retention, deployment files and browser QA; verify production Docker behavior.
6. Deliver source, local run instructions, deployment guide, test results, and remaining live-fixture dependencies.

Always: preserve genuine integration boundaries, validate inputs, test business rules, keep docs/examples current, and run relevant checks.

Ask before: provisioning paid hosting, creating live Campus registrations or mutating staging fixtures without existing authorization, publishing/deploying to an external account, or materially expanding scope.

Never: require Go; modify Campus backend to bypass authentication, TLS, SSRF or rate limits; mint fake success evidence; commit secrets; collect Campus admin passwords/tokens; implement webhook postback in this version.

No implementation is requested by this handoff-writing task. The rebuild agent should use this document as its source of truth and report any genuine contract conflict before changing the scope. Routine implementation choices within these boundaries do not require repeated confirmation.

## Definition of done

A separate Next.js repository independently runs frontend and server routes, passes typecheck/lint/unit/integration/browser tests and production build, and runs successfully in Docker with durable keys/storage. QA can register its public URLs, supply authorized Campus fixtures, inspect real OIDC launches, and execute all seven OAuth scenarios. Evidence is honest and redacted. Documentation clearly states environment selection, public HTTPS requirements, fixture dependencies, single-replica storage, and deferred webhooks. No Go installation, process, source dependency, or build step is required.

## Approved extension: inbound webhook playground

The webhook deferral and prohibition in the original version scope above are superseded by the approved webhook playground extension. Inspector now supports authenticated first-receipt calls, validation presets and bounded raw-body forwarding; see webhooks.md. Existing security, redaction, profile isolation and evidence requirements still apply. Domain processing, automatic retries and load generation remain outside this increment.
