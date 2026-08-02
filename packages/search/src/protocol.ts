import type { SearchHit, SearchStats } from "./engine";

/** Contrat de messages partagé par le proxy (thread principal) et le worker. */
export interface SearchRequest {
  id: number;
  method: "index" | "search" | "stats" | "wipe";
  args: unknown[];
}

export interface SearchResponse {
  id: number;
  result?: void | SearchHit[] | SearchStats;
  error?: string;
}
