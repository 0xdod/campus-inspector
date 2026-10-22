# Campus App Inspector

A standalone Next.js console for Campus engineers and QA to inspect actual Campus Apps OIDC launches and OAuth client credentials. Save named app/platform profiles, edit their settings and switch the active profile from **Saved apps**. Next.js serves the UI and backend; no Go source, process, installation, or backend checkout is needed. Webhook submission is deferred.

## Run locally

Use Node **24.22.1 LTS** (`nvm use`). Node 22.18+ is also permitted by the package engine for tooling, but the image and CI use the pinned LTS. Native SQLite bindings must match your Node ABI; run `npm ci` after switching Node versions.

```sh
npm ci
cp .env.example .env
# Edit .env: choose Campus base/issuer and set a unique password (16+ characters).
npm run dev -- --port 8090
```

Open [the local console](http://localhost:8090). The operator password signs into this inspector; it does not authenticate to Campus. No sample successful runs are seeded.

```sh
npm run typecheck
npm run lint
npm test
npm exec playwright -- install chromium
npm run build
npm run test:e2e
npm run start -- --port 8090
npm run test:docker
docker compose up -d --build
```

Browser tests start their own production app on 8090 and deterministic Campus fixture on 8091. Stop any server using those ports first. Fixtures use generated keys and test-only identifiers, never staging credentials. Docker verification builds a local image, creates its own temporary named volume/container, verifies persistence, and removes those temporary resources. It does not deploy externally.

GitHub Actions publishes verified container images to `ghcr.io/0xdod/campus-inspector` for the default branch, `dev`, and `v*` tags. Use `docker compose -f compose.ghcr.yaml up -d` to pull a published image, or reference it in Dokploy with persistent storage at `/data`. See [GHCR tags, registry access and deployment](docs/deployment.md#build-and-publish-images-with-github-actions).

## Configure the default environment

| Server-only variable | Purpose |
| --- | --- |
| `PUBLIC_URL` | Canonical origin, HTTPS outside explicit loopback development. No path/query/credentials. |
| `CAMPUS_BASE_URL` | Trusted request destination, including any gateway prefix such as `/api/backend`. |
| `CAMPUS_ISSUER` | Exact platform JWT issuer (`lti.platform_url`), including trailing slash. |
| `INSPECTOR_PASSWORD` | Required unique operator secret, 16–1024 characters. |
| `DATA_DIR` | Durable storage directory; `./data` locally, `/data` in Docker. |
| `ALLOW_LOCAL_HTTP` | `true` explicitly permits loopback HTTP development. Omit for public deployments. |

The base and issuer are independent: a loopback backend can issue tokens identifying an HTTPS platform. Endpoint appending preserves gateway prefixes. Service audiences trim issuer trailing slashes before appending `/apps/oauth2/token` or `/apps/webhooks`; JWT issuer checks preserve exact equality. Configuration and writable storage are checked when the Node server starts. Health means process/storage readiness, not Campus connectivity.

Never put secrets in `NEXT_PUBLIC_*`. The UI shows only non-secret environment configuration. Do not bake `.env` or data into images. Local `npm start` reads `.env` before launching standalone output. Data and keys are not portable across concurrent replicas: **one replica only**. Serverless/ephemeral filesystems and Vercel are outside this deployment contract.

## Register and inspect

1. Serve the inspector at a public HTTPS origin reachable by Campus, or use an HTTPS development tunnel.
2. Sign in and open **App setup**. Copy the generated registration JSON to an authorized Campus administrator. They perform `POST /admin/campus-apps` in the appropriate authenticated tenant context. The inspector never asks for or stores that admin bearer token.
3. Save a named profile with its Campus request base, exact issuer, returned `client_id` and optional `installation_id`. Select **Use profile** to activate it for new inspections. Saving a local profile does not register or verify the app. See [saved apps and platforms](docs/saved-profiles.md). The registration JSON includes `campus.webhooks.write` and placeholder `qa.inspection.completed`; no event is sent.
4. With the matching saved profile active, call `GET /students/campus-apps/{appId}/launch` with a direct student session, or `GET /admin/campus-apps/{appId}/launch` with a direct administrator session and system-scoped `campus_apps.app.read`. Use the Campus request base and numeric app ID returned by registration, not the client or installation ID. Open the initiation URL returned in `data` in your browser within five minutes. It supplies the user ID and single-use reference automatically through `/oidc/initiate`; no manual reference preparation is needed for a normal launch. See [the QA runbook](docs/qa.md) for advanced fixtures.
5. Inspect individual checks and technical claims. Signature verification alone does not imply all binding checks passed. Untrusted decoded claims are labeled; identity checks are not run after signature failure.
6. Run the seven OAuth scenarios. A negative case passes only on the expected rejection. Replay requires a fully verified first bearer token, then reuses the identical assertion. Network, JWKS and fixture prerequisites block the inspection. Rate limits preserve status and numeric rate-limit metadata; requests are never retried.
7. Open **Request logs** to inspect redacted request/response bodies, HTTP status, timing and safe headers across OAuth, JWKS and OIDC traffic. Run details show correlated entries. See [request logs](docs/request-logs.md).
8. Export privacy-safe evidence for QA tickets. Exports omit claims, request context and response bodies. Authenticated history contains only allowlisted technical claims; treat its IDs and roles as sensitive.

Campus rejects private/localhost registered JWKS URLs through its own SSRF policy. Keep TLS and SSRF verification enabled. See [deployment](docs/deployment.md), [architecture](docs/architecture.md), [security and privacy](docs/security.md), and [verification results](docs/qa-results.md).

## Pinned stack and documentation

Versions were checked against npm and official documentation on 2026-10-22; exact direct versions and transitive resolutions are committed in package.json/package-lock.json.

| Dependency | Pinned version | Reason |
| --- | --- | --- |
| Node | 24.22.1 | Current security LTS, consistent glibc image and native SQLite ABI. |
| Next.js | 16.4.2 | App Router Node handlers, standalone output, nonce-aware dynamic rendering. |
| React / React DOM | 19.3.1 | Matching current stable versions supported by Next. |
| better-sqlite3 | 13.0.3 | Maintained native driver, synchronous atomic `DELETE … RETURNING` and WAL transactions. |
| jose | 6.2.13 | RS256, JWK import and compact signature verification with explicit claim checks. |
| Zod | 4.6.7 | Strict request shapes and field-oriented transport errors. |
| Vitest / Playwright | 5.0.5 / 1.64.1 | Protocol integration and real production-browser verification. |

Sources: [Node security LTS release](https://nodejs.org/en/blog/release/v24.22.1), [Next route handlers](https://nextjs.org/docs/app/api-reference/file-conventions/route), [standalone output](https://nextjs.org/docs/app/api-reference/config/next-config-js/output), [nonce CSP](https://nextjs.org/docs/app/guides/content-security-policy), [React versions](https://react.dev/versions), [SQLite transactions](https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md), [jose](https://github.com/panva/jose).

`npm audit` currently reports a development-only braces/glob dependency chain in eslint-config-next; no fixed braces version is published. Repository-owned lint patterns are trusted. Production audit is checked separately. Do not force-downgrade the framework to resolve the lint-tool finding.
