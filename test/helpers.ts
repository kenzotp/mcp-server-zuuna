import { ZuunaClient } from "../src/client.js";
import { allowedTools, buildToolRegistrations, resolveToolsForToken } from "../src/tools/index.js";
import type { ToolRegistration } from "../src/tool-types.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

export interface MockCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

export type MockHandler = (call: { url: string; method: string; body: unknown }) =>
  | { status: number; json: unknown }
  | { networkError: string };

/** A fetch impl that routes through `handler` and records every call. */
export function mockFetch(handler: MockHandler): { impl: typeof fetch; calls: MockCall[] } {
  const calls: MockCall[] = [];
  const impl = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input.toString();
    const method = (init?.method ?? "GET").toUpperCase();
    let body: unknown;
    if (typeof init?.body === "string") {
      try {
        body = JSON.parse(init.body);
      } catch {
        body = init.body;
      }
    }
    calls.push({ url, method, headers: (init?.headers ?? {}) as Record<string, string>, body });
    const out = handler({ url, method, body });
    if ("networkError" in out) throw new Error(out.networkError);
    return new Response(JSON.stringify(out.json), {
      status: out.status,
      headers: { "content-type": "application/json" },
    });
  };
  return { impl: impl as typeof fetch, calls };
}

const BASE = "https://zuuna.test";

export function makeClient(handler: MockHandler): { client: ZuunaClient; calls: MockCall[] } {
  const { impl, calls } = mockFetch(handler);
  return { client: new ZuunaClient({ baseUrl: BASE, token: "tok_test", fetchImpl: impl, timeoutMs: 500 }), calls };
}

export function makeTools(handler: MockHandler): {
  tools: Map<string, ToolRegistration>;
  all: ToolRegistration[];
  client: ZuunaClient;
  calls: MockCall[];
} {
  const { client, calls } = makeClient(handler);
  const all = buildToolRegistrations(client);
  return { tools: new Map(all.map((t) => [t.name, t])), all, client, calls };
}

export { allowedTools, resolveToolsForToken };

export async function callTool(
  tools: Map<string, ToolRegistration>,
  name: string,
  args: Record<string, unknown> = {},
): Promise<CallToolResult> {
  const tool = tools.get(name);
  if (!tool) throw new Error(`unknown tool ${name}`);
  return tool.run(args);
}

export function resultText(result: CallToolResult): string {
  return result.content.map((c) => ("text" in c ? c.text : "")).join("");
}

export async function resultJson(result: CallToolResult): Promise<unknown> {
  return JSON.parse(resultText(result));
}

// ---- shared fixtures (shapes mirror the v1 route payloads) ----

