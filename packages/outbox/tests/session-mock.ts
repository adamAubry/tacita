import type { Session } from "@tacita/client-core";
import { IDBFactory } from "fake-indexeddb";
import { vi } from "vitest";

/** Erreur du SDK reproduite en canard : errcode, httpStatus, data.retry_after_ms. */
export function matrixError(errcode: string, httpStatus: number, retryAfterMs?: number) {
  return Object.assign(new Error(errcode), {
    errcode,
    httpStatus,
    data: retryAfterMs === undefined ? {} : { retry_after_ms: retryAfterMs },
  });
}

export const networkError = () => new Error("fetch failed");

/**
 * Session mockée. `indexedDB` est une vraie IDBFactory (fake-indexeddb) partagée
 * entre deux `createOutbox` successifs, pour rejouer un rechargement de page.
 */
export function fakeSession(indexedDB: IDBFactory = new IDBFactory()) {
  let txnCounter = 0;
  const wipes = new Map<string, () => Promise<void> | void>();
  const syncListeners: ((state: string, previous: string | null) => void)[] = [];

  const client = {
    makeTxnId: vi.fn(() => `txn-${txnCounter++}`),
    sendEvent: vi.fn(
      async (_roomId: string, _type: string, _content: object, txnId?: string) => ({
        event_id: `$evt-${txnId}`,
      }),
    ),
    on: vi.fn((_event: string, listener: (state: string, previous: string | null) => void) => {
      syncListeners.push(listener);
    }),
    off: vi.fn((_event: string, listener: (state: string, previous: string | null) => void) => {
      const index = syncListeners.indexOf(listener);
      if (index >= 0) syncListeners.splice(index, 1);
    }),
  };

  const session = {
    client,
    registerWipe: vi.fn((name: string, wipe: () => Promise<void> | void) => {
      wipes.set(name, wipe);
    }),
  };

  return {
    session: session as unknown as Session,
    client,
    indexedDB,
    /** Rejoue une transition d'état de sync (reconnexion). */
    emitSync(state: string, previous: string | null) {
      for (const listener of [...syncListeners]) listener(state, previous);
    },
    async runWipes() {
      for (const wipe of wipes.values()) await wipe();
    },
  };
}
