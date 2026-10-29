export const webhookPresets = [
  { id: "valid", label: "New event", status: 202 },
  { id: "null_actor_subject", label: "Null actor and subject", status: 202 },
  { id: "malformed_json", label: "Malformed JSON", status: 400, field: "body" },
  { id: "trailing_json", label: "Trailing JSON", status: 400, field: "body" },
  {
    id: "wrong_data_type",
    label: "Wrong data type",
    status: 400,
    field: "data",
  },
  {
    id: "unapproved_type",
    label: "Unapproved event type",
    status: 422,
    field: "type",
  },
  {
    id: "installation_mismatch",
    label: "Installation mismatch",
    status: 422,
    field: "installation_id",
  },
  { id: "exact_limit", label: "Exactly 256 KiB", status: 202 },
  {
    id: "over_limit",
    label: "Over 256 KiB by one byte",
    status: 413,
    field: "body",
  },
  {
    id: "missing_bearer",
    label: "Missing bearer token",
    status: 401,
    field: "Authorization",
  },
  {
    id: "invalid_bearer",
    label: "Invalid bearer token",
    status: 401,
    field: "Authorization",
  },
] as const;
export type WebhookScenario = (typeof webhookPresets)[number]["id"];
export function buildWebhookBody(
  scenario: WebhookScenario,
  installation: string,
) {
  const event = {
    id: "qa-" + crypto.randomUUID(),
    type: "qa.inspection.completed",
    occurred_at: new Date().toISOString(),
    installation_id: installation,
    data: {} as unknown,
    ...(scenario === "null_actor_subject"
      ? { actor: null, subject: null }
      : {}),
  };
  if (scenario === "malformed_json") return '{"id":';
  if (scenario === "wrong_data_type") event.data = [];
  if (scenario === "unapproved_type")
    event.type = "qa.unapproved." + crypto.randomUUID().replaceAll("-", "");
  if (scenario === "installation_mismatch")
    event.installation_id = crypto.randomUUID();
  if (scenario === "exact_limit" || scenario === "over_limit") {
    event.data = { padding: "" };
    const base = JSON.stringify(event);
    const target = scenario === "exact_limit" ? 262144 : 262145;
    event.data = {
      padding: "x".repeat(target - new TextEncoder().encode(base).length),
    };
    return JSON.stringify(event);
  }
  const body = JSON.stringify(event, null, 2);
  return scenario === "trailing_json" ? body + " {}" : body;
}
