/**
 * v1 API enums the tool schemas validate against. Kept in sync by hand with
 * their kanban-app source (ZNA-2155):
 *   API_PRIORITIES, API_CARD_TYPES  <- src/lib/api-card-fields.ts
 *   CARD_RELATION_TYPES             <- src/lib/card-relations.ts
 *   GIT_KINDS, CI_STATUSES          <- src/lib/git-linking.ts
 *   WEBHOOK_EVENTS                  <- src/lib/webhook-events.ts
 */

export const API_PRIORITIES = ["HIGHEST", "HIGH", "NORMAL", "LOW", "LOWEST"] as const;
export const API_CARD_TYPES = ["TASK", "BUG", "FEATURE", "CHANGE_REQUEST"] as const;

/** "clones" is set automatically when a card is cloned and is refused by the
 * v1 route when a caller tries to add it — the tool description says so. */
export const CARD_RELATION_TYPES = [
  "relates",
  "blocks",
  "depends",
  "subtask",
  "contains",
  "causes",
  "startTogether",
  "finishTogether",
  "fs",
  "ss",
  "ff",
  "sf",
  "clones",
] as const;

export const GIT_KINDS = ["commit", "branch", "pr"] as const;
export const CI_STATUSES = ["passing", "failing", "pending", "superseded"] as const;

export const WEBHOOK_EVENTS = [
  "card.created",
  "card.moved",
  "card.assignee_added",
  "card.priority_changed",
  "card.due_arrived",
  "card.due_approaching",
  "card.sla_breached",
  "card.comment_added",
  "card.archived",
  "card.restored",
  "card.deleted",
  "git.branch_created",
  "git.commit_pushed",
  "git.pr_opened",
  "git.pr_merged",
  "ci.passed",
  "ci.failed",
  "time.logged",
  "release.created",
  "release.published",
  "release.unpublished",
  "release.deleted",
  "deploy.succeeded",
  "deploy.failed",
] as const;
