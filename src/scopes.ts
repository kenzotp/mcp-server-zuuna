/**
 * The Zuuna v1 API's scope catalog (mirrors kanban-app's src/lib/api-scopes.ts,
 * ZNA-2155). A token carries a subset of these; `zuuna_me` reports which ones.
 */
export const API_SCOPES = [
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
] as const;

export type ApiScope = (typeof API_SCOPES)[number];
