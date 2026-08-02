import type { Session } from "@tacita/client-core";
import type { MatrixEvent } from "matrix-js-sdk";
import { vi } from "vitest";

import type { SearchRequest, SearchResponse } from "../src/protocol";

/** Un `MatrixEvent` réduit à ce que le package en lit. */
export function matrixEvent(
  eventId: string,
  roomId: string,
  body: string,
  options: { failed?: boolean; type?: string } = {},
): MatrixEvent {
  return {
    getId: () => eventId,
    getRoomId: () => roomId,
    getSender: () => "@luca:tacita.test",
    getType: () => options.type ?? "m.room.message",
    getTs: () => 1_000,
    getContent: () => ({ body }),
    isDecryptionFailure: () => options.failed ?? false,
  } as unknown as MatrixEvent;
}

/**
 * Deux bouts d'un même canal : `outside` est ce que voit le proxy, `inside` ce que
 * voit le worker. Le relais est asynchrone — jamais synchrone, sinon le test
 * validerait un couplage qui n'existe pas — mais en microtâche plutôt qu'en
 * `setTimeout`, pour rester insensible aux tests qui figent les timers.
 */
export function fakeWorker() {
  const posted: SearchRequest[] = [];

  const outside = {
    onmessage: null as ((event: MessageEvent<SearchResponse>) => void) | null,
    postMessage(request: SearchRequest) {
      posted.push(request);
      queueMicrotask(() => inside.onmessage?.({ data: request } as MessageEvent<SearchRequest>));
    },
    terminate: vi.fn(),
  };

  const inside = {
    onmessage: null as ((event: MessageEvent<SearchRequest>) => void) | null,
    postMessage(response: SearchResponse) {
      setTimeout(() => outside.onmessage?.({ data: response } as MessageEvent<SearchResponse>), 0);
    },
  };

  return { outside: outside as unknown as Worker, inside, posted };
}

export function fakeSession() {
  const wipes = new Map<string, () => Promise<void> | void>();
  const decryptedListeners: ((event: MatrixEvent) => void)[] = [];

  const client = {
    on: vi.fn((_event: string, listener: (event: MatrixEvent) => void) => {
      decryptedListeners.push(listener);
    }),
    off: vi.fn((_event: string, listener: (event: MatrixEvent) => void) => {
      const index = decryptedListeners.indexOf(listener);
      if (index >= 0) decryptedListeners.splice(index, 1);
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
    emitDecrypted(event: MatrixEvent) {
      for (const listener of [...decryptedListeners]) listener(event);
    },
    async runWipes() {
      for (const wipe of wipes.values()) await wipe();
    },
  };
}
