// ZNA-2155 — GET /api/v1/me. Kept as `zuuna_me`, same semantics as the hosted
// connector (kanban-app src/lib/mcp/tools/me.ts): the identity check a model
// should run first. ZNA-2168 — the response also reports `hiddenTools`: every
// tool this token's scopes hide, each with the scope(s) that would unlock it,
// computed from the same catalog resolveToolsForToken filters.

import type { ZuunaClient } from "../client.js";
import { jsonResult, wrap } from "../tool-helpers.js";
import type { ZuunaMe } from "../types.js";
import type { ToolRegistration } from "../tool-types.js";

export interface HiddenTool {
  /** The hidden tool's name, e.g. "zuuna_create_card". */
  name: string;
  /** The scopes this token is missing; granting all of them registers the tool. */
  scopes: string[];
}

/** The tools `scopes` hide, with the scope(s) that would unlock each. Zero-scope
 * tools (zuuna_me itself) are never hidden. Takes the catalog as a parameter so
 * it stays a pure function; the me tool below passes its full-registrations
 * closure in. */
export function hiddenToolsFor(
  scopes: readonly string[],
  tools: ReadonlyArray<Pick<ToolRegistration, "name" | "requiredScopes">>,
): HiddenTool[] {
  const granted = new Set(scopes);
  const hidden: HiddenTool[] = [];
  for (const tool of tools) {
    const missing = tool.requiredScopes.filter((s) => !granted.has(s));
    if (missing.length > 0) hidden.push({ name: tool.name, scopes: missing });
  }
  return hidden;
}

/** `getAllTools` runs at tool-call time, after the full registration list has
 * been built, so `zuuna_me` can read the whole catalog without a cycle. */
export function meTools(
  client: ZuunaClient,
  getAllTools: () => readonly ToolRegistration[],
): ToolRegistration[] {
  return [
    {
      name: "zuuna_me",
      description:
        "Show the identity of the Zuuna API token in use: organization, plan, granted scopes and — only when the workspace's subscription has lapsed — the grace-window deadline after which every call here will start failing. Also lists, as hiddenTools, every tool this token's scopes hide, each with the scope(s) that would unlock it. Call this first to learn what this token may do; a tool absent from the tool list this session means its scope was not granted.",
      inputSchema: {},
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
      requiredScopes: [],
      run: wrap(async () => {
        const me = await client.request<ZuunaMe>("GET", "/api/v1/me");
        return jsonResult({ ...me, hiddenTools: hiddenToolsFor(me.scopes, getAllTools()) });
      }),
    },
  ];
}
