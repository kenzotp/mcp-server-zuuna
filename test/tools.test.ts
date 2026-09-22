import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ZuunaClient } from "../src/client.js";
import { buildToolRegistrations } from "../src/tools/index.js";
import type { MockHandler } from "./helpers.js";
import {
  allowedTools,
  callTool,
  FIXTURE,
  fixtureHandler,
  makeTools,
  resolveToolsForToken,
  resultJson,
  resultText,
} from "./helpers.js";

/** Runs a tool and asserts it surfaces an MCP tool error matching `pattern`. */
async function expectToolError(
  name: string,
  args: Record<string, unknown>,
  handler: MockHandler,
  pattern: RegExp,
) {
  const { tools } = makeTools(handler);
  const result = await callTool(tools, name, args);
  expect(result.isError).toBe(true);
  expect(resultText(result)).toMatch(pattern);
}

const always401: MockHandler = () => FIXTURE.unauthorized;
const always404: MockHandler = () => FIXTURE.notFoundCard;
const alwaysNetwork: MockHandler = () => ({ networkError: "ECONNREFUSED" });

const DESTRUCTIVE_TOOLS = [
  "zuuna_delete_card",
  "zuuna_delete_checklist_item",
  "zuuna_delete_relation",
  "zuuna_delete_attachment",
  "zuuna_delete_time_entry",
  "zuuna_delete_recurring_card",
  "zuuna_delete_release",
  "zuuna_delete_webhook",
];

describe("the full tool set", () => {
  it("has exactly 67 tools, matching the hosted MCP connector", () => {
    const { all } = makeTools(fixtureHandler());
    expect(all).toHaveLength(67);
  });

  it("every tool name is unique", () => {
    const { all } = makeTools(fixtureHandler());
    expect(new Set(all.map((t) => t.name)).size).toBe(all.length);
  });
});

describe("confirm gate on destructive tools", () => {
  it("exactly the 8 documented tools carry destructiveHint: true", () => {
    const { all } = makeTools(fixtureHandler());
    const destructive = all.filter((t) => t.annotations.destructiveHint).map((t) => t.name);
    expect(destructive.sort()).toEqual([...DESTRUCTIVE_TOOLS].sort());
  });

  it("every destructive tool's confirm field only accepts the literal true", () => {
    const { all } = makeTools(fixtureHandler());
    for (const tool of all) {
      if (!tool.annotations.destructiveHint) continue;
      const confirmSchema = tool.inputSchema.confirm as z.ZodTypeAny | undefined;
      expect(confirmSchema, `${tool.name} should declare a confirm field`).toBeTruthy();
      expect(confirmSchema!.safeParse(true).success).toBe(true);
      expect(confirmSchema!.safeParse(false).success).toBe(false);
      expect(confirmSchema!.safeParse(undefined).success).toBe(false);
      expect(confirmSchema!.safeParse("true").success).toBe(false);
    }
  });

  it("no non-destructive tool declares a confirm field", () => {
    const { all } = makeTools(fixtureHandler());
    for (const tool of all) {
      if (tool.annotations.destructiveHint) continue;
      expect(tool.inputSchema.confirm).toBeUndefined();
    }
  });
});

