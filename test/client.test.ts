import { describe, expect, it } from "vitest";
import { DEFAULT_BASE_URL, ZuunaApiError, ZuunaClient, ZuunaNetworkError } from "../src/client.js";
import { FIXTURE, makeClient, mockFetch } from "./helpers.js";

describe("ZuunaClient.request", () => {
  it("sends the Bearer token, Accept and JSON content type to the right URL", async () => {
    const { client, calls } = makeClient(() => ({ status: 200, json: FIXTURE.me }));
    await client.request("GET", "/api/v1/me");
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://zuuna.test/api/v1/me");
    expect(calls[0].headers.Authorization).toBe("Bearer tok_test");
    expect(calls[0].headers.Accept).toBe("application/json");

    const post = makeClient(() => ({ status: 201, json: FIXTURE.createdCard }));
    await post.client.request("POST", "/api/v1/boards/b1/cards", { body: { title: "New card" } });
    expect(post.calls[0].method).toBe("POST");
    expect(post.calls[0].headers["Content-Type"]).toBe("application/json");
    expect(post.calls[0].body).toEqual({ title: "New card" });
  });

  it("never sends a Content-Type or body when opts.body is omitted", async () => {
    const { client, calls } = makeClient(() => ({ status: 200, json: { data: [] } }));
    await client.request("GET", "/api/v1/boards");
    expect(calls[0].headers["Content-Type"]).toBeUndefined();
  });

  it("encodes query params, skipping undefined values", async () => {
    const { client, calls } = makeClient(() => ({ status: 200, json: FIXTURE.cardsB1 }));
    await client.request("GET", "/api/v1/boards/b1/cards", {
      query: { limit: 200, cursor: undefined, archived: "all" },
    });
    expect(calls[0].url).toBe("https://zuuna.test/api/v1/boards/b1/cards?limit=200&archived=all");
  });

  it("encodes path segments the caller has already escaped", async () => {
    const { client, calls } = makeClient(() => ({ status: 200, json: FIXTURE.cardDetail }));
    await client.request("GET", `/api/v1/cards/${encodeURIComponent("ZNA-2001")}`);
    expect(calls[0].url).toBe("https://zuuna.test/api/v1/cards/ZNA-2001");
  });

  it("rejects with the API's envelope on 401", async () => {
    const { client } = makeClient(() => FIXTURE.unauthorized);
    await expect(client.request("GET", "/api/v1/me")).rejects.toMatchObject({
      status: 401,
      code: "unauthorized",
      message: FIXTURE.unauthorized.json.message,
    });
  });

  it("rejects with the API's envelope on 404", async () => {
    const { client } = makeClient(() => FIXTURE.notFoundCard);
    await expect(client.request("GET", "/api/v1/cards/ZNA-9999")).rejects.toBeInstanceOf(ZuunaApiError);
    await expect(client.request("GET", "/api/v1/cards/ZNA-9999")).rejects.toMatchObject({
      status: 404,
      code: "not_found",
      message: "Card not found.",
    });
  });

  it("falls back to a generic message when the error body is not JSON", async () => {
    const { impl } = mockFetch(() => ({ status: 500, json: { error: "boom" } }));
    const client = new ZuunaClient({ baseUrl: "https://zuuna.test", token: "t", fetchImpl: impl });
    const failing = new ZuunaClient({
      baseUrl: "https://zuuna.test",
      token: "t",
      fetchImpl: (async () => new Response("<html>gateway error</html>", { status: 502 })) as typeof fetch,
    });
    await expect(client.request("GET", "/api/v1/me")).rejects.toMatchObject({ status: 500, code: "boom" });
    await expect(failing.request("GET", "/api/v1/me")).rejects.toMatchObject({ status: 502, code: "http_502" });
  });

  it("wraps network failures in ZuunaNetworkError", async () => {
    const { client } = makeClient(() => ({ networkError: "ECONNREFUSED" }));
    await expect(client.request("GET", "/api/v1/boards")).rejects.toBeInstanceOf(ZuunaNetworkError);
    await expect(client.request("GET", "/api/v1/boards")).rejects.toThrow(/ECONNREFUSED/);
  });

  it("wraps a non-JSON 200 response in ZuunaNetworkError", async () => {
    const fetchImpl = (async () => new Response("not json", { status: 200 })) as unknown as typeof fetch;
    const client = new ZuunaClient({ baseUrl: "https://zuuna.test", token: "t", fetchImpl });
    await expect(client.request("GET", "/api/v1/me")).rejects.toBeInstanceOf(ZuunaNetworkError);
    await expect(client.request("GET", "/api/v1/me")).rejects.toThrow(/non-JSON response/);
  });

  it("times out and does not retry", async () => {
    const fetchImpl = ((_url: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("The operation was aborted")));
      })) as unknown as typeof fetch;
    const client = new ZuunaClient({ baseUrl: "https://zuuna.test", token: "t", fetchImpl, timeoutMs: 30 });
    await expect(client.request("GET", "/api/v1/me")).rejects.toBeInstanceOf(ZuunaNetworkError);
    await expect(client.request("GET", "/api/v1/me")).rejects.toThrow(/timed out|aborted/i);
  });

  it("uses the documented default base URL", () => {
    expect(DEFAULT_BASE_URL).toBe("https://app.zuuna.de");
  });

  it("rejects an invalid base URL at construction (fail fast, not per tool call)", () => {
    expect(() => new ZuunaClient({ baseUrl: "app.zuuna.de", token: "t" })).toThrow(
      /Invalid ZUUNA_BASE_URL "app.zuuna.de".*absolute http\(s\) URL/,
    );
    expect(() => new ZuunaClient({ baseUrl: "ftp://zuuna.test", token: "t" })).toThrow(
      /unsupported scheme "ftp:"/,
    );
  });

  it("warns on stderr (never stdout) when the base URL is plain http", () => {
    const original = console.error;
    const seen: string[] = [];
    console.error = (msg?: unknown) => {
      seen.push(String(msg));
    };
    let warnOnly: ZuunaClient;
    try {
      warnOnly = new ZuunaClient({ baseUrl: "http://zuuna.test", token: "t" });
    } finally {
      console.error = original;
    }
    expect(warnOnly).toBeInstanceOf(ZuunaClient);
    expect(seen.join("\n")).toMatch(/not HTTPS.*cleartext/s);
  });

  it("normalizes the base URL to exactly one trailing slash", async () => {
    const { impl, calls } = mockFetch(() => ({ status: 200, json: FIXTURE.me }));
    const client = new ZuunaClient({ baseUrl: "https://zuuna.test", token: "t", fetchImpl: impl });
    await client.request("GET", "/api/v1/me");
    expect(calls[0].url).toBe("https://zuuna.test/api/v1/me");
  });
});

describe("ZuunaClient.requestRaw", () => {
  it("returns the raw ok Response without parsing it as JSON", async () => {
    const fetchImpl = (async () =>
      new Response(new Uint8Array([1, 2, 3]).buffer, {
        status: 200,
        headers: { "content-type": "image/png" },
      })) as unknown as typeof fetch;
    const client = new ZuunaClient({ baseUrl: "https://zuuna.test", token: "t", fetchImpl });
    const res = await client.requestRaw("GET", "/api/v1/cards/c1/attachments/a1");
    expect(res.headers.get("content-type")).toBe("image/png");
    expect((await res.arrayBuffer()).byteLength).toBe(3);
  });

  it("still throws ZuunaApiError on a non-2xx response", async () => {
    const { client } = makeClient(() => FIXTURE.notFoundCard);
    await expect(client.requestRaw("GET", "/api/v1/cards/x/attachments/y")).rejects.toBeInstanceOf(ZuunaApiError);
  });
});