export const FIXTURE = {
  me: {
    tokenId: "tok_1",
    org: { id: "org1", product: "TEAM", plan: "team" },
    scopes: [
      "boards:read",
      "boards:write",
      "cards:read",
      "cards:write",
      "comments:read",
      "comments:write",
      "time:read",
      "time:write",
      "git:write",
      "releases:write",
      "deployments:write",
      "webhooks:manage",
    ],
    apiAccessEndsAt: null,
  },
  meReadOnly: {
    tokenId: "tok_ro",
    org: { id: "org1", product: "TEAM", plan: "team" },
    scopes: ["boards:read", "cards:read", "comments:read", "time:read"],
    apiAccessEndsAt: null,
  },
  boards: {
    data: [
      { id: "b1", title: "Big Marketing Relaunch", key: "ZNA", description: null, groupId: "g1", createdAt: "2026-09-01T09:00:00.000Z", updatedAt: "2026-09-18T09:00:00.000Z" },
      { id: "b2", title: "Dev", key: "DEV", description: null, groupId: "g1", createdAt: "2026-09-01T09:00:00.000Z", updatedAt: "2026-09-18T09:00:00.000Z" },
    ],
  },
  columnsB1: {
    boardId: "b1",
    title: "Big Marketing Relaunch",
    key: "ZNA",
    groupId: "g1",
    columns: [
      { id: "c1", title: "Todo", isDone: false, statusCategory: "OPEN", position: 0, wipLimit: null, wipLimitMode: "HARD", slaHours: null },
      { id: "c2", title: "Review", isDone: false, statusCategory: "ACTIVE", position: 1, wipLimit: null, wipLimitMode: "HARD", slaHours: null },
      { id: "c3", title: "Done", isDone: true, statusCategory: "DONE", position: 2, wipLimit: null, wipLimitMode: "HARD", slaHours: null },
    ],
  },
  cardsB1: {
    data: [
      {
        id: "card1",
        key: "ZNA-2001",
        title: "[C·B5] MCP server: mcp-server-zuuna",
        status: "Todo",
        columnId: "c1",
        priority: "HIGH",
        type: "FEATURE",
        dueDate: null,
        estimateSeconds: null,
        isArchived: false,
        assignees: [],
        customFields: [],
        updatedAt: "2026-09-18T09:00:00.000Z",
      },
    ],
  },
  cardDetail: {
    id: "card1",
    key: "ZNA-2001",
    title: "[C·B5] MCP server: mcp-server-zuuna",
    description: "<p>The enabler of the agent-native positioning.</p>",
    status: "Todo",
    columnId: "c1",
    boardId: "b1",
    groupId: "g1",
    priority: "HIGH",
    type: "FEATURE",
    dueDate: null,
    estimateSeconds: null,
    storyPoints: null,
    ready: null,
    isArchived: false,
    updatedAt: "2026-09-18T09:00:00.000Z",
    checklist: { total: 3, completed: 1 },
    assignees: [{ id: "u1", name: "Mika" }],
    epic: null,
    customFields: [],
    attachments: [],
  },
  createdCard: { id: "card_new", key: "ZNA-2020", title: "New card", status: "Todo", columnId: "c1" },
  patchedCard: { id: "card1", key: "ZNA-2001", title: "[C·B5] MCP server: mcp-server-zuuna", status: "Review", columnId: "c2" },
  comment: { id: "com1", createdAt: "2026-09-18T10:00:00.000Z" },
  unauthorized: { status: 401, json: { error: "unauthorized", message: "A valid API token is required (Authorization: Bearer ...)." } },
  notFoundBoard: { status: 404, json: { error: "not_found", message: "Board not found." } },
  notFoundCard: { status: 404, json: { error: "not_found", message: "Card not found." } },
};

/**
 * Router over the fixture set: answers every known v1 route with its fixture
 * and everything else with a generic 200 `{ ok: true }` (most tool calls in
 * the full 67-tool suite only need to prove they hit the right method+path+
 * body, not a specific response shape) or the API's 404 envelope when
 * nothing at all matches. `overrides` lets a test replace any route's answer.
 */
export function fixtureHandler(overrides: Record<string, { status: number; json: unknown }> = {}): MockHandler {
  return ({ url, method }) => {
    const path = new URL(url).pathname;
    const key = `${method} ${path}`;
    const override = overrides[key];
    if (override) return override;

    if (method === "GET" && path === "/api/v1/me") return { status: 200, json: FIXTURE.me };
    if (method === "GET" && path === "/api/v1/boards") return { status: 200, json: FIXTURE.boards };
    if (method === "GET" && /^\/api\/v1\/boards\/[^/]+\/columns$/.test(path)) {
      const id = path.split("/")[4];
      if (id !== "b1") return FIXTURE.notFoundBoard;
      return { status: 200, json: FIXTURE.columnsB1 };
    }
    if (method === "GET" && /^\/api\/v1\/boards\/[^/]+\/cards$/.test(path)) {
      const id = path.split("/")[4];
      if (id !== "b1") return FIXTURE.notFoundBoard;
      return { status: 200, json: FIXTURE.cardsB1 };
    }
    if (method === "POST" && /^\/api\/v1\/boards\/b1\/cards$/.test(path)) {
      return { status: 201, json: FIXTURE.createdCard };
    }
    if (method === "GET" && /^\/api\/v1\/cards\/[^/]+$/.test(path)) {
      const id = decodeURIComponent(path.split("/")[4]);
      if (id !== "card1" && id !== "ZNA-2001") return FIXTURE.notFoundCard;
      return { status: 200, json: FIXTURE.cardDetail };
    }
    if (method === "PATCH" && /^\/api\/v1\/cards\/[^/]+$/.test(path)) {
      return { status: 200, json: FIXTURE.patchedCard };
    }
    if (method === "POST" && /^\/api\/v1\/cards\/ZNA-2001\/comments$/.test(path)) {
      return { status: 201, json: FIXTURE.comment };
    }
    // Every other v1 route this package's 67 tools call — a generic ok
    // envelope. Tests that need the exact response shape use `overrides`.
    if (path.startsWith("/api/v1/")) return { status: 200, json: { ok: true } };
    return { status: 404, json: { error: "not_found", message: `No route: ${key}` } };
  };
}
