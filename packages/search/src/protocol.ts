import type { SearchHit, SearchStats } from "./engine";

/**
 * `@room` dans `mentions` : une mention de salon mentionne tout le monde
 * mais ne porte aucun identifiant. Le littéral vient du protocole (`m.mentions.room`),
 * pas d'un contrat Tacita — aucun paquet n'importe `@tacita/messaging` en production.
 *
 * Il vit ici et non dans `engine.ts` : le thread principal en a besoin pour indexer,
 * et importer une valeur du moteur tirerait Orama dans son bundle.
 */
export const ROOM_MENTION = "@room";

/** Contrat de messages partagé par le proxy (thread principal) et le worker. */
export interface SearchRequest {
  id: number;
  method: "index" | "remove" | "search" | "stats" | "wipe";
  args: unknown[];
}

export interface SearchResponse {
  id: number;
  result?: void | SearchHit[] | SearchStats;
  error?: string;
}