describe("scope-gated registration", () => {
  it("a read-only token's scopes register only tools its scopes cover, never a write tool", () => {
    const { all } = makeTools(fixtureHandler());
    const scoped = allowedTools(all, FIXTURE.meReadOnly.scopes);
    expect(scoped.length).toBeGreaterThan(0);
    expect(scoped.length).toBeLessThan(all.length);
    for (const tool of scoped) {
      expect(tool.requiredScopes.every((s) => FIXTURE.meReadOnly.scopes.includes(s))).toBe(true);
    }
    expect(scoped.some((t) => t.name === "zuuna_create_card")).toBe(false);
    expect(scoped.some((t) => t.name === "zuuna_create_webhook")).toBe(false);
    expect(scoped.some((t) => t.name === "zuuna_record_git_events")).toBe(false);
    // Read tools this token's scopes DO cover are still there.
    expect(scoped.some((t) => t.name === "zuuna_card")).toBe(true);
    expect(scoped.some((t) => t.name === "zuuna_list_comments")).toBe(true);
    // zuuna_me needs no scope at all.
    expect(scoped.some((t) => t.name === "zuuna_me")).toBe(true);
  });

  it("a token with every scope registers every tool", () => {
    const { all } = makeTools(fixtureHandler());
    expect(allowedTools(all, FIXTURE.me.scopes)).toHaveLength(all.length);
  });

  it("an empty scope list registers only the scopeless tools (zuuna_me)", () => {
    const { all } = makeTools(fixtureHandler());
    const scoped = allowedTools(all, []);
    expect(scoped.map((t) => t.name)).toEqual(["zuuna_me"]);
  });
});

describe("resolveToolsForToken (startup /me gating)", () => {
  it("scopes the tool list from a successful GET /me", async () => {
    const { client, all } = makeTools(fixtureHandler());
    const result = await resolveToolsForToken(client, all);
    expect(result.scoped).toBe(true);
    expect(result.tools).toHaveLength(all.length); // FIXTURE.me carries every scope
  });

  it("falls back to the full set and writes one stderr line when GET /me 401s", async () => {
    const { client, all } = makeTools(always401);
    const seen: string[] = [];
    const original = console.error;
    console.error = (msg?: unknown) => seen.push(String(msg));
    let result;
    try {
      result = await resolveToolsForToken(client, all);
    } finally {
      console.error = original;
    }
    expect(result.scoped).toBe(false);
    expect(result.tools).toHaveLength(all.length);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatch(/could not read GET \/api\/v1\/me.*registering the full tool set/s);
  });

  it("falls back to the full set on a network failure", async () => {
    const { client, all } = makeTools(alwaysNetwork);
    const original = console.error;
    console.error = () => {};
    let result;
    try {
      result = await resolveToolsForToken(client, all);
    } finally {
      console.error = original;
    }
    expect(result.scoped).toBe(false);
    expect(result.tools).toHaveLength(all.length);
  });
});

// ---- me ----

describe("zuuna_me", () => {
  it("returns the token identity from GET /api/v1/me", async () => {
    const { tools, calls } = makeTools(fixtureHandler());
    const result = await callTool(tools, "zuuna_me");
    expect(result.isError).toBeUndefined();
    expect(calls[0]).toMatchObject({ method: "GET", url: "https://zuuna.test/api/v1/me" });
    expect(await resultJson(result)).toMatchObject({ tokenId: "tok_1", org: { plan: "team" } });
  });
  it("surfaces 401 as a tool error with the API message", () =>
    expectToolError("zuuna_me", {}, always401, /401.*unauthorized.*A valid API token is required/s));
  it("surfaces network errors as a tool error", () =>
    expectToolError("zuuna_me", {}, alwaysNetwork, /unreachable.*ECONNREFUSED/s));
});

// ---- groups ----

describe("zuuna_list_groups (groups area)", () => {
  it("GETs /api/v1/groups", async () => {
    const { tools, calls } = makeTools(fixtureHandler());
    const result = await callTool(tools, "zuuna_list_groups");
    expect(result.isError).toBeUndefined();
    expect(calls[0]).toMatchObject({ method: "GET", url: "https://zuuna.test/api/v1/groups" });
  });
  it("zuuna_list_group_cards GETs /api/v1/groups/{groupId}/cards with placement", async () => {
    const { tools, calls } = makeTools(fixtureHandler());
    await callTool(tools, "zuuna_list_group_cards", { groupId: "g1", placement: "backlog" });
    expect(calls[0].url).toBe("https://zuuna.test/api/v1/groups/g1/cards?placement=backlog");
  });
});

// ---- boards ----

