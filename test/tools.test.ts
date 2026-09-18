import { describe, expect, it } from "vitest";
import type { MockHandler } from "./helpers.js";
import { FIXTURE, callTool, fixtureHandler, makeTools, resultJson, resultText } from "./helpers.js";

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

// Handlers that fail every call with one class of failure.
const always401: MockHandler = () => FIXTURE.unauthorized;
const always404: MockHandler = () => FIXTURE.notFoundCard;
const alwaysNetwork: MockHandler = () => ({ networkError: "ECONNREFUSED" });

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
  it("surfaces 404 as a tool error", () => expectToolError("zuuna_me", {}, always404, /404.*not_found/s));
  it("surfaces network errors as a tool error", () =>
    expectToolError("zuuna_me", {}, alwaysNetwork, /unreachable.*ECONNREFUSED/s));
});

describe("zuuna_boards", () => {
  it("returns the board list from GET /api/v1/boards", async () => {
    const { tools, calls } = makeTools(fixtureHandler());
    const result = await callTool(tools, "zuuna_boards");
    expect(result.isError).toBeUndefined();
    expect(calls[0]).toMatchObject({ method: "GET", url: "https://zuuna.test/api/v1/boards" });
    const json = (await resultJson(result)) as { data: { key: string }[] };
    expect(json.data.map((b) => b.key)).toEqual(["ZNA", "DEV"]);
  });
  it("surfaces 401", () => expectToolError("zuuna_boards", {}, always401, /401.*unauthorized/s));
  it("surfaces 404", () => expectToolError("zuuna_boards", {}, always404, /404.*not_found/s));
  it("surfaces network errors", () => expectToolError("zuuna_boards", {}, alwaysNetwork, /unreachable/s));
});

describe("zuuna_board", () => {
  it("assembles columns + cards for a board id", async () => {
    const { tools, calls } = makeTools(fixtureHandler());
    const result = await callTool(tools, "zuuna_board", { board: "b1" });
    expect(result.isError).toBeUndefined();
    expect(calls.map((c) => c.url)).toEqual([
      "https://zuuna.test/api/v1/boards/b1/columns",
      "https://zuuna.test/api/v1/boards/b1/cards",
    ]);
    const json = (await resultJson(result)) as {
      board: { key: string };
      columns: unknown[];
      cards: { key: string; column: string; priority: string }[];
    };
    expect(json.board).toMatchObject({ id: "b1", key: "ZNA" });
    expect(json.columns).toHaveLength(3);
    expect(json.cards[0]).toMatchObject({ key: "ZNA-2001", column: "Todo", priority: "HIGH" });
  });

  it("resolves a board KEY (case-insensitive) via the boards list after the direct probe 404s", async () => {
    const { tools, calls } = makeTools(fixtureHandler());
    const result = await callTool(tools, "zuuna_board", { board: "zna" });
    expect(result.isError).toBeUndefined();
    expect(calls.map((c) => c.url.replace("https://zuuna.test", ""))).toEqual([
      "/api/v1/boards/zna/columns", // direct probe misses
      "/api/v1/boards", // fallback list
      "/api/v1/boards/b1/columns",
      "/api/v1/boards/b1/cards",
    ]);
    const json = (await resultJson(result)) as { board: { id: string } };
    expect(json.board.id).toBe("b1");
  });

  it("404s with a helpful message for an unknown board", async () => {
    await expectToolError("zuuna_board", { board: "NOPE" }, fixtureHandler(), /No board matches "NOPE"/);
  });
  it("surfaces 401", () => expectToolError("zuuna_board", { board: "b1" }, always401, /401.*unauthorized/s));
  it("surfaces network errors", () =>
    expectToolError("zuuna_board", { board: "b1" }, alwaysNetwork, /unreachable/s));
});

