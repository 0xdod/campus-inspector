# Request and response logs

Open **Request logs** to inspect integration traffic, or open a run in **Run history** for its correlated requests. Select an entry to see the method, redacted URL, timestamp, duration, profile, actual HTTP status, request body, response body and safe headers. Filter by OAuth, JWKS or OIDC. Reload logs to fetch newer records.

Logging covers server-side OAuth token requests and platform JWKS fetches, OIDC browser redirects prepared by the inspector, and incoming initiation/callback requests plus the inspector's actual response. It does not record password sign-ins, operator session/profile API bodies, cookies or authorization headers. It is not a proxy for arbitrary Campus traffic.

The inspector cannot see a response that Campus returns directly to the browser before callback. A prepared redirect therefore has **Unobserved** status and no fabricated response body, even if the browser later returns a valid callback. Failed server requests have **Unavailable** status when no complete response was received. Complete upstream HTTP errors retain their observed status; no request is retried for logging.

## Body policy

Bodies are redacted before they reach SQLite or the browser:

- OAuth form bodies retain grant type, assertion type, scope, client/installation IDs and field presence. Assertions and tokens are replaced with `[REDACTED]`. Missing fields remain absent.
- Callback bodies retain the presence of state/id_token with both values replaced by `[REDACTED]`. Rejected or unparsed bodies are omitted.
- Prepared redirect URLs redact state, nonce and launch references. Unknown query fields are omitted.
- Response envelopes retain supported technical fields such as error code, token type, expiry and scope. Access tokens and arbitrary upstream error descriptions are redacted; unknown upstream fields are omitted.
- JWKS logs retain public key fields and replace private material with `[REDACTED]` if an invalid upstream key contains it. This does not make an invalid key acceptable for verification.
- Arbitrary non-JSON response text is omitted because it can reflect credentials or contain internal/provider details. Its observed HTTP status and safe content type remain visible. A real empty JSON object remains `{}`.
- Only safe content types and numeric rate-limit metadata are recorded from upstream headers. Cookies, authorization and reflected header text are excluded.

Authenticated logs contain technical context and must be treated as sensitive. They use the same persistent SQLite volume, survive restarts, and are bounded to **500 entries / 24 hours**, with pruning at startup, writes and periodic maintenance. Reads exclude expired entries. Prepared redirect logs are retained even if no callback ever arrives; successful correlation later associates them with the inspection. Logs linked to an expired/pruned run may outlive that run within their own bound.

Evidence export remains a privacy-safe run summary and does not include these request/response bodies or profile context. Older runs are not backfilled with logs the inspector never observed.

## API and upgrade

`GET /api/logs` returns bounded summaries. `GET /api/logs?run_id=<id>` filters them to one inspection. `GET /api/logs/<id>` returns the full redacted entry. All require the operator session and return no-store responses. Invalid IDs return 400, absent/expired entries 404, and unsupported methods 405 with Allow.

Schema migration `003_http_logs.sql` adds a table/index without replacing existing profiles, history, sessions or keys. Restart once after updating to load the migration into the cached server runtime; rebuild and restart production normally.
