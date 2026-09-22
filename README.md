# mcp-server-zuuna

[![CI](https://github.com/kenzotp/mcp-server-zuuna/actions/workflows/ci.yml/badge.svg)](https://github.com/kenzotp/mcp-server-zuuna/actions/workflows/ci.yml)

**Agent-native board access for [Zuuna](https://zuuna.de/en/kanban-board-for-ai-agents?utm_source=npm&utm_medium=referral&utm_campaign=mcp-server-readme)** — a
[Model Context Protocol](https://modelcontextprotocol.io) server that lets coding agents
(Claude Code, Cursor, Codex) read and work a Zuuna board directly.

> Agents work the board. Git keeps it honest.
>
> The agent reads the board via this MCP server, does the work in the repo with its own
> coding tools, and when the PR merges, a rule on your Zuuna board moves the card. Zuuna
> provides the interface and the verifiable board truth — the agent writes the code, not Zuuna.

## Status

Working and tested, and **published on npm** (`npx -y mcp-server-zuuna`) after an auth
review of the token model, scopes and tool surface. Run from source (bottom) if you want
to hack on it.

## Tools

| Tool | What it does | Grounded in (Zuuna v1 API) | Scopes needed |
|---|---|---|---|
| `zuuna_me` | Token identity: org, plan, scopes, grace-window deadline | `GET /api/v1/me` | any token |
| `zuuna_boards` | List boards (non-archived, non-private) | `GET /api/v1/boards` | `boards:read` |
| `zuuna_board` | One board assembled: columns in order + cards (key, title, column, priority, type) — capped at one 200-card page; when more exist it returns `cardsTruncated: true` + `nextCursor` (pass as `cardsCursor`) | `GET /api/v1/boards/{id}/columns` + `GET /api/v1/boards/{id}/cards?limit=200` | `boards:read`, `cards:read` |
| `zuuna_card` | Full card detail by display key (`ZNA-2001`) or id | `GET /api/v1/cards/{idOrKey}` | `cards:read` |
| `zuuna_create_card` | Create a card (title required; column by id or title; board by id or key; optional `idempotencyKey` makes retries safe) | `POST /api/v1/boards/{id}/cards` | `cards:write` (+ `boards:read` for key/column resolution) |
| `zuuna_update_card` | Edit title / description / priority (`HIGHEST\|HIGH\|NORMAL\|LOW\|LOWEST`, null clears) | `PATCH /api/v1/cards/{idOrKey}` | `cards:write` |
| `zuuna_move_card` | Move a card to a column, by id or title | `PATCH /api/v1/cards/{idOrKey}` (after `cards:read` for title resolution) | `cards:read`, `cards:write` |
| `zuuna_comment` | Comment on a card (author = the token's creator) | `POST /api/v1/cards/{idOrKey}/comments` | `comments:write` |

Behavioral notes:

- Errors come back as MCP tool errors **with the API's own message** (the v1 envelope's
  `message` plus status and machine `code`) — e.g. `409 wip_limit_reached` when a HARD WIP
  limit refuses a move.
- One request, **no retries**: 4xx answers are never re-sent. Requests time out after
  15 s (configurable) and surface as network errors.
- Card display keys like `ZNA-2001` work anywhere a card is addressed — the v1 API accepts
  the key as the handle.
- `zuuna_board` pages the card list (200 cards per page, the v1 API's own cap) so a big
  board cannot flood the agent's context. When a page is not the whole board, the response
  says `cardsTruncated: true` and carries `nextCursor`; send it back as `cardsCursor` to
  fetch the next page.
- `zuuna_create_card` accepts an optional client-chosen `idempotencyKey`: re-sending the
  same key after a lost response or a 5xx returns the original card (200) instead of
  minting a duplicate.

## Setup

You need an API token from your Zuuna workspace. Give it the scopes for what the agent
should be allowed to do — a read-only observer needs only `boards:read` + `cards:read`.

The server is configured per client via environment variables:

| Variable | Default | Meaning |
|---|---|---|
| `ZUUNA_API_TOKEN` | — (required) | Bearer API token |
| `ZUUNA_BASE_URL` | `https://app.zuuna.de` | Zuuna base URL — must be an absolute http(s) URL (invalid values fail at startup); a plain-http value prints a cleartext-token warning to stderr |
| `ZUUNA_TIMEOUT_MS` | `15000` | Per-request timeout |

### Claude Code

```sh
claude mcp add zuuna \
  -e ZUUNA_API_TOKEN=zk_live_your_token \
  -- npx -y mcp-server-zuuna
```

or in the project's `.mcp.json`:

```json
{
  "mcpServers": {
    "zuuna": {
      "command": "npx",
      "args": ["-y", "mcp-server-zuuna"],
      "env": { "ZUUNA_API_TOKEN": "zk_live_your_token" }
    }
  }
}
```

### Cursor

In `~/.cursor/mcp.json` (or the project's `.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "zuuna": {
      "command": "npx",
      "args": ["-y", "mcp-server-zuuna"],
      "env": { "ZUUNA_API_TOKEN": "zk_live_your_token" }
    }
  }
}
```

### Codex

In `~/.codex/config.toml`:

```toml
[mcp_servers.zuuna]
command = "npx"
args = ["-y", "mcp-server-zuuna"]
env = { "ZUUNA_API_TOKEN" = "zk_live_your_token" }
```

### Run from source

```sh
git clone https://github.com/kenzotp/mcp-server-zuuna
cd mcp-server-zuuna && npm install && npm run build
```

then point the client at the built binary instead of `npx`:

```sh
claude mcp add zuuna -e ZUUNA_API_TOKEN=zk_live_your_token -- node /path/to/mcp-server-zuuna/dist/index.js
```

## The loop

1. `zuuna_board` — the agent sees the board and picks a card (or you tell it: "do ZNA-2001").
2. The agent codes in your repo with its own tools, referencing the card key in commits.
3. The PR merges — and **git truth moves the card**: Zuuna's git integration (webhooks/CLI)
   links the commits and the PR to the card, and a rule on the board (for example "PR merged
   → move to Done") moves it. Linking works out of the box; the move is one rule you add once
   under the board's Automations. After that the agent never has to touch the board by hand,
   and the board cannot drift from the repository.

## Guides

- [Kanban board for AI agents](https://zuuna.de/en/kanban-board-for-ai-agents?utm_source=npm&utm_medium=referral&utm_campaign=mcp-server-readme): the agent
  sets up the board, writes and moves cards, comments and logs its time; the board's rules
  carry the cards from there.
- [Claude Code project management between sessions](https://zuuna.de/en/claude-code-project-management?utm_source=npm&utm_medium=referral&utm_campaign=mcp-server-readme):
  a `CLAUDE.md` routine that keeps an app's plan on the board, so each new session starts
  where the last one stopped.
- [Zuuna for AI agents](https://zuuna.de/en/agents?utm_source=npm&utm_medium=referral&utm_campaign=mcp-server-readme): the loop from card to merged PR,
  in English and German.

## Honest scope

This server is deliberately **board I/O only**. There are no deploy tools and no git-write
tools — deploys and card movement from commits belong to Zuuna's git-truth engine, not to
the agent. Agents do the coding; Zuuna keeps the board honest about it.

## Development

```sh
npm install
npm run lint     # eslint
npm run build    # tsc -> dist/
npm test         # vitest, fully mocked (no network)
```

Optional live smoke test, strictly read-only (`GET /me` and `GET /boards` only — nothing
is ever created, moved or commented):

```sh
ZUUNA_E2E=1 ZUUNA_API_TOKEN=zk_live_your_token npm run test:e2e
```

Requires Node.js >= 20.

## License

[MIT](./LICENSE)
