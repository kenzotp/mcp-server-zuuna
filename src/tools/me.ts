import type { ZuunaClient } from "../client.js";
import { jsonResult, wrap } from "../tool-helpers.js";
import type { ToolRegistration } from "../tool-types.js";

export function meTools(client: ZuunaClient): ToolRegistration[] {
  return [
    {
      name: "zuuna_me",
      description:
        "Show the identity of the Zuuna API token in use: organization, plan, granted scopes and — only when the workspace's subscription has lapsed — the grace-window deadline after which every call here will start failing. Call this first to learn what this token may do; a tool absent from the tool list this session means its scope was not granted.",
      inputSchema: {},
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
      requiredScopes: [],
      run: wrap(async () => jsonResult(await client.request("GET", "/api/v1/me"))),
    },
  ];
}
