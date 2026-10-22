# Docker deployment

## VPS quick start with automatic HTTPS

The repository includes a production [Dockerfile](../Dockerfile), [base Compose file](../compose.yaml), and an optional [VPS overlay](../compose.vps.yaml) using [Caddy](https://caddyserver.com/docs/running#docker-compose) for HTTPS. Run these commands from the repository root on your VPS with Docker Engine and the Docker Compose plugin installed.

1. Point a domain such as `inspector.example.com` to the VPS public IP. Any published IPv6 record must also reach this VPS. Allow inbound TCP ports 80 and 443; these must be available for Caddy.
2. Create the deployment environment on the VPS:

   ```sh
   cp deploy/vps.env.example .env
   chmod 600 .env
   ```

   Edit `.env`: set `PUBLIC_URL` to your HTTPS origin without a path, the actual `CAMPUS_BASE_URL` and exact `CAMPUS_ISSUER`, and a strong `INSPECTOR_PASSWORD` of at least 16 characters. Generate a password in your password manager. Existing saved profiles override the Campus defaults. Keep `ALLOW_LOCAL_HTTP=false`.

3. Build and start one app instance and Caddy:

   ```sh
   docker compose -f compose.yaml -f compose.vps.yaml up -d --build
   docker compose -f compose.yaml -f compose.vps.yaml ps
   ```

   Caddy starts after the app is healthy and obtains certificates for `PUBLIC_URL`. The app's port 8090 is published only on the VPS loopback interface; public traffic enters through Caddy. SQLite, saved profiles, sessions, logs, and the app signing key persist in `inspector-data`. Certificates persist in `caddy-data`.

4. Check readiness and open the HTTPS URL:

   ```sh
   curl --fail https://inspector.example.com/healthz
   ```

5. Register your public JWKS, OIDC initiation, and callback URLs with Campus. If moving an existing registration, update all registered URLs together. A new empty volume generates a new app signing key. To retain your current key and saved apps, migrate the complete existing data directory consistently while the source app is stopped; preserve ownership for UID/GID 1000 and protect the transfer.

For updates, fetch your new code and repeat the same `up -d --build` command. To stop the deployment, use `docker compose -f compose.yaml -f compose.vps.yaml down`; omit `--volumes` to retain app data and certificates. Keep a consistent repository directory/Compose project name so updates reuse the existing named volumes.

If your VPS already runs Nginx, Caddy, or another proxy on ports 80/443, use only `docker compose up -d --build` and forward your HTTPS hostname to `127.0.0.1:8090` from that proxy. Preserve the original `Origin` header and allow unauthenticated access to the public integration endpoints. Keep the app's existing operator sign-in.

## Build and publish images with GitHub Actions

The [CI workflow](../.github/workflows/ci.yaml) runs on pushes to `dev`. Its first job installs dependencies, audits production dependencies, runs lint, and runs unit/integration tests. Its second job builds, tags and pushes the production Docker image once to `ghcr.io/0xdod/campus-inspector`. The Next.js build inside Docker performs TypeScript checking; CI does not repeat a standalone Next.js build or typecheck. BuildKit layers are cached between runs, and documentation, deployment examples, CI files and local TypeScript caches are excluded from the Docker context so they do not invalidate app build layers.

The workflow builds native `linux/amd64` for the Dokploy VPS. It does not install QEMU or build ARM64 images. It authenticates with GitHub's built-in `GITHUB_TOKEN` and grants `packages: write` only to the publishing job, after the fast checks pass. The publishing job logs in to GHCR and pushes directly with Buildx; no container smoke test runs in CI. No registry password or app deployment secrets are required in Actions. Image names follow the repository name automatically and are lowercased; if you fork or rename the repository, update the deployment image reference accordingly.

| Tag | Published from |
| --- | --- |
| `dev` | The `dev` branch |
| `latest` | Only when `dev` is also the repository's default branch |
| `sha-<full-commit-sha>` | Each published commit |

The Actions run summary also provides the exact image digest for reproducible deployments and rollbacks. Tag pushes, other branches and pull requests do not trigger this workflow. If you change its triggers later, review image-tag rules at the same time.

Browser regression tests are available in the separate [Browser regression checks workflow](../.github/workflows/browser.yaml), triggered manually from Actions once that workflow is available on the repository's default branch. Select the branch you want to test. It builds standalone output, installs Chromium and runs the browser suite, retaining traces/screenshots on failure. Run it for UI or browser-authentication changes; it is not a publication gate on every push.

Locally, `npm run test:docker` still builds and tests an image. To smoke-test one you already built, set `INSPECTOR_TEST_IMAGE=campus-inspector:ci` before that command. This performs the same non-root/read-only, authentication and restart-persistence checks without another Docker build. The smoke test creates and cleans up its own container and volume.

### Pull the image with Compose

Use [compose.ghcr.yaml](../compose.ghcr.yaml) **instead of** `compose.yaml`; it contains no build instruction. Prepare `.env` as above, optionally set `IMAGE_TAG=dev`, `IMAGE_TAG=latest` (if published), or a published commit tag, then run:

```sh
docker compose -f compose.ghcr.yaml up -d
```

To use the optional Caddy HTTPS proxy:

```sh
docker compose -f compose.ghcr.yaml -f compose.vps.yaml up -d
```

The Compose file pulls the selected image on each `up`. Keep the same Compose project name and persistent volume when changing between local builds and registry images. Avoid `down --volumes` if you want to preserve saved apps and signing keys. For a rollback, select a previously published version/commit tag or use the digest from the Actions summary as the service's full image reference, then redeploy with the same data volume.

### Use the image in Dokploy

In a Docker image application, set the image to `ghcr.io/0xdod/campus-inspector:dev` (or a published version/digest), configure the app environment, use container port `8090`, and mount persistent storage at `/data`. Run one replica. Alternatively, deploy `compose.ghcr.yaml` as a Compose application and configure Dokploy routing to the `inspector` service on port `8090`. Dokploy or your tunnel handles ingress; omit the Caddy overlay in this case.

To deploy automatically after publishing, add a repository **Actions variable** named `DEPLOY_WEBHOOK` under **Settings → Secrets and variables → Actions → Variables**. Its value is the Dokploy deployment webhook URL reachable from GitHub-hosted runners. Configure Dokploy to pull the mutable `:dev` tag on deployment; a fixed digest/commit tag will not advance automatically. The CI `deploy` job runs only after successful image publication and sends one POST to this URL. It masks the URL, discards the response body, times out after 60 seconds, and fails for a missing URL, network error or non-2xx response. It does not retry, run healthchecks, or wait for Dokploy to finish deploying; a successful webhook response means the deployment was requested.

New GHCR packages are private by default. After the first successful publication, either make the package public in its GitHub package settings for anonymous pulls, or configure a `ghcr.io` registry credential in Dokploy using your GitHub username and a personal access token (classic) with `read:packages` and permission to read this package. Keep this pull credential in Dokploy's registry settings, outside Compose and Git. Organization SSO authorization may also be required. See [GitHub's registry authentication and visibility documentation](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry).

