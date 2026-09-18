/**
 * Shapes returned by the Zuuna v1 API (source of truth: the route sources in
 * the kanban-app repo, /api/v1). Kept narrow: only fields the MCP tools or an
 * agent consumer actually need. The server passes payloads through as JSON, so
 * additive API changes flow through unchanged.
 */

/** GET /api/v1/me — token self-description. */
export interface ZuunaMe {
  tokenId: string;
  org: { id: string; product: string; plan: string };
  scopes: string[];
  /** Set only while the workspace is LAPSED and the token runs on its grace window. */
  apiAccessEndsAt: string | null;
}

/** GET /api/v1/boards — list item. Private and archived boards are excluded by the API. */
export interface ZuunaBoard {
  id: string;
  title: string;
  key: string | null;
  description: string | null;
  groupId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ZuunaBoardsResponse {
  data: ZuunaBoard[];
  nextCursor?: string;
}

export type ColumnStatusCategory = "OPEN" | "ACTIVE" | "DONE";

/** GET /api/v1/boards/{boardId}/columns — the board's columns, in order. */
export interface ZuunaColumn {
  id: string;
  title: string;
  isDone: boolean;
  /** The cross-board status axis: "OPEN" | "ACTIVE" | "DONE". */
  statusCategory: ColumnStatusCategory;
  position: number;
  wipLimit: number | null;
  wipLimitMode: "SOFT" | "HARD";
  slaHours: number | null;
}

export interface ZuunaColumnsResponse {
  boardId: string;
  title: string;
  key: string | null;
  groupId: string | null;
  columns: ZuunaColumn[];
}

/** Card entry from GET /api/v1/boards/{boardId}/cards (unpaged default: the full board). */
export interface ZuunaBoardCard {
  id: string;
  key: string;
  title: string;
  /** Column title. */
  status: string;
  columnId: string;
  priority: string | null;
  type: string;
  dueDate: string | null;
  estimateSeconds: number | null;
  isArchived: boolean;
  assignees: { id: string; name: string }[];
  customFields: { fieldId: string; name: string; type: string; value: unknown }[];
  updatedAt: string;
}

export interface ZuunaBoardCardsResponse {
  data: ZuunaBoardCard[];
  nextCursor?: string;
}

/** GET /api/v1/cards/{idOrKey} — full card detail. */
export interface ZuunaCardDetail {
  id: string;
  key: string | null;
  title: string;
  description: string | null;
  /** null on a board-less backlog card. */
  status: string | null;
  columnId: string | null;
  boardId: string | null;
  groupId: string | null;
  priority: string | null;
  type: string;
  dueDate: string | null;
  estimateSeconds: number | null;
  storyPoints: number | null;
  ready: boolean | null;
  isArchived: boolean;
  updatedAt: string;
  checklist: { total: number; completed: number };
  assignees: { id: string; name: string }[];
  epic: { id: string; key: string; title: string; color: string } | null;
  customFields: { fieldId: string; name: string; type: string; value: unknown }[];
  attachments: { id: string; originalName: string; mimeType: string; size: number; createdAt: string }[];
}

/** POST /api/v1/boards/{boardId}/cards and PATCH /api/v1/cards/{idOrKey} share this response shape. */
export interface ZuunaCardWriteResult {
  id: string;
  key: string | null;
  title: string;
  status: string | null;
  columnId: string | null;
}

/** POST /api/v1/cards/{cardId}/comments */
export interface ZuunaCommentResult {
  id: string;
  createdAt: string;
}
