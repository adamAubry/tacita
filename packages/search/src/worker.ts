/// <reference lib="webworker" />
import { createEngine, type SearchEngine } from "./engine";
import type { SearchRequest, SearchResponse } from "./protocol";

/**
 * REQ-SRC-01 — tout ce qui coûte (indexation, requêtes) vit ici : le thread
 * principal ne fait que poster des messages.
 *
 * Le module est importable tel quel côté test ; c'est le branchement sur
 * `self` qui n'existe que dans un worker.
 */
export function serve(
  scope: Pick<DedicatedWorkerGlobalScope, "postMessage"> & {
    onmessage: ((event: MessageEvent<SearchRequest>) => void) | null;
  },
  engine: Promise<SearchEngine>,
): void {
  // Un moteur qui échoue à s'ouvrir (IndexedDB refusée, snapshot corrompu) sinon
  // produit un rejet non traité tant qu'aucun message n'est arrivé. On l'observe
  // tout de suite ; l'erreur reste rendue à l'appelant au premier appel.
  engine.catch(() => {});

  scope.onmessage = async ({ data: { id, method, args } }) => {
    const response: SearchResponse = { id };
    try {
      const ready = await engine;
      const call = ready[method] as (...rest: unknown[]) => Promise<SearchResponse["result"]>;
      response.result = await call(...args);
    } catch (error) {
      // REQ-SRC-09 — rien du texte indexé ne remonte : seul le message de l'erreur,
      // et le module n'écrit dans aucun log.
      response.error = error instanceof Error ? error.message : "erreur inconnue";
    }
    scope.postMessage(response);
  };
}

// Démarrage automatique quand ce module est le point d'entrée d'un vrai worker.
// Ailleurs — test Node, import depuis le thread principal — `self` n'existe pas
// ou porte un `document` : on ne branche rien et `serve` reste appelable à la main.
declare const self: (DedicatedWorkerGlobalScope & { document?: unknown }) | undefined;
if (typeof self !== "undefined" && typeof self.postMessage === "function" && !self.document) {
  serve(self, createEngine({ indexedDB: self.indexedDB }));
}
