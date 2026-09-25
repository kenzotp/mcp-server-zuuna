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

## Hosted alternative

The same 71 tools are also available with nothing to install: Zuuna runs a hosted MCP
connector at [app.zuuna.de/mcp](https://app.zuuna.de/mcp) (OAuth sign-in, Developer plan).
Point Claude Code, Cursor or Codex at that URL directly and skip the token and the npx
line below. This package exists for the case that does need a local process: a CI runner,
an air-gapped agent, or a workflow that wants a plain bearer token instead of an OAuth
sign-in. See [Kanban board for AI agents](https://zuuna.de/en/kanban-board-for-ai-agents?utm_source=npm&utm_medium=referral&utm_campaign=mcp-server-readme)
for both routes side by side.

## Tools

71 tools, grouped by area. Every tool works with any valid token; the Scopes column lists
what else the token must carry. The 8 marked **destructive** refuse to run without an
explicit `confirm: true` argument.

### Identity

| Tool | Method + path | Scopes |
|---|---|---|
| `zuuna_me` | `GET /api/v1/me` | none |

### Groups

| Tool | Method + path | Scopes |
|---|---|---|
| `zuuna_list_groups` | `GET /api/v1/groups` | `boards:read` |
| `zuuna_list_group_members` | `GET /api/v1/groups/{groupId}/members` | `boards:read` |
| `zuuna_list_epics` | `GET /api/v1/groups/{groupId}/epics` | `boards:read` |
| `zuuna_list_group_cards` | `GET /api/v1/groups/{groupId}/cards` | `cards:read` |

### Boards

| Tool | Method + path | Scopes |
|---|---|---|
| `zuuna_boards` | `GET /api/v1/boards` | `boards:read` |
| `zuuna_board` | `GET /api/v1/boards/{id}/columns` + `GET /api/v1/boards/{id}/cards` | `boards:read`, `cards:read` |
| `zuuna_create_board` | `POST /api/v1/boards` | `boards:write` |
| `zuuna_list_columns` | `GET /api/v1/boards/{boardId}/columns` | `boards:read` |
| `zuuna_list_board_fields` | `GET /api/v1/boards/{boardId}/fields` | `boards:read` |
| `zuuna_create_column` | `POST /api/v1/boards/{boardId}/columns` | `boards:write` |
| `zuuna_list_automations` | `GET /api/v1/boards/{boardId}/automations` | `boards:read` |

### Cards

| Tool | Method + path | Scopes |
|---|---|---|
| `zuuna_card` | `GET /api/v1/cards/{idOrKey}` | `cards:read` |
| `zuuna_list_board_cards` | `GET /api/v1/boards/{boardId}/cards` | `cards:read` |
| `zuuna_search_cards` | `GET /api/v1/cards` | `cards:read` |
| `zuuna_create_card` | `POST /api/v1/boards/{boardId}/cards` | `cards:write` |
| `zuuna_create_cards` | `POST /api/v1/boards/{boardId}/cards` (`{"cards":[...]}`) | `cards:write` |
| `zuuna_update_card` | `PATCH /api/v1/cards/{idOrKey}` | `cards:write` |
| `zuuna_move_card` | `PATCH /api/v1/cards/{idOrKey}` | `cards:write` |
| `zuuna_move_card_to_board` | `POST /api/v1/cards/{cardId}/move` | `cards:write` |
| `zuuna_archive_card` | `POST /api/v1/cards/{cardId}/archive` | `cards:write` |
| `zuuna_unarchive_card` | `DELETE /api/v1/cards/{cardId}/archive` | `cards:write` |
| `zuuna_delete_card` **(destructive)** | `DELETE /api/v1/cards/{cardId}` | `cards:write` |
| `zuuna_restore_card` | `POST /api/v1/cards/{cardId}/restore` | `cards:write` |

### Comments

| Tool | Method + path | Scopes |
|---|---|---|
| `zuuna_list_comments` | `GET /api/v1/cards/{cardId}/comments` | `comments:read` |
| `zuuna_comment` | `POST /api/v1/cards/{cardId}/comments` | `comments:write` |

### Checklist

| Tool | Method + path | Scopes |
|---|---|---|
| `zuuna_list_checklist` | `GET /api/v1/cards/{cardId}/checklist` | `cards:read` |
| `zuuna_add_checklist_item` | `POST /api/v1/cards/{cardId}/checklist` | `cards:write` |
| `zuuna_update_checklist_item` | `PATCH /api/v1/cards/{cardId}/checklist/{itemId}` | `cards:write` |
| `zuuna_delete_checklist_item` **(destructive)** | `DELETE /api/v1/cards/{cardId}/checklist/{itemId}` | `cards:write` |

### Relations

| Tool | Method + path | Scopes |
|---|---|---|
| `zuuna_list_relations` | `GET /api/v1/cards/{cardId}/relations` | `cards:read` |
| `zuuna_add_relation` | `POST /api/v1/cards/{cardId}/relations` | `cards:write` |
| `zuuna_delete_relation` **(destructive)** | `DELETE /api/v1/cards/{cardId}/relations/{linkId}` | `cards:write` |

### Attachments

Upload included since ZNA-2170: `zuuna_upload_attachment` takes a local file path, or base64 bytes plus a filename. List and get still return metadata only, never the bytes themselves.

| Tool | Method + path | Scopes |
|---|---|---|
| `zuuna_list_attachments` | `GET /api/v1/cards/{cardId}/attachments` | `cards:read` |
| `zuuna_upload_attachment` | `POST /api/v1/cards/{cardId}/attachments` | `cards:write` |
| `zuuna_get_attachment` | `GET /api/v1/cards/{cardId}/attachments/{attachmentId}` (metadata only) | `cards:read` |
| `zuuna_delete_attachment` **(destructive)** | `DELETE /api/v1/cards/{cardId}/attachments/{attachmentId}` | `cards:write` |

### Time tracking

| Tool | Method + path | Scopes |
|---|---|---|
| `zuuna_list_card_time` | `GET /api/v1/cards/{cardId}/time` | `time:read` |
| `zuuna_log_time` | `POST /api/v1/cards/{cardId}/time` | `time:write` |
| `zuuna_start_timer` | `POST /api/v1/cards/{cardId}/time` | `time:write` |
| `zuuna_stop_timer` | `POST /api/v1/cards/{cardId}/time` | `time:write` |
| `zuuna_list_active_timers` | `GET /api/v1/time/active` | `time:read` |
| `zuuna_update_time_entry` | `PATCH /api/v1/time/{entryId}` | `time:write` |
| `zuuna_delete_time_entry` **(destructive)** | `DELETE /api/v1/time/{entryId}` | `time:write` |
| `zuuna_import_time_entries` | `POST /api/v1/time/entries` | `time:write` |

### Sprints

| Tool | Method + path | Scopes |
|---|---|---|
| `zuuna_list_sprints` | `GET /api/v1/sprints` | `boards:read` |
| `zuuna_get_sprint` | `GET /api/v1/sprints/{sprintId}` | `boards:read` |
| `zuuna_create_sprint` | `POST /api/v1/sprints` | `cards:write` |
| `zuuna_update_sprint` | `PATCH /api/v1/sprints/{sprintId}` | `cards:write` |
| `zuuna_add_cards_to_sprint` | `POST /api/v1/sprints/{sprintId}/cards` | `cards:write` |
| `zuuna_remove_card_from_sprint` | `DELETE /api/v1/sprints/{sprintId}/cards/{cardId}` | `cards:write` |

### Recurring cards

| Tool | Method + path | Scopes |
|---|---|---|
| `zuuna_list_recurring_cards` | `GET /api/v1/boards/{boardId}/recurring` | `boards:read` |
| `zuuna_create_recurring_card` | `POST /api/v1/boards/{boardId}/recurring` | `cards:write` |
| `zuuna_update_recurring_card` | `PATCH /api/v1/recurring/{id}` | `cards:write` |
| `zuuna_delete_recurring_card` **(destructive)** | `DELETE /api/v1/recurring/{id}` | `cards:write` |

### Releases

| Tool | Method + path | Scopes |
|---|---|---|
| `zuuna_list_releases` | `GET /api/v1/releases` | `boards:read` |
| `zuuna_get_release` | `GET /api/v1/releases/{releaseId}` | `boards:read` |
| `zuuna_create_release` | `POST /api/v1/releases` | `releases:write` |
| `zuuna_update_release` | `PATCH /api/v1/releases/{releaseId}` | `releases:write` |
| `zuuna_delete_release` **(destructive)** | `DELETE /api/v1/releases/{releaseId}` | `releases:write` |

### Deployments

Observation only: there is no "trigger a deploy" tool, on the hosted connector either (see "Honest scope").

| Tool | Method + path | Scopes |
|---|---|---|
| `zuuna_list_deployments` | `GET /api/v1/deployments` | `boards:read` |
| `zuuna_report_deployment` | `POST /api/v1/deployments` | `deployments:write` |

### Webhooks

| Tool | Method + path | Scopes |
|---|---|---|
| `zuuna_list_webhooks` | `GET /api/v1/webhooks` | `webhooks:manage` |
| `zuuna_create_webhook` | `POST /api/v1/webhooks` | `webhooks:manage` |
| `zuuna_update_webhook` | `PATCH /api/v1/webhooks/{id}` | `webhooks:manage` |
| `zuuna_delete_webhook` **(destructive)** | `DELETE /api/v1/webhooks/{id}` | `webhooks:manage` |
| `zuuna_test_webhook` | `POST /api/v1/webhooks/{id}/test` | `webhooks:manage` |
| `zuuna_list_webhook_deliveries` | `GET /api/v1/webhooks/{id}/deliveries` | `webhooks:manage` |

### Git on board

Link commits, branches, PRs and CI status to cards. None of these move a card by
themselves (see "Honest scope").

| Tool | Method + path | Scopes |
|---|---|---|
| `zuuna_link_git_branches` | `POST /api/v1/git/branches` | `git:write` |
| `zuuna_report_ci_checks` | `POST /api/v1/git/checks` | `git:write` |
| `zuuna_record_git_events` | `POST /api/v1/git/events` | `git:write` |

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
- `zuuna_me` also returns a `hiddenTools` list: every tool this token's scopes hide, each with the scope or scopes that would unlock it (the same boundary the startup scope-gating applies).
- At startup the server reads its own token's scopes (`GET /api/v1/me`) and registers only
  the tools they cover, the same scope gating the hosted connector applies. If that read
  fails (no network yet, an invalid token) it registers every tool instead and prints one
  line to stderr saying so; every call is still enforced by the API regardless of what got
  registered.
- Five prompts ship alongside the tools (`session_start`, `session_end`, `triage_board`,
  `standup_summary`, `plan_sprint`), starting points for a client that surfaces MCP
  prompts, not required for using the tools directly.

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

There is still no tool that triggers a deploy. `zuuna_report_deployment` (`deployments:write`)
only records what a pipeline already did (building, succeeded, failed); actually shipping
stays with your own CI, not the agent.

There are now three `git:write` tools, and what they do is narrower than the name suggests:

- `zuuna_record_git_events` and `zuuna_report_ci_checks` attach commit/branch/PR history and
  CI status to whichever card a smart-commit reference or description names.
- `zuuna_link_git_branches` replaces a repo's whole in-flight-branches snapshot in one call.

None of the three **moves a card**. A card moves only because a board rule matched it (see
"The loop" above) or because `zuuna_move_card` / `zuuna_update_card` was called directly.
Automations themselves stay read-only here too (`zuuna_list_automations`): no tool creates,
edits or disables one. Attachment uploads go through as multipart (ZNA-2170) with the REST
route's own limits and errors; no tool ever READS a file's bytes back out.

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
