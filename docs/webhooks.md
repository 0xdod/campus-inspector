# Webhook playground

## Setup and first receipt

1. Register Campus Inspector with its published app JWKS URL. The generated registration JSON already includes scope `campus.webhooks.write` and event type `qa.inspection.completed`. Update previously registered test apps through authorized Campus administration if needed; Inspector does not change Campus registration.
2. Select the correct saved profile. The Campus request base can include a gateway prefix; the exact issuer is independent. Configure installation ID if a client has multiple active installations.
3. Open **Webhooks playground**, choose **New event**, and click **Send webhook**. The Inspector server signs a fresh client assertion, obtains an access token, verifies signature/issuer/audience/lifetime/scope/client/installation, and sends an event with the verified installation. Tokens remain in request-local server memory.
4. Inspect the saved run. It must show HTTP 202 and a receipt echoing the submitted ID with status `received`. Token and webhook exchanges appear with correlated OAuth/JWKS/webhook request logs. Generated event IDs appear in redacted request metadata for manual lookup.

## Presets and raw JSON

Presets include new event with empty data and omitted actor/subject (202), null actor/subject (202), malformed/trailing JSON (400 on body), wrong data type (400 on data), unapproved type (422 on type), foreign installation (422 on installation_id), exact 262144-byte body (202), 262145-byte body (413 on body), and missing/invalid bearer (401 on Authorization). The unapproved-type preset generates an independent random type; ensure it is not allowlisted.

Preset mode generates the envelope on the server after verification; the browser never needs a service token. Every submission gets a new ID where applicable. Missing/invalid bearer scenarios still require a successful token prerequisite, then intentionally omit or replace that token for the webhook call.

Raw editing loads a preset envelope and displays its UTF-8 byte count. Text is forwarded unchanged: the control request is valid JSON, while its `body` string may contain malformed event JSON, repeated keys, null, wrong types or trailing text. Editing never changes the expected status: choose the matching scenario first. A raw valid event can specify another permitted event type. Actor and subject can be added as objects, omitted or null. If no installation ID is configured, replace the displayed installation placeholder or use preset mode to resolve it from the verified token. **Reset envelope with a fresh ID** replaces the editor; repeated sends otherwise retain your edited ID and may exercise Campus retry/conflict behavior.

Campus enforces 256 KiB on the forwarded envelope. Inspector separately caps forwarded raw text at 300000 UTF-8 bytes and the local control wrapper at 2 MiB (JSON escaping can enlarge it). Other JSON APIs retain their 16 KiB limits. The local wrapper and schema limits are Inspector errors, not Campus validation results. Size-boundary presets generate exact bodies automatically. Raw editing preserves whitespace and numeric spelling.

## Results and privacy

The local POST /api/webhooks returns a saved inspection, normally HTTP 200 even when an expected Campus rejection is observed. Look at the labeled Campus exchange for its actual status. Local authentication, CSRF, control validation and operator-quota failures use normal Inspector HTTP errors before inspection.

A run passes only when the actual Campus status and receipt/error-field contract match the selected scenario. Invalid prerequisites, transport failures, redirects, non-object responses, 429 and 5xx block the normal scenario. A wrong receipt ID or status fails. There are no automatic retries. After an interrupted send, the result says **Receipt unknown**: Campus may have persisted it. Check the generated event ID in metadata or your raw editor ID before manually resending.

The new route uses existing operator authentication, exact Origin and CSRF checks, with its own persistent deployment-global quota of 10 attempts/minute. This quota is separate from Campus installation/IP throttling. Campus Retry-After and numeric rate headers are retained.

Request logs retain byte counts and a redacted-envelope marker. Responses retain recognized statuses and allowlisted error fields with upstream free text omitted. Arbitrary event IDs, payloads, authorization values and provider echoes are excluded from saved responses. Only controlled server-generated IDs appear in run metadata. Exports continue to omit request context, profiles and full exchange bodies. Raw-mode text lives in the browser editor until navigation/reset; use synthetic QA data.

## Manual Campus verification

Use authorized read-only access to campus_app_events and linked campus_app_installations to confirm the submitted ID, verified tenant/app/installation relationship, status received, complete original JSON envelope, occurred_at, received_at and canonical SHA-256 payload_hash. JSONB does not preserve whitespace/key ordering. Confirm a safe campus_apps.webhook.received audit with outcome new, and confirm no domain changes or outbound delivery. No backend database credentials are added to Inspector.

Disabled-app checks with an already-issued token, revoked scopes, LTI/identity token separation and signed invalid-claim fixtures remain developer-assisted backend QA. Fresh issuance may fail before a disabled app reaches the webhook endpoint; do not treat that as proof of post-issuance authorization. Load testing and the full retry/conflict suite are outside this playground increment.

## Verification

Run npm test, npm run typecheck, npm run lint, npm run build and npm run test:e2e. Integration fixtures use real HTTP and RSA signatures. Browser tests cover setup, new receipt, validation rejection, oversized event forwarding, raw editing, redacted evidence and responsive navigation. Fixture success is distinct from the manual live Campus persistence/audit check.
