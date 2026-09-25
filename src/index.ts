#!/usr/bin/env node
/**
 * mcp-server-zuuna — MCP stdio server exposing Zuuna's v1 API as agent tools.
 * Tool parity with the hosted MCP connector at https://app.zuuna.de/mcp
 * (ZNA-2155): same 73 tools, same 5 prompts, same instructions, adapted only
 * where a sentence assumed an OAuth connection rather than a bearer token.
 *
 * Config via environment:
 *   ZUUNA_API_TOKEN  (required)  Bearer API token from your Zuuna workspace
 *   ZUUNA_BASE_URL   (optional)  default https://app.zuuna.de; must be an absolute
 *                                http(s) URL (invalid values fail at startup) and a
 *                                plain-http value prints a cleartext-token warning
 *   ZUUNA_TIMEOUT_MS (optional)  per-request timeout, default 15000
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { DEFAULT_TIMEOUT_MS, ZuunaClient } from "./client.js";
import { ALL_PROMPTS } from "./prompts.js";
import { buildToolRegistrations, resolveToolsForToken } from "./tools/index.js";

export const SERVER_VERSION = "0.2.1";

const INSTRUCTIONS = `Zuuna is a Kanban workspace. A few things worth knowing before calling anything:

- A card's display key (e.g. "ZNA-2001") and its internal id both work everywhere a card is
  addressed — never resolve one to the other yourself.
- A board's columns have a fixed order (zuuna_list_columns' \`position\`) and a shared
  \`statusCategory\` (OPEN|ACTIVE|DONE) that means the same thing on every board, even though
  column titles are board-local and can be anything.
- Automation rules are READ-ONLY through this server (zuuna_list_automations) — no tool here
  can create, edit or disable one. A rule you see there may move a card or post a comment on
  its own; a change you did not expect after your own call may be one of them firing.
- Linking a commit, branch, PR or CI check to a card (zuuna_record_git_events,
  zuuna_report_ci_checks, zuuna_link_git_branches) never moves it — those tools only attach
  history. A card actually moves because a board rule matched, or because zuuna_move_card /
  zuuna_update_card was called.
- Most list tools page: an unpaged call returns the whole collection; pass \`limit\` to opt into
  paging and follow the returned \`nextCursor\` as \`cursor\` for the next page.
- Keeping a local copy in sync: the card lists (zuuna_list_board_cards,
  zuuna_list_group_cards) accept an \`updatedSince\` (ISO 8601) filter for
  incremental sync. Poll with \`updatedSince: <the timestamp you stored from
  the previous poll>\`, follow \`nextCursor\` as \`cursor\` until a page comes
  back without one, then store the newest timestamp you saw. Every other
  list endpoint: re-read it in full with the same limit/cursor paging.
- A column's work-in-progress limit, when set to HARD, refuses a move into it with a
  \`wip_limit_reached\` error rather than letting the card land there.
- A tool absent from this session's tool list means the token's scopes do not cover it — that
  is not fixable by retrying or rephrasing the call.
- Every write here is attributed to the user who created the API token, in the same activity
  feed and audit trail a click in the app would produce.`;

function fail(message: string): never {
  // stderr only — stdout belongs to the MCP stdio transport.
  console.error(`mcp-server-zuuna: ${message}`);
  process.exit(1);
}

async function main(): Promise<void> {
  const token = process.env.ZUUNA_API_TOKEN?.trim();
  if (!token) {
    fail("ZUUNA_API_TOKEN is not set. Create an API token in your Zuuna workspace and export it.");
  }

  let timeoutMs = DEFAULT_TIMEOUT_MS;
  if (process.env.ZUUNA_TIMEOUT_MS) {
    const parsed = Number(process.env.ZUUNA_TIMEOUT_MS);
    if (Number.isFinite(parsed) && parsed > 0) timeoutMs = parsed;
    else console.error("mcp-server-zuuna: ignoring invalid ZUUNA_TIMEOUT_MS, using default.");
  }

  const client = new ZuunaClient({
    baseUrl: process.env.ZUUNA_BASE_URL,
    token,
    timeoutMs,
  });

  // ZNA-2155: register only the tools this token's scopes allow, mirroring
  // the hosted connector's scope-gated registration (kanban-app
  // src/lib/mcp/register.ts `allowedTools`) — see resolveToolsForToken for
  // the GET /me call and its network/401 fallback.
  const allTools = buildToolRegistrations(client);
  const { tools } = await resolveToolsForToken(client, allTools);

  const server = new McpServer(
    { name: "mcp-server-zuuna", version: SERVER_VERSION },
    { capabilities: { tools: {}, prompts: {} }, instructions: INSTRUCTIONS },
  );

  for (const tool of tools) {
    server.registerTool(
      tool.name,
      { title: tool.name, description: tool.description, inputSchema: tool.inputSchema, annotations: tool.annotations },
      async (args) => tool.run(args as Record<string, unknown>),
    );
  }

  for (const prompt of ALL_PROMPTS) {
    server.registerPrompt(
      prompt.name,
      { title: prompt.name, description: prompt.description, argsSchema: prompt.argsSchema },
      async (args) => ({
        messages: [
          {
            role: "user" as const,
            content: { type: "text" as const, text: prompt.render(args as Record<string, string>) },
          },
        ],
      }),
    );
  }

  await server.connect(new StdioServerTransport());
  console.error(
    `mcp-server-zuuna ${SERVER_VERSION} running on stdio (base URL: ${
      process.env.ZUUNA_BASE_URL?.trim() || "https://app.zuuna.de"
    }, ${tools.length}/${allTools.length} tools registered).`,
  );
}

main().catch((err) => {
  fail(err instanceof Error ? err.stack ?? err.message : String(err));
});