describe("zuuna_card", () => {
  it("returns card detail by display key from GET /api/v1/cards/{key}", async () => {
    const { tools, calls } = makeTools(fixtureHandler());
    const result = await callTool(tools, "zuuna_card", { card: "ZNA-2001" });
    expect(result.isError).toBeUndefined();
    expect(calls[0]).toMatchObject({ method: "GET", url: "https://zuuna.test/api/v1/cards/ZNA-2001" });
    const json = (await resultJson(result)) as { key: string; boardId: string };
    expect(json).toMatchObject({ key: "ZNA-2001", boardId: "b1" });
  });
  it("surfaces 404 with the API message", () =>
    expectToolError(
      "zuuna_card",
      { card: "ZNA-9999" },
      fixtureHandler(),
      /404.*not_found.*Card not found/,
    ));
  it("surfaces 401", () => expectToolError("zuuna_card", { card: "ZNA-2001" }, always401, /401/s));
  it("surfaces network errors", () =>
    expectToolError("zuuna_card", { card: "ZNA-2001" }, alwaysNetwork, /unreachable/s));
});

describe("zuuna_create_card", () => {
  it("POSTs to /boards/{id}/cards with boardId directly", async () => {
    const { tools, calls } = makeTools(fixtureHandler());
    const result = await callTool(tools, "zuuna_create_card", {
      boardId: "b1",
      title: "New card",
      description: "Body",
    });
    expect(result.isError).toBeUndefined();
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      method: "POST",
      url: "https://zuuna.test/api/v1/boards/b1/cards",
      body: { title: "New card", description: "Body" },
    });
    expect(await resultJson(result)).toMatchObject({ key: "ZNA-2020" });
  });

  it("resolves boardKey and columnTitle before POSTing", async () => {
    const { tools, calls } = makeTools(fixtureHandler());
    const result = await callTool(tools, "zuuna_create_card", {
      boardKey: "ZNA",
      title: "New card",
      columnTitle: "review", // case-insensitive
    });
    expect(result.isError).toBeUndefined();
    expect(calls.map((c) => `${c.method} ${c.url.replace("https://zuuna.test", "")}`)).toEqual([
      "GET /api/v1/boards",
      "GET /api/v1/boards/b1/columns",
      "POST /api/v1/boards/b1/cards",
    ]);
    expect(calls[2].body).toEqual({ title: "New card", columnId: "c2" });
  });

  it("lists the available columns when columnTitle does not match", async () => {
    await expectToolError(
      "zuuna_create_card",
      { boardId: "b1", title: "New card", columnTitle: "Wombat" },
      fixtureHandler(),
      /No column titled "Wombat".*Todo, Review, Done/s,
    );
  });

  it("fails locally when no board is given", async () => {
    await expectToolError("zuuna_create_card", { title: "New card" }, fixtureHandler(), /Provide a board/);
  });
  it("surfaces 401", () =>
    expectToolError("zuuna_create_card", { boardId: "b1", title: "x" }, always401, /401.*unauthorized/s));
  it("surfaces 404 for an unknown board id", () =>
    expectToolError(
      "zuuna_create_card",
      { boardId: "bX", title: "x" },
      fixtureHandler({ "POST /api/v1/boards/bX/cards": FIXTURE.notFoundBoard }),
      /404.*not_found.*Board not found/,
    ));
  it("surfaces network errors", () =>
    expectToolError("zuuna_create_card", { boardId: "b1", title: "x" }, alwaysNetwork, /unreachable/s));
});

describe("zuuna_update_card", () => {
  it("PATCHes only the sent fields", async () => {
    const { tools, calls } = makeTools(fixtureHandler());
    const result = await callTool(tools, "zuuna_update_card", {
      card: "ZNA-2001",
      title: "Renamed",
      priority: "LOWEST",
    });
    expect(result.isError).toBeUndefined();
    expect(calls[0]).toMatchObject({
      method: "PATCH",
      url: "https://zuuna.test/api/v1/cards/ZNA-2001",
      body: { title: "Renamed", priority: "LOWEST" },
    });
    expect(await resultJson(result)).toMatchObject({ key: "ZNA-2001" });
  });

  it("fails locally when no field is given", async () => {
    await expectToolError(
      "zuuna_update_card",
      { card: "ZNA-2001" },
      fixtureHandler(),
      /Provide at least one of: title, description, priority/,
    );
  });
  it("surfaces 401", () =>
    expectToolError("zuuna_update_card", { card: "ZNA-2001", title: "x" }, always401, /401.*unauthorized/s));
  it("surfaces 404 for an unknown card", () =>
    expectToolError(
      "zuuna_update_card",
      { card: "ZNA-9999", title: "x" },
      fixtureHandler({ "PATCH /api/v1/cards/ZNA-9999": FIXTURE.notFoundCard }),
      /404.*not_found.*Card not found/,
    ));
  it("surfaces network errors", () =>
    expectToolError("zuuna_update_card", { card: "ZNA-2001", title: "x" }, alwaysNetwork, /unreachable/s));
});