describe("zuuna_boards / zuuna_board (boards area)", () => {
  it("zuuna_boards GETs /api/v1/boards", async () => {
    const { tools, calls } = makeTools(fixtureHandler());
    const result = await callTool(tools, "zuuna_boards");
    expect(result.isError).toBeUndefined();
    expect(calls[0]).toMatchObject({ method: "GET", url: "https://zuuna.test/api/v1/boards" });
    const json = (await resultJson(result)) as { data: { key: string }[] };
    expect(json.data.map((b) => b.key)).toEqual(["ZNA", "DEV"]);
  });

  it("zuuna_board assembles columns + cards for a board id, capping at one page", async () => {
    const { tools, calls } = makeTools(fixtureHandler());
    const result = await callTool(tools, "zuuna_board", { board: "b1" });
    expect(result.isError).toBeUndefined();
    expect(calls.map((c) => c.url)).toEqual([
      "https://zuuna.test/api/v1/boards/b1/columns",
      "https://zuuna.test/api/v1/boards/b1/cards?limit=200",
    ]);
    const json = (await resultJson(result)) as { board: { key: string }; columns: unknown[]; cards: { key: string }[] };
    expect(json.board).toMatchObject({ id: "b1", key: "ZNA" });
    expect(json.columns).toHaveLength(3);
    expect(json.cards[0]).toMatchObject({ key: "ZNA-2001" });
  });

  it("zuuna_board flags truncation with nextCursor when the card page is not the whole board", async () => {
    const paged = { ...FIXTURE.cardsB1, nextCursor: "card1" };
    const { tools } = makeTools(fixtureHandler({ "GET /api/v1/boards/b1/cards": { status: 200, json: paged } }));
    const result = await callTool(tools, "zuuna_board", { board: "b1" });
    const json = (await resultJson(result)) as { cardsTruncated?: boolean; nextCursor?: string };
    expect(json.cardsTruncated).toBe(true);
    expect(json.nextCursor).toBe("card1");
  });

  it("zuuna_board resolves a board KEY via the boards list after the direct probe 404s", async () => {
    const { tools, calls } = makeTools(fixtureHandler());
    const result = await callTool(tools, "zuuna_board", { board: "zna" });
    expect(result.isError).toBeUndefined();
    expect(calls.map((c) => c.url.replace("https://zuuna.test", ""))).toEqual([
      "/api/v1/boards/zna/columns",
      "/api/v1/boards",
      "/api/v1/boards/b1/columns",
      "/api/v1/boards/b1/cards?limit=200",
    ]);
  });

  it("zuuna_create_board POSTs to /api/v1/boards with groupId + title", async () => {
    const { tools, calls } = makeTools(fixtureHandler());
    await callTool(tools, "zuuna_create_board", { groupId: "g1", title: "New board" });
    expect(calls[0]).toMatchObject({
      method: "POST",
      url: "https://zuuna.test/api/v1/boards",
      body: { groupId: "g1", title: "New board" },
    });
  });

  it("zuuna_create_column POSTs to /api/v1/boards/{boardId}/columns", async () => {
    const { tools, calls } = makeTools(fixtureHandler());
    await callTool(tools, "zuuna_create_column", { boardId: "b1", title: "Blocked" });
    expect(calls[0]).toMatchObject({ method: "POST", url: "https://zuuna.test/api/v1/boards/b1/columns" });
  });

  it("zuuna_list_automations GETs /api/v1/boards/{boardId}/automations", async () => {
    const { tools, calls } = makeTools(fixtureHandler());
    await callTool(tools, "zuuna_list_automations", { boardId: "b1" });
    expect(calls[0]).toMatchObject({ method: "GET", url: "https://zuuna.test/api/v1/boards/b1/automations" });
  });
});

// ---- cards ----

