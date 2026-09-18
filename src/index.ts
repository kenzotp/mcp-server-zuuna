#!/usr/bin/env node
/**
 * mcp-server-zuuna — MCP stdio server exposing Zuuna's v1 API as agent tools.
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
import { buildToolRegistrations } from "./tools.js";

export const SERVER_VERSION = "0.1.1";

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

  const server = new McpServer({ name: "mcp-server-zuuna", version: SERVER_VERSION });
  for (const tool of buildToolRegistrations(client)) {
    server.registerTool(tool.name, { description: tool.description, inputSchema: tool.inputSchema }, async (args) =>
      tool.run(args as Record<string, unknown>),
    );
  }

  await server.connect(new StdioServerTransport());
  console.error(
    `mcp-server-zuuna ${SERVER_VERSION} running on stdio (base URL: ${
      process.env.ZUUNA_BASE_URL?.trim() || "https://app.zuuna.de"
    }).`,
  );
}

main().catch((err) => {
  fail(err instanceof Error ? err.stack ?? err.message : String(err));
});