describe("zuuna_move_card", () => {
  it("PATCHes columnId when given directly", async () => {
    const { tools, calls } = makeTools(fixtureHandler());
    const result = await callTool(tools, "zuuna_move_card", { card: "ZNA-2001", columnId: "c2" });
    expect(result.isError).toBeUndefined();
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      method: "PATCH",
      url: "https://zuuna.test/api/v1/cards/ZNA-2001",
      body: { columnId: "c2" },
    });
    expect(await resultJson(result)).toMatchObject({ status: "Review", columnId: "c2" });
  });

  it("resolves columnTitle via the card's board, then PATCHes", async () => {
    const { tools, calls } = makeTools(fixtureHandler());
    const result = await callTool(tools, "zuuna_move_card", { card: "ZNA-2001", columnTitle: "Review" });
    expect(result.isError).toBeUndefined();
    expect(calls.map((c) => `${c.method} ${c.url.replace("https://zuuna.test", "")}`)).toEqual([
      "GET /api/v1/cards/ZNA-2001",
      "GET /api/v1/boards/b1/columns",
      "PATCH /api/v1/cards/ZNA-2001",
    ]);
    expect(calls[2].body).toEqual({ columnId: "c2" });
  });

  it("refuses to move a board-less backlog card by title", async () => {
    const backlogCard = { ...FIXTURE.cardDetail, boardId: null, columnId: null, status: null };
    await expectToolError(
      "zuuna_move_card",
      { card: "ZNA-2001", columnTitle: "Done" },
      fixtureHandler({ "GET /api/v1/cards/ZNA-2001": { status: 200, json: backlogCard } }),
      /group backlog.*no column to move to/,
    );
  });
  it("surfaces 401", () =>
    expectToolError("zuuna_move_card", { card: "ZNA-2001", columnId: "c2" }, always401, /401.*unauthorized/s));
  it("surfaces 404 for an unknown card", () =>
    expectToolError(
      "zuuna_move_card",
      { card: "ZNA-9999", columnId: "c2" },
      fixtureHandler({ "PATCH /api/v1/cards/ZNA-9999": FIXTURE.notFoundCard }),
      /404.*not_found.*Card not found/,
    ));
  it("surfaces network errors", () =>
    expectToolError("zuuna_move_card", { card: "ZNA-2001", columnId: "c2" }, alwaysNetwork, /unreachable/s));
});

describe("zuuna_comment", () => {
  it("POSTs the comment body to /cards/{key}/comments", async () => {
    const { tools, calls } = makeTools(fixtureHandler());
    const result = await callTool(tools, "zuuna_comment", { card: "ZNA-2001", body: "Looks good." });
    expect(result.isError).toBeUndefined();
    expect(calls[0]).toMatchObject({
      method: "POST",
      url: "https://zuuna.test/api/v1/cards/ZNA-2001/comments",
      body: { body: "Looks good." },
    });
    expect(await resultJson(result)).toMatchObject({ id: "com1" });
  });
  it("surfaces 401", () =>
    expectToolError("zuuna_comment", { card: "ZNA-2001", body: "x" }, always401, /401.*unauthorized/s));
  it("surfaces 404 for an unknown card", () =>
    expectToolError(
      "zuuna_comment",
      { card: "ZNA-9999", body: "x" },
      fixtureHandler({ "POST /api/v1/cards/ZNA-9999/comments": FIXTURE.notFoundCard }),
      /404.*not_found.*Card not found/,
    ));
  it("surfaces network errors", () =>
    expectToolError("zuuna_comment", { card: "ZNA-2001", body: "x" }, alwaysNetwork, /unreachable/s));
});