describe("cards area", () => {
  it("zuuna_card GETs /api/v1/cards/{key}", async () => {
    const { tools, calls } = makeTools(fixtureHandler());
    const result = await callTool(tools, "zuuna_card", { card: "ZNA-2001" });
    expect(result.isError).toBeUndefined();
    expect(calls[0]).toMatchObject({ method: "GET", url: "https://zuuna.test/api/v1/cards/ZNA-2001" });
  });

  it("zuuna_list_board_cards GETs with archived/updatedSince/paging query params", async () => {
    const { tools, calls } = makeTools(fixtureHandler());
    await callTool(tools, "zuuna_list_board_cards", { boardId: "b1", archived: "all", limit: 50 });
    expect(calls[0].url).toBe("https://zuuna.test/api/v1/boards/b1/cards?archived=all&limit=50");
  });

  it("zuuna_create_card POSTs the superset of fields (priority/type/dates/assignees)", async () => {
    const { tools, calls } = makeTools(fixtureHandler());
    await callTool(tools, "zuuna_create_card", {
      boardId: "b1",
      title: "New card",
      priority: "HIGH",
      type: "BUG",
      dueDate: "2026-10-01",
      assigneeIds: ["u1"],
    });
    expect(calls[0]).toMatchObject({
      method: "POST",
      url: "https://zuuna.test/api/v1/boards/b1/cards",
      body: { title: "New card", priority: "HIGH", type: "BUG", dueDate: "2026-10-01", assigneeIds: ["u1"] },
    });
  });

  it("zuuna_create_card resolves boardRef (via the shared resolveBoard: direct probe, then list fallback) + columnTitle before POSTing", async () => {
    const { tools, calls } = makeTools(fixtureHandler());
    await callTool(tools, "zuuna_create_card", { boardRef: "ZNA", title: "New card", columnTitle: "review" });
    expect(calls.map((c) => `${c.method} ${c.url.replace("https://zuuna.test", "")}`)).toEqual([
      "GET /api/v1/boards/ZNA/columns",
      "GET /api/v1/boards",
      "GET /api/v1/boards/b1/columns",
      "POST /api/v1/boards/b1/cards",
    ]);
    expect(calls[3].body).toEqual({ title: "New card", columnId: "c2" });
  });

  it("zuuna_update_card PATCHes only the sent fields, including the new ones (storyPoints, ready, customFields)", async () => {
    const { tools, calls } = makeTools(fixtureHandler());
    await callTool(tools, "zuuna_update_card", { card: "ZNA-2001", storyPoints: 5, ready: true });
    expect(calls[0]).toMatchObject({
      method: "PATCH",
      url: "https://zuuna.test/api/v1/cards/ZNA-2001",
      body: { storyPoints: 5, ready: true },
    });
  });

  it("zuuna_update_card fails locally when no field is given", async () => {
    await expectToolError(
      "zuuna_update_card",
      { card: "ZNA-2001" },
      fixtureHandler(),
      /Provide at least one field to change/,
    );
  });

  it("zuuna_move_card PATCHes columnId, resolving columnTitle via the card's own board", async () => {
    const { tools, calls } = makeTools(fixtureHandler());
    await callTool(tools, "zuuna_move_card", { card: "ZNA-2001", columnTitle: "Review" });
    expect(calls.map((c) => `${c.method} ${c.url.replace("https://zuuna.test", "")}`)).toEqual([
      "GET /api/v1/cards/ZNA-2001",
      "GET /api/v1/boards/b1/columns",
      "PATCH /api/v1/cards/ZNA-2001",
    ]);
    expect(calls[2].body).toEqual({ columnId: "c2" });
  });

  it("zuuna_move_card_to_board POSTs to /api/v1/cards/{id}/move", async () => {
    const { tools, calls } = makeTools(fixtureHandler());
    await callTool(tools, "zuuna_move_card_to_board", { card: "ZNA-2001", targetBoardId: "b2" });
    expect(calls[0]).toMatchObject({
      method: "POST",
      url: "https://zuuna.test/api/v1/cards/ZNA-2001/move",
      body: { targetBoardId: "b2" },
    });
  });

  it("zuuna_archive_card POSTs .../archive", async () => {
    const { tools, calls } = makeTools(fixtureHandler());
    await callTool(tools, "zuuna_archive_card", { card: "ZNA-2001" });
    expect(calls[0]).toMatchObject({ method: "POST", url: "https://zuuna.test/api/v1/cards/ZNA-2001/archive" });
  });

  it("zuuna_unarchive_card DELETEs .../archive", async () => {
    const { tools, calls } = makeTools(fixtureHandler());
    await callTool(tools, "zuuna_unarchive_card", { card: "ZNA-2001" });
    expect(calls[0]).toMatchObject({ method: "DELETE", url: "https://zuuna.test/api/v1/cards/ZNA-2001/archive" });
  });

  it("zuuna_delete_card DELETEs with ?withTime=1 and requires confirm at the schema level", async () => {
    const { tools, calls } = makeTools(fixtureHandler());
    await callTool(tools, "zuuna_delete_card", { card: "ZNA-2001", confirm: true });
    expect(calls[0]).toMatchObject({ method: "DELETE", url: "https://zuuna.test/api/v1/cards/ZNA-2001?withTime=1" });
  });

  it("zuuna_restore_card POSTs .../restore", async () => {
    const { tools, calls } = makeTools(fixtureHandler());
    await callTool(tools, "zuuna_restore_card", { card: "ZNA-2001" });
    expect(calls[0]).toMatchObject({ method: "POST", url: "https://zuuna.test/api/v1/cards/ZNA-2001/restore" });
  });

  it("surfaces 404 with the API's own message", () =>
    expectToolError("zuuna_card", { card: "ZNA-9999" }, fixtureHandler(), /404.*not_found.*Card not found/));
});

