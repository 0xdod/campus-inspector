# Architecture decision: one Node service

Use the user-selected `campus-inspector` directory as a new independent Git repository; package name is `campus-app-inspector`. The attached brief is preserved in implementation-brief.md. No backend source is imported, executed, or needed to build.

Next.js App Router owns React pages and Node route handlers. Domain modules own validation and protocol behavior. SQLite WAL transactions own state consumption, registration, hashed sessions, quotas and history. A dedicated persisted RSA key belongs to this app. One replica and one persistent volume are required.

Implement in verified increments: (1) config/storage/auth/setup, (2) launch correlation and verification, (3) OAuth scenarios, (4) inspection UI and evidence, (5) browser/deployment verification. Each increment adds tests against the business contract. Live Campus resources require authorized external fixtures and remain distinguishable from automated fixture results.

Campus source reviewed: internal/features/campus_apps/{dto,service}, docs/qa/campus-apps-{oidc-login,oauth-token}. Roles are strings (empty array permitted). Scope grants are the intersection with campus.webhooks.write. Registration creates an app and tenant installation using authenticated admin context; tenant_id is not a request field. launch_url and target_link_uri must equal the approved callback.

Sources: https://nextjs.org/docs/app/api-reference/file-conventions/route (Node handlers), https://nextjs.org/docs/app/guides/content-security-policy (per-request nonce and dynamic rendering), https://nextjs.org/docs/app/api-reference/config/next-config-js/output (standalone), https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md (synchronous transactions), https://github.com/panva/jose (RS256 verification).

## Saved profile update

The original one-app/environment limitation is superseded by the user's requirement for named app/platform profiles. SQLite now retains up to 200 profiles and one deployment-wide active selection. Environment variables supply the default plus immutable deployment/auth/key settings. Each operation captures the active profile; pending OIDC transactions store environment and app bindings so activation/editing cannot retarget callbacks. Legacy registration migrates once. See saved-profiles.md for API semantics and upgrade behavior.

## Integration traffic logging

A separate bounded http_logs table records redacted integration traffic, including prepared redirects that never return a callback. HTTP transport accepts a recorder so OAuth/JWKS observations remain correlated to the run/profile captured for that operation. Bodies are allowlisted/redacted before persistence. Callback/initiation wrappers record inbound form shape and the inspector response; redirects do not claim to observe Campus's browser response. Historical evidence export remains independent of detailed log bodies. Migration 003 is additive.
