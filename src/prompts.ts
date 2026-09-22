// A few starting points for a model new to a Zuuna workspace (ZNA-2155,
// ported verbatim from the hosted endpoint's kanban-app src/lib/mcp/prompts.ts
// — none of these tool names are hosted-only, so no wording needed adapting).
// Each is one templated user-role message; none of them call the API
// themselves — the model still has to call the tools.

import { z } from "zod";

export interface PromptDef {
  name: string;
  description: string;
  argsSchema: Record<string, z.ZodTypeAny>;
  render: (args: Record<string, string>) => string;
}

export const ALL_PROMPTS: PromptDef[] = [
  {
    name: "session_start",
    description: "Orient on a board before doing anything: read it, understand a card, then act.",
    argsSchema: { board: z.string().describe("Board id, key or title.") },
    render: (args) =>
      `Call zuuna_board with board="${args.board}" to read its columns and cards. Pick the card you are about to work on with zuuna_card, and read any status block in its description before changing anything — a prior session may have left one there for you.`,
  },
  {
    name: "session_end",
    description: "Leave a card in a state the next session (human or model) can pick up from.",
    argsSchema: { card: z.string().describe("Card key or id, e.g. ZNA-2001.") },
    render: (args) =>
      `On card ${args.card}: write what you did and what is left into a status block in its description with zuuna_update_card (append, do not erase the existing one), add a short zuuna_comment summarising the change for a human reader, and move it with zuuna_move_card only if the work described by its current column is actually done.`,
  },
  {
    name: "triage_board",
    description: "Sweep a board for cards that need attention: no assignee, overdue, or stuck.",
    argsSchema: { board: z.string().describe("Board id, key or title.") },
    render: (args) =>
      `Call zuuna_board with board="${args.board}". Group its cards into: overdue (dueDate in the past, isArchived false), unassigned (assignees empty) and stuck (sitting in a non-terminal column — read statusCategory from zuuna_list_columns rather than guessing from the title). List each group with card keys; do not move or edit anything unless asked.`,
  },
  {
    name: "standup_summary",
    description: "Summarise what moved on a board since a given time, for a human standup.",
    argsSchema: {
      board: z.string().describe("Board id, key or title."),
      since: z.string().describe("ISO 8601 timestamp — usually yesterday's standup time."),
    },
    render: (args) =>
      `Call zuuna_list_board_cards with boardId="${args.board}" and updatedSince="${args.since}". For each card returned, note its key, title and current column. Group by column and write one or two sentences per group — this is for a human to skim in under a minute, not a card-by-card report.`,
  },
  {
    name: "plan_sprint",
    description: "Draft a sprint plan from a group's backlog.",
    argsSchema: { group: z.string().describe("Group id.") },
    render: (args) =>
      `Call zuuna_list_group_cards with groupId="${args.group}" and placement="backlog" to see unscheduled work. Propose a set of cards for a new sprint by priority and, where set, storyPoints — but do not create the sprint (zuuna_create_sprint) or add cards to it (zuuna_add_cards_to_sprint) until the person confirms the list.`,
  },
];