// ---- comments ----

describe("comments area", () => {
  it("zuuna_list_comments GETs .../comments", async () => {
    const { tools, calls } = makeTools(fixtureHandler());
    await callTool(tools, "zuuna_list_comments", { card: "ZNA-2001" });
    expect(calls[0]).toMatchObject({ method: "GET", url: "https://zuuna.test/api/v1/cards/ZNA-2001/comments" });
  });
  it("zuuna_comment POSTs the body to .../comments", async () => {
    const { tools, calls } = makeTools(fixtureHandler());
    const result = await callTool(tools, "zuuna_comment", { card: "ZNA-2001", body: "Looks good." });
    expect(result.isError).toBeUndefined();
    expect(calls[0]).toMatchObject({
      method: "POST",
      url: "https://zuuna.test/api/v1/cards/ZNA-2001/comments",
      body: { body: "Looks good." },
    });
  });
});

// ---- checklist ----

describe("checklist area", () => {
  it("zuuna_add_checklist_item POSTs content to .../checklist", async () => {
    const { tools, calls } = makeTools(fixtureHandler());
    await callTool(tools, "zuuna_add_checklist_item", { card: "ZNA-2001", content: "Write tests" });
    expect(calls[0]).toMatchObject({
      method: "POST",
      url: "https://zuuna.test/api/v1/cards/ZNA-2001/checklist",
      body: { content: "Write tests" },
    });
  });
  it("zuuna_delete_checklist_item DELETEs .../checklist/{itemId}", async () => {
    const { tools, calls } = makeTools(fixtureHandler());
    await callTool(tools, "zuuna_delete_checklist_item", { card: "ZNA-2001", itemId: "it1", confirm: true });
    expect(calls[0]).toMatchObject({ method: "DELETE", url: "https://zuuna.test/api/v1/cards/ZNA-2001/checklist/it1" });
  });
});

// ---- relations ----

