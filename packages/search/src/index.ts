import type { Session } from "@tacita/client-core";
import { MatrixEventEvent, type MatrixEvent } from "matrix-js-sdk";

import type { IndexableEvent, SearchHit, SearchRequest, SearchResponse, SearchStats } from "./protocol";

export { BATCH_SIZE, createEngine, MAX_EVENTS } from "./engine";
export type { EngineOptions, IndexableEvent, SearchEngine, SearchHit, SearchStats } from "./engine";
export { serve } from "./worker";

/** Fenêtre d'accumulation des événements déchiffrés avant un envoi au worker. */
export const BUFFER_MS = 250;

export interface Search {
  /** REQ-SRC-01 — indexation manuelle ; un événement ou un lot. */
  index(events: IndexableEvent | IndexableEvent[]): Promise<void>;
  /** REQ-SRC-04 — mot-clé, tous salons si `roomId` est omis. */
  search(query: string, roomId?: string): Promise<SearchHit[]>;
  /** REQ-SRC-05/06 — taille, plafond et bornes réellement couvertes. */
  stats(): Promise<SearchStats>;
  wipe(): Promise<void>;
  dispose(): void;
}

/** Ce qu'on retient d'un événement déchiffré. Rien d'autre n'entre dans l'index. */
function indexable(event: MatrixEvent): IndexableEvent | undefined {
  const body: unknown = event.getContent().body;
  const eventId = event.getId();
  const roomId = event.getRoomId();
  if (!eventId || !roomId || typeof body !== "string" || body.length === 0) return undefined;
  if (event.getType() !== "m.room.message" || event.isDecryptionFailure()) return undefined;
  return { eventId, roomId, sender: event.getSender() ?? "", ts: event.getTs(), body };
}

/**
 * REQ-SRC-01 — proxy du worker. Le `Worker` est fourni par l'appelant : ce package
 * ne connaît pas le bundler de l'application.
 *
 * REQ-SRC-07 — rien n'écoute les rotations de session Megolm. Une rotation ne
 * change pas ce qui a déjà été déchiffré et indexé ; la seule invalidation est la
 * purge D-01 ou `wipe()`.
 */
export function createSearch(session: Session, worker: Worker): Search {
  const pending = new Map<
    number,
    { resolve: (value: never) => void; reject: (error: Error) => void }
  >();
  let nextId = 0;

  worker.onmessage = ({ data }: MessageEvent<SearchResponse>) => {
    const slot = pending.get(data.id);
    if (!slot) return;
    pending.delete(data.id);
    if (data.error === undefined) slot.resolve(data.result as never);
    else slot.reject(new Error(data.error));
  };

  const call = <T>(method: SearchRequest["method"], args: unknown[]): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve: resolve as (value: never) => void, reject });
      worker.postMessage({ id, method, args } satisfies SearchRequest);
    });

  const index = (events: IndexableEvent | IndexableEvent[]) =>
    call<void>("index", [Array.isArray(events) ? events : [events]]);

  // REQ-SRC-09 — un sync de rattrapage déchiffre en rafale. On accumule sur une
  // fenêtre courte plutôt que de poster un message par événement.
  let buffer: IndexableEvent[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;

  const drain = (): void => {
    timer = undefined;
    if (buffer.length === 0) return;
    const batch = buffer;
    buffer = [];
    void index(batch);
  };

  const onDecrypted = (event: MatrixEvent): void => {
    const entry = indexable(event);
    if (!entry) return;
    buffer.push(entry);
    timer ??= setTimeout(drain, BUFFER_MS);
  };
  session.client.on(MatrixEventEvent.Decrypted, onDecrypted);

  const wipe = () => call<void>("wipe", []);
  // REQ-SRC-08 — l'index est du contenu déchiffré : la déconnexion l'efface.
  session.registerWipe("search", wipe);

  return {
    index,
    search: (query, roomId) => call<SearchHit[]>("search", [query, roomId]),
    stats: () => call<SearchStats>("stats", []),
    wipe,

    dispose() {
      if (timer) clearTimeout(timer);
      timer = undefined;
      buffer = [];
      session.client.off(MatrixEventEvent.Decrypted, onDecrypted);
      pending.clear();
      worker.terminate();
    },
  };
}
