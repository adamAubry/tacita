import type { Session } from "@tacita/client-core";
import type { ICreateRoomOpts } from "matrix-js-sdk";
import { vi } from "vitest";

/** Un `MatrixEvent` réduit à ce que le package en lit. */
export function fakeEvent(
  id: string,
  content: Record<string, unknown>,
  sender = "@luca:tacita.test",
  type = "m.room.message",
) {
  return {
    getId: () => id,
    getType: () => type,
    getSender: () => sender,
    getContent: () => content,
  };
}

export function fakeMember(userId: string, name: string, powerLevel = 0) {
  return { userId, name, powerLevel };
}

export interface FakeRoomOptions {
  members?: ReturnType<typeof fakeMember>[];
  pinned?: string[];
  maySendEvent?: boolean;
  mayRedact?: boolean;
}

/**
 * Session mockée (spec 05 — « suite Vitest avec Session mockée »). `sendEvent`
 * simule la déduplication par `txnId` du serveur : même transaction, même
 * `event_id` (REQ-MSG-03).
 */
export function fakeSession(options: FakeRoomOptions = {}) {
  const {
    members = [fakeMember("@luca:tacita.test", "luca", 100)],
    pinned = [],
    maySendEvent = true,
    mayRedact = true,
  } = options;

  const transactions = new Map<string, string>();
  let autoId = 0;

  const room = {
    roomId: "!salon:tacita.test",
    getJoinedMembers: () => members,
    getJoinedMemberCount: () => members.length,
    getMember: (userId: string) => members.find((member) => member.userId === userId) ?? null,
    currentState: {
      getStateEvents: vi.fn((_type: string, _stateKey: string) => ({
        getContent: () => ({ pinned }),
      })),
      maySendEvent: vi.fn(() => maySendEvent),
      maySendRedactionForEvent: vi.fn(() => mayRedact),
    },
  };

  const crypto = { isEncryptionEnabledInRoom: vi.fn(async (_roomId: string) => true) };

  const client = {
    getUserId: vi.fn(() => "@luca:tacita.test"),
    getCrypto: vi.fn(() => crypto),
    getRoom: vi.fn((_roomId: string): typeof room | null => room),
    sendEvent: vi.fn(
      async (_roomId: string, _type: string, _content: object, txnId?: string) => {
        const key = txnId ?? `auto-${autoId++}`;
        if (!transactions.has(key)) transactions.set(key, `$evt${transactions.size}`);
        return { event_id: transactions.get(key)! };
      },
    ),
    sendStateEvent: vi.fn(async () => ({ event_id: "$state" })),
    redactEvent: vi.fn(async () => ({ event_id: "$redaction" })),
    // Les paramètres portent la forme du vrai type : sans eux, `mock.calls` est typé
    // comme un tuple vide et les assertions sur les arguments ne compilent pas.
    sendTyping: vi.fn(async (_roomId: string, _isTyping: boolean, _timeoutMs: number) => ({})),
    createRoom: vi.fn(async (_opts: ICreateRoomOpts) => ({ room_id: "!nouveau:tacita.test" })),
    setPowerLevel: vi.fn(async (_roomId: string, _userId: string, _level: number) => ({
      event_id: "$pl",
    })),
    on: vi.fn(),
    off: vi.fn(),
  };

  let timelineEvents: unknown[] = [];

  const session = {
    client,
    // REQ-COR-12 — le prédicat **dérive** du crypto comme dans la vraie Session, au
    // lieu de rendre `true` en dur : les tests qui simulent un salon non chiffré le
    // font en pilotant le crypto, et c'est ce couplage-là qu'ils doivent exercer.
    isEncrypted: vi.fn(async (roomId: string) => {
      try {
        return (await client.getCrypto()?.isEncryptionEnabledInRoom(roomId)) ?? false;
      } catch {
        return false;
      }
    }),
    timeline: vi.fn((_roomId: string) => ({ events: () => timelineEvents })),
  };

  return {
    session: session as unknown as Session,
    client,
    crypto,
    room,
    setTimeline(events: unknown[]) {
      timelineEvents = events;
    },
  };
}
