/// <reference lib="webworker" />
import { createEngine, type SearchEngine } from "./engine";
import type { SearchRequest, SearchResponse } from "./protocol";

/**
 * tout ce qui coûte (indexation, requêtes) vit ici : le thread
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

  const handle = async ({ id, method, args }: SearchRequest): Promise<void> => {
    const response: SearchResponse = { id };
    try {
      const ready = await engine;
      const call = ready[method] as (...rest: unknown[]) => Promise<SearchResponse["result"]>;
      response.result = await call(...args);
    } catch (error) {
      // rien du texte indexé ne remonte : seul le message de l'erreur,
      // et le module n'écrit dans aucun log.
      response.error = error instanceof Error ? error.message : "erreur inconnue";
    }
    scope.postMessage(response);
  };

  /**
   * les requêtes se sérialisent. Un `wipe` qui s'exécutait entre deux lots
   * d'un `index` en cours laissait la boucle reprendre et `persist()` réécrire ce que
   * le wipe venait d'effacer. Elles se disputaient déjà une seule base Orama : il n'y a
   * aucun parallélisme réel à perdre.
   *
   * ponytail: file globale. Un `index` de rattrapage fait attendre une recherche
   * derrière lui ; découper l'indexation en un message par lot si ça devient visible.
   */
  let queue: Promise<void> = Promise.resolve();
  scope.onmessage = ({ data }) => {
    queue = queue.then(() => handle(data));
  };
}

// Démarrage automatique quand ce module est le point d'entrée d'un vrai worker.
// Ailleurs — test Node, import depuis le thread principal — `self` n'existe pas
// ou porte un `document` : on ne branche rien et `serve` reste appelable à la main.
declare const self: (DedicatedWorkerGlobalScope & { document?: unknown }) | undefined;
if (typeof self !== "undefined" && typeof self.postMessage === "function" && !self.document) {
  serve(self, createEngine({ indexedDB: self.indexedDB }));
}
