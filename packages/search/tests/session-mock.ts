import { readFileSync } from "node:fs";

import type { Session } from "@tacita/client-core";
import { MatrixEventEvent, RoomEvent, type MatrixEvent } from "matrix-js-sdk";
import { vi } from "vitest";

import type { SearchRequest, SearchResponse } from "../src/protocol";

const SOURCES = ["engine.ts", "index.ts", "worker.ts", "snapshot.ts", "protocol.ts"];

/** Les interdits portent sur ce que le package exécute, pas sur ce qu'il documente. */
export function packageCode(): string {
  return SOURCES.map((name) => readFileSync(new URL(`../src/${name}`, import.meta.url), "utf-8"))
    .join("\n")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "");
}

/** Un `MatrixEvent` réduit à ce que le package en lit. */
export function matrixEvent(
  eventId: string,
  roomId: string,
  body: string,
  options: { failed?: boolean; type?: string; ts?: number; replaces?: string } = {},
): MatrixEvent {
  // REQ-SRC-10 — une édition porte la relation `m.replace` et le texte réel dans
  // `m.new_content` ; le `body` de premier niveau n'est qu'un repli « * texte ».
  const content = options.replaces
    ? {
        body: `* ${body}`,
        "m.new_content": { body },
        "m.relates_to": { rel_type: "m.replace", event_id: options.replaces },
      }
    : { body };

  return {
    getId: () => eventId,
    getRoomId: () => roomId,
    getSender: () => "@luca:tacita.test",
    getType: () => options.type ?? "m.room.message",
    getTs: () => options.ts ?? 1_000,
    getContent: () => content,
    isDecryptionFailure: () => options.failed ?? false,
  } as unknown as MatrixEvent;
}

/** Un événement de redaction : le package n'en lit que la cible. */
export function redactionOf(targetEventId: string): MatrixEvent {
  return { getAssociatedId: () => targetEventId } as unknown as MatrixEvent;
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
  // Deux flux distincts : le package écoute le déchiffrement et les redactions, et
  // confondre les deux ferait passer un test qui n'a rien branché.
  const listeners = new Map<string, ((event: MatrixEvent) => void)[]>();
  const listenersOf = (name: string) => listeners.get(name) ?? listeners.set(name, []).get(name)!;

  const client = {
    on: vi.fn((event: string, listener: (event: MatrixEvent) => void) => {
      listenersOf(event).push(listener);
    }),
    off: vi.fn((event: string, listener: (event: MatrixEvent) => void) => {
      const registered = listenersOf(event);
      const index = registered.indexOf(listener);
      if (index >= 0) registered.splice(index, 1);
    }),
  };

  const session = {
    client,
    // REQ-COR-12 — la recherche n'envoie rien, mais elle consomme le même contrat.
    isEncrypted: vi.fn(async (_roomId: string) => true),
    registerWipe: vi.fn((name: string, wipe: () => Promise<void> | void) => {
      wipes.set(name, wipe);
    }),
    // Audit des jonctions — le double cast plus bas désactive toute vérification :
    // une signature de `Session` qui dérive ne casserait rien à la compilation, et
    // l'échec deviendrait un `undefined is not a function` à l'exécution. `satisfies`
    // ancre les membres applicatifs sur le vrai contrat. Le `client` en est exclu :
    // c'est un faux assumé, exiger un vrai `MatrixClient` demanderait 357 propriétés.
  } satisfies { client: unknown } & Partial<Omit<Session, "client">>;

  return {
    session: session as unknown as Session,
    client,
    emitDecrypted(event: MatrixEvent) {
      for (const listener of [...listenersOf(MatrixEventEvent.Decrypted)]) listener(event);
    },
    emitRedaction(event: MatrixEvent) {
      for (const listener of [...listenersOf(RoomEvent.Redaction)]) listener(event);
    },
    async runWipes() {
      for (const wipe of wipes.values()) await wipe();
    },
  };
}