describe("relations area", () => {
  it("zuuna_add_relation POSTs type/targetCardId to .../relations", async () => {
    const { tools, calls } = makeTools(fixtureHandler());
    await callTool(tools, "zuuna_add_relation", { card: "ZNA-2001", type: "blocks", targetCard: "ZNA-2002" });
    expect(calls[0]).toMatchObject({
      method: "POST",
      url: "https://zuuna.test/api/v1/cards/ZNA-2001/relations",
      body: { type: "blocks", targetCardId: "ZNA-2002" },
    });
  });
});

// ---- attachments ----

describe("attachments area", () => {
  it("zuuna_list_attachments GETs .../attachments", async () => {
    const { tools, calls } = makeTools(fixtureHandler());
    await callTool(tools, "zuuna_list_attachments", { card: "ZNA-2001" });
    expect(calls[0]).toMatchObject({ method: "GET", url: "https://zuuna.test/api/v1/cards/ZNA-2001/attachments" });
  });

  it("zuuna_get_attachment returns metadata only, never the file's bytes", async () => {
    const calls: { url: string; method: string }[] = [];
    const fetchImpl = (async (input: string | URL, init?: RequestInit) => {
      calls.push({ url: input.toString(), method: (init?.method ?? "GET").toUpperCase() });
      return new Response(new Uint8Array([1, 2, 3, 4]).buffer, {
        status: 200,
        headers: { "content-type": "image/png", "content-disposition": 'attachment; filename="cat.png"' },
      });
    }) as unknown as typeof fetch;
    const client = new ZuunaClient({ baseUrl: "https://zuuna.test", token: "t", fetchImpl });
    const tools = new Map(buildToolRegistrations(client).map((t) => [t.name, t]));
    const result = await callTool(tools, "zuuna_get_attachment", { card: "ZNA-2001", attachmentId: "att1" });
    expect(result.isError).toBeUndefined();
    expect(calls[0]).toMatchObject({
      method: "GET",
      url: "https://zuuna.test/api/v1/cards/ZNA-2001/attachments/att1",
    });
    const json = (await resultJson(result)) as { originalName: string; mimeType: string; size: number };
    expect(json).toMatchObject({ originalName: "cat.png", mimeType: "image/png", size: 4 });
    expect(resultText(result)).not.toMatch(/\u0001\u0002\u0003\u0004/);
  });
});

// ---- time ----

describe("time area", () => {
  it("zuuna_log_time POSTs seconds/duration/note to .../time", async () => {
    const { tools, calls } = makeTools(fixtureHandler());
    await callTool(tools, "zuuna_log_time", { card: "ZNA-2001", seconds: 3600, note: "Fixed the bug" });
    expect(calls[0]).toMatchObject({
      method: "POST",
      url: "https://zuuna.test/api/v1/cards/ZNA-2001/time",
      body: { seconds: 3600, note: "Fixed the bug" },
    });
  });
  it("zuuna_start_timer / zuuna_stop_timer POST the action to the same endpoint", async () => {
    const { tools, calls } = makeTools(fixtureHandler());
    await callTool(tools, "zuuna_start_timer", { card: "ZNA-2001" });
    await callTool(tools, "zuuna_stop_timer", { card: "ZNA-2001" });
    expect(calls[0].body).toEqual({ action: "start" });
    expect(calls[1].body).toEqual({ action: "stop" });
  });
  it("zuuna_import_time_entries POSTs the whole batch to /api/v1/time/entries", async () => {
    const { tools, calls } = makeTools(fixtureHandler());
    await callTool(tools, "zuuna_import_time_entries", { entries: [{ cardKey: "ZNA-2001", seconds: 60 }] });
    expect(calls[0]).toMatchObject({ method: "POST", url: "https://zuuna.test/api/v1/time/entries" });
  });
  it("zuuna_delete_time_entry DELETEs /api/v1/time/{entryId}", async () => {
    const { tools, calls } = makeTools(fixtureHandler());
    await callTool(tools, "zuuna_delete_time_entry", { entryId: "te1", confirm: true });
    expect(calls[0]).toMatchObject({ method: "DELETE", url: "https://zuuna.test/api/v1/time/te1" });
  });
});