## Container behavior and maintenance

Use one replica of the multi-stage image with a persistent named volume mounted at `/data`. The image runs as UID/GID 1000, with a read-only root filesystem, all capabilities dropped and no-new-privileges. Compose supplies writable, size-bounded `/tmp` and `.next/cache` tmpfs mounts. A new Docker named volume inherits the image's `/data` ownership; pre-provisioned/bind-mounted data must be writable by UID 1000. The app sets directory mode 0700, key/database mode 0600. Back up the whole data directory consistently (including SQLite WAL); protect backups like credentials. Replacing this volume changes the app signing key and loses registration/history.

1. Build with `docker compose build` or `docker compose up -d --build`.
2. Set `.env` with canonical public HTTPS origin, trusted Campus request base and exact issuer, a strong operator password; omit `ALLOW_LOCAL_HTTP` outside local QA. Compose overrides DATA_DIR to `/data`.
3. Terminate TLS at ingress, forward to loopback 8090 and restrict ingress to the expected hostname. The server trusts **no forwarded headers** for authentication, origin checks, request targets, rate-limit identities or canonical redirects. Configure the external URL explicitly; preserve Origin for operator mutations. Public callback/initiation must bypass ingress operator authentication. Do not apply blanket CSRF middleware to these integration endpoints.
4. Expose `/healthz` for minimal process readiness, not Campus health. The image healthcheck uses its configured PORT. Compose publishes only loopback; change ingress wiring deliberately for remote reverse proxies. In Docker, `localhost` Campus destinations refer to the container itself; use an actual public Campus backend URL for integrations.
5. Run `npm run test:docker` to verify the image under the actual restrictions and persistence across restart. No paid hosting, live registration, external publishing or production fixture mutation is performed by this command.

Use a real HTTPS tunnel for local Campus-to-inspector JWKS calls; configure PUBLIC_URL to the tunnel origin and register its endpoints. Never disable Campus SSRF/TLS or use internal JWKS destinations. PUBLIC_URL is origin-only; deploy this application at the origin root. The Campus backend request base may contain a gateway prefix.

Changing password requires restarting the process. Existing sessions survive restarts and remain valid until their eight-hour expiry or sign-out; remove/revoke sessions administratively when rotating a potentially compromised password. Stop before offline maintenance. SQLite's schema version is in schema_migrations; startup applies the bundled initial migration idempotently. Future migrations must preserve durable records transactionally.

Configure ingress access logs to omit query strings and request bodies for integration and operator endpoints. Launch initiation URLs can contain a reference; callbacks contain credentials. Next incoming-request logging is disabled in this app. Apply request-size and connection deadlines at ingress as well as the server's bounded parsers.

Named app/platform profiles and the active selection also persist in `/data`. Restart once when upgrading to saved-profile support so the cached database instance loads migration 002. The `.env` Campus values are defaults; the selected saved profile takes precedence for requests and issuer validation. Deployment secrets, public origin and HTTP policy continue to come only from environment configuration.
