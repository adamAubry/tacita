import type { IndexableEvent, SearchHit, SearchStats } from "./engine";

/** Méthodes exposées par le worker. Le proxy et le worker partagent ce contrat. */
export type SearchMethod = "index" | "search" | "stats" | "wipe";

export interface SearchRequest {
  id: number;
  method: SearchMethod;
  args: unknown[];
}

export interface SearchResponse {
  id: number;
  result?: void | SearchHit[] | SearchStats;
  error?: string;
}

export type { IndexableEvent, SearchHit, SearchStats };
