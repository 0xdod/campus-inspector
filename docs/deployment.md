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