// ---- sprints ----

describe("sprints area", () => {
  it("zuuna_create_sprint POSTs to /api/v1/sprints", async () => {
    const { tools, calls } = makeTools(fixtureHandler());
    await callTool(tools, "zuuna_create_sprint", { groupId: "g1", name: "Sprint 12" });
    expect(calls[0]).toMatchObject({
      method: "POST",
      url: "https://zuuna.test/api/v1/sprints",
      body: { groupId: "g1", name: "Sprint 12" },
    });
  });
  it("zuuna_add_cards_to_sprint POSTs cardIds to .../sprints/{id}/cards", async () => {
    const { tools, calls } = makeTools(fixtureHandler());
    await callTool(tools, "zuuna_add_cards_to_sprint", { sprintId: "s1", cardIds: ["card1"] });
    expect(calls[0]).toMatchObject({
      method: "POST",
      url: "https://zuuna.test/api/v1/sprints/s1/cards",
      body: { cardIds: ["card1"] },
    });
  });
});

// ---- recurring ----

describe("recurring area", () => {
  it("zuuna_create_recurring_card POSTs to /api/v1/boards/{boardId}/recurring", async () => {
    const { tools, calls } = makeTools(fixtureHandler());
    await callTool(tools, "zuuna_create_recurring_card", { boardId: "b1", title: "Weekly review", everyN: 1, unit: "weeks" });
    expect(calls[0]).toMatchObject({ method: "POST", url: "https://zuuna.test/api/v1/boards/b1/recurring" });
  });
  it("zuuna_delete_recurring_card DELETEs /api/v1/recurring/{id}", async () => {
    const { tools, calls } = makeTools(fixtureHandler());
    await callTool(tools, "zuuna_delete_recurring_card", { id: "rc1", confirm: true });
    expect(calls[0]).toMatchObject({ method: "DELETE", url: "https://zuuna.test/api/v1/recurring/rc1" });
  });
});

// ---- releases ----

describe("releases area", () => {
  it("zuuna_create_release POSTs to /api/v1/releases", async () => {
    const { tools, calls } = makeTools(fixtureHandler());
    await callTool(tools, "zuuna_create_release", { groupId: "g1", name: "v1.2.0", publish: true });
    expect(calls[0]).toMatchObject({
      method: "POST",
      url: "https://zuuna.test/api/v1/releases",
      body: { groupId: "g1", name: "v1.2.0", publish: true },
    });
  });
  it("zuuna_delete_release DELETEs /api/v1/releases/{id}", async () => {
    const { tools, calls } = makeTools(fixtureHandler());
    await callTool(tools, "zuuna_delete_release", { releaseId: "r1", confirm: true });
    expect(calls[0]).toMatchObject({ method: "DELETE", url: "https://zuuna.test/api/v1/releases/r1" });
  });
});

// ---- deployments ----

describe("deployments area", () => {
  it("zuuna_report_deployment POSTs to /api/v1/deployments", async () => {
    const { tools, calls } = makeTools(fixtureHandler());
    await callTool(tools, "zuuna_report_deployment", { environment: "production", state: "succeeded" });
    expect(calls[0]).toMatchObject({
      method: "POST",
      url: "https://zuuna.test/api/v1/deployments",
      body: { environment: "production", state: "succeeded" },
    });
  });
});

// ---- webhooks ----

