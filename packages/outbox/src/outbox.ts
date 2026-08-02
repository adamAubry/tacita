import type { Session } from "@tacita/client-core";
import { ClientEvent, SyncState } from "matrix-js-sdk";

import { byQueuedAt, type OutboxEntry } from "./entry";
import { openOutboxStore } from "./store";

/**
 * ponytail: seul `m.room.message` est mis en file — c'est le seul type qui se
 * compose hors ligne (texte spec 05, média spec 08 produit le même type). Ajouter
 * un champ `eventType` à l'entrée le jour où un autre type doit être différé.
 */
const EVENT_TYPE = "m.room.message";

export const BASE_BACKOFF_MS = 1_000;
export const MAX_BACKOFF_MS = 60_000;

/** États de sync qui valent « le homeserver répond ». */
const HEALTHY: ReadonlySet<SyncState | null> = new Set([SyncState.Prepared, SyncState.Syncing]);

export interface OutboxOptions {
  /** Injectable en test ; `globalThis.indexedDB` en navigateur. */
  indexedDB?: IDBFactory;
  dbName?: string;
}

export interface Outbox {
  enqueue(
    roomId: string,
    content: Record<string, unknown>,
    txnId?: string,
  ): Promise<OutboxEntry>;
  /** REQ-OBX-04 — renvoi manuel après échec définitif. */
  retry(txnId: string): Promise<void>;
  /** REQ-OBX-04 — abandon d'une entrée. */
  remove(txnId: string): Promise<void>;
  /** REQ-OBX-05 — entrées du salon en ordre FIFO, à fusionner avec la timeline. */
  pending(roomId: string): OutboxEntry[];
  subscribe(listener: () => void): () => void;
  flush(): Promise<void>;
  dispose(): void;
}

/** Erreurs du SDK lues en canard : un `instanceof` casse dès que le module est dupliqué. */
function errcodeOf(error: unknown): string {
  const errcode = (error as { errcode?: unknown }).errcode;
  return typeof errcode === "string" ? errcode : "network";
}

function httpStatusOf(error: unknown): number | undefined {
  const status = (error as { httpStatus?: unknown }).httpStatus;
  return typeof status === "number" ? status : undefined;
}

function retryAfterMs(error: unknown): number | undefined {
  const data = (error as { data?: { retry_after_ms?: unknown } }).data;
  return typeof data?.retry_after_ms === "number" ? data.retry_after_ms : undefined;
}

/**
 * REQ-OBX-04 — un 4xx qui n'est pas du rate-limit ne changera pas d'avis : salon
 * inconnu, droits refusés, contenu rejeté. Réessayer en boucle ne ferait que
 * brûler la batterie. Tout le reste (réseau, 5xx, 429) reste réessayable.
 */
function isPermanent(error: unknown): boolean {
  const status = httpStatusOf(error);
  return (
    status !== undefined && status >= 400 && status < 500 && errcodeOf(error) !== "M_LIMIT_EXCEEDED"
  );
}

/** REQ-OBX-07 — exponentiel, mais le serveur a le dernier mot s'il donne un délai. */
export function backoffMs(attempts: number, error: unknown): number {
  return retryAfterMs(error) ?? Math.min(BASE_BACKOFF_MS * 2 ** attempts, MAX_BACKOFF_MS);
}

export async function createOutbox(
  session: Session,
  options: OutboxOptions = {},
): Promise<Outbox> {
  const store = await openOutboxStore(options.indexedDB ?? globalThis.indexedDB, options.dbName);
  const entries = new Map<string, OutboxEntry>();
  const listeners = new Set<() => void>();

  // REQ-OBX-01 — réhydratation : la file survit au rechargement de page, ce que le
  // local echo du SDK ne fait pas. Une entrée « sending » vient d'un onglet tué en
  // plein envoi ; elle repart en file, le txnId stable écarte le double envoi.
  for (const entry of await store.all()) {
    entries.set(entry.txnId, entry.status === "sending" ? { ...entry, status: "queued" } : entry);
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  let running: Promise<void> | undefined;
  let rerun = false;
  let disposed = false;

  const notify = () => {
    for (const listener of listeners) listener();
  };

  // Après `dispose`, la base est fermée : toute écriture qui traînait lèverait un
  // InvalidStateError. Les envois en vol se terminent, ils ne persistent plus rien.
  const save = async (entry: OutboxEntry): Promise<void> => {
    if (disposed) return;
    entries.set(entry.txnId, entry);
    await store.put(entry);
    notify();
  };

  const drop = async (txnId: string): Promise<void> => {
    if (disposed) return;
    entries.delete(txnId);
    await store.remove(txnId);
    notify();
  };

  const schedule = (): void => {
    if (timer) clearTimeout(timer);
    timer = undefined;
    if (disposed) return;
    // Seule la tête de file de chaque salon peut partir (FIFO, REQ-OBX-02). C'est
    // elle qui fixe le prochain réveil : viser une entrée coincée derrière ferait
    // tourner le timer à vide, puisqu'elle ne partira pas avant sa tête.
    const heads = new Map<string, number>();
    for (const entry of [...entries.values()].sort(byQueuedAt)) {
      if (entry.status === "failed" || heads.has(entry.roomId)) continue;
      heads.set(entry.roomId, entry.nextAttemptAt);
    }
    if (heads.size === 0) return;
    timer = setTimeout(() => void flush(), Math.max(0, Math.min(...heads.values()) - Date.now()));
  };

  const attempt = async (entry: OutboxEntry): Promise<boolean> => {
    await save({ ...entry, status: "sending" });
    try {
      await session.client.sendEvent(
        entry.roomId,
        EVENT_TYPE as never,
        entry.content as never,
        entry.txnId,
      );
      await drop(entry.txnId);
      return true;
    } catch (error) {
      const attempts = entry.attempts + 1;
      const errcode = errcodeOf(error);
      await save(
        isPermanent(error)
          ? { ...entry, status: "failed", attempts, errcode }
          : {
              ...entry,
              status: "queued",
              attempts,
              errcode,
              nextAttemptAt: Date.now() + backoffMs(entry.attempts, error),
            },
      );
      return false;
    }
  };

  const pass = async (): Promise<void> => {
    const now = Date.now();
    // REQ-OBX-02 — FIFO par salon : dès qu'une entrée d'un salon ne part pas, les
    // suivantes de ce salon attendent, sinon le message 2 doublerait le message 1.
    const blocked = new Set<string>();
    for (const entry of [...entries.values()].sort(byQueuedAt)) {
      if (disposed) return;
      if (entry.status === "failed" || blocked.has(entry.roomId)) continue;
      if (entry.nextAttemptAt > now || !(await attempt(entry))) blocked.add(entry.roomId);
    }
  };

  /**
   * Une seule passe à la fois, mais `await flush()` doit vouloir dire « tout ce qui
   * était en file a été tenté ». Un appel pendant une passe en cours réarme donc une
   * passe suivante — sinon une entrée mise en file pendant la passe serait manquée
   * par l'appelant qui attend.
   */
  function flush(): Promise<void> {
    if (disposed) return Promise.resolve();
    if (running) {
      rerun = true;
      return running;
    }
    running = (async () => {
      do {
        rerun = false;
        await pass();
      } while (rerun && !disposed);
    })().finally(() => {
      running = undefined;
      schedule();
    });
    return running;
  }

  // Connectivité prise de l'état de sync de la Session : `navigator.onLine` dit
  // seulement qu'une interface réseau existe, pas que le homeserver répond.
  const onSync = (state: SyncState, previous: SyncState | null): void => {
    if (HEALTHY.has(state) && !HEALTHY.has(previous)) void flush();
  };
  session.client.on(ClientEvent.Sync, onSync);

  // REQ-OBX-08 — la file fait partie de ce qu'une déconnexion efface.
  session.registerWipe("outbox", async () => {
    entries.clear();
    await store.clear();
    notify();
  });

  schedule();

  return {
    async enqueue(roomId, content, txnId = session.client.makeTxnId()) {
      const now = Date.now();
      const entry: OutboxEntry = {
        txnId,
        roomId,
        content,
        status: "queued",
        attempts: 0,
        queuedAt: now,
        nextAttemptAt: now,
      };
      // REQ-OBX-01 — persisté avant toute tentative réseau, jamais l'inverse.
      await save(entry);
      void flush();
      return entry;
    },

    async retry(txnId) {
      const entry = entries.get(txnId);
      if (!entry) return;
      // Renvoi demandé par l'utilisateur : le backoff repart de zéro, mais le txnId
      // ne bouge pas (REQ-OBX-03).
      await save({ ...entry, status: "queued", attempts: 0, nextAttemptAt: Date.now() });
      await flush();
    },

    remove: drop,

    pending(roomId) {
      return [...entries.values()].filter((entry) => entry.roomId === roomId).sort(byQueuedAt);
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    flush,

    dispose() {
      if (disposed) return;
      disposed = true;
      if (timer) clearTimeout(timer);
      timer = undefined;
      session.client.off(ClientEvent.Sync, onSync);
      listeners.clear();
      store.close();
    },
  };
}