describe("webhooks area", () => {
  it("zuuna_create_webhook POSTs url/events to /api/v1/webhooks", async () => {
    const { tools, calls } = makeTools(fixtureHandler());
    await callTool(tools, "zuuna_create_webhook", { url: "https://example.com/hook", events: ["card.created"] });
    expect(calls[0]).toMatchObject({
      method: "POST",
      url: "https://zuuna.test/api/v1/webhooks",
      body: { url: "https://example.com/hook", events: ["card.created"] },
    });
  });
  it("zuuna_delete_webhook DELETEs /api/v1/webhooks/{id}", async () => {
    const { tools, calls } = makeTools(fixtureHandler());
    await callTool(tools, "zuuna_delete_webhook", { webhookId: "wh1", confirm: true });
    expect(calls[0]).toMatchObject({ method: "DELETE", url: "https://zuuna.test/api/v1/webhooks/wh1" });
  });
  it("zuuna_test_webhook POSTs to .../test", async () => {
    const { tools, calls } = makeTools(fixtureHandler());
    await callTool(tools, "zuuna_test_webhook", { webhookId: "wh1" });
    expect(calls[0]).toMatchObject({ method: "POST", url: "https://zuuna.test/api/v1/webhooks/wh1/test" });
  });
});

// ---- git ----

describe("git area", () => {
  it("zuuna_record_git_events POSTs repo/events to /api/v1/git/events", async () => {
    const { tools, calls } = makeTools(fixtureHandler());
    await callTool(tools, "zuuna_record_git_events", {
      repo: { remoteUrl: "git@github.com:kenzotp/mcp-server-zuuna.git" },
      events: [{ kind: "commit", ref: "abc123", message: "ZNA-2155: parity" }],
    });
    expect(calls[0]).toMatchObject({ method: "POST", url: "https://zuuna.test/api/v1/git/events" });
  });
  it("zuuna_report_ci_checks POSTs repo/checks to /api/v1/git/checks", async () => {
    const { tools, calls } = makeTools(fixtureHandler());
    await callTool(tools, "zuuna_report_ci_checks", {
      repo: { remoteUrl: "git@github.com:kenzotp/mcp-server-zuuna.git" },
      checks: [{ name: "build", status: "passing" }],
    });
    expect(calls[0]).toMatchObject({ method: "POST", url: "https://zuuna.test/api/v1/git/checks" });
  });
  it("zuuna_link_git_branches POSTs repo/groupId/branches to /api/v1/git/branches", async () => {
    const { tools, calls } = makeTools(fixtureHandler());
    await callTool(tools, "zuuna_link_git_branches", {
      repo: { remoteUrl: "git@github.com:kenzotp/mcp-server-zuuna.git" },
      groupId: "g1",
      branches: [{ name: "feature/ZNA-2155", headSha: "abc123" }],
    });
    expect(calls[0]).toMatchObject({ method: "POST", url: "https://zuuna.test/api/v1/git/branches" });
  });
});

// ---- error mapping (v1 error -> tool error), across a couple of areas ----

describe("v1 error -> tool error mapping", () => {
  it("a 404 from a nested area (webhooks) carries the API's status/code/message", () =>
    expectToolError(
      "zuuna_delete_webhook",
      { webhookId: "missing", confirm: true },
      fixtureHandler({ "DELETE /api/v1/webhooks/missing": { status: 404, json: { error: "not_found", message: "Webhook endpoint not found." } } }),
      /404.*not_found.*Webhook endpoint not found/,
    ));
  it("a 409 (e.g. wip_limit_reached) surfaces with the API's own code", () =>
    expectToolError(
      "zuuna_move_card",
      { card: "ZNA-2001", columnId: "c2" },
      fixtureHandler({ "PATCH /api/v1/cards/ZNA-2001": { status: 409, json: { error: "wip_limit_reached", message: "Column Review is at its WIP limit." } } }),
      /409.*wip_limit_reached.*WIP limit/,
    ));
  it("surfaces network errors as a tool error, uniformly across areas", () =>
    expectToolError("zuuna_list_releases", { groupId: "g1" }, alwaysNetwork, /unreachable.*ECONNREFUSED/s));
  it("surfaces a 404 uniformly on a simple list tool too", () =>
    expectToolError("zuuna_boards", {}, always404, /404.*not_found/s));
});
