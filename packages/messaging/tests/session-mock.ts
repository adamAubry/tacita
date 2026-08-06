import type { Session } from "@tacita/client-core";
import { asSession } from "@tacita/client-core/testing";
import type { ICreateRoomOpts, MatrixEvent } from "matrix-js-sdk";
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

export function fakeMember(userId: string, name: string, powerLevel = 0, typing = false) {
  return { userId, name, powerLevel, typing, roomId: "!salon:tacita.test" };
}

/** Une annotation telle que le SDK la rend dans les relations d'un événement. */
export interface FakeReaction {
  key: string;
  sender?: string;
  redacted?: boolean;
}

export interface FakeRoomOptions {
  members?: ReturnType<typeof fakeMember>[];
  pinned?: string[];
  maySendEvent?: boolean;
  mayRedact?: boolean;
  /** Réactions portées par `$cible`, pour la lecture agrégée de REQ-MSG-05. */
  reactions?: FakeReaction[];
  /** REQ-MSG-17 — l'état initial de `m.ignored_user_list`. */
  ignored?: string[];
  /** REQ-MSG-18 — ce que `getProfileInfo` rend. */
  profile?: { displayname?: string; avatar_url?: string };
  /** REQ-MSG-19 — ce que l'annuaire du homeserver rend. */
  annuaire?: { user_id: string; display_name?: string; avatar_url?: string }[];
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
    reactions = [],
    profile = { displayname: "luca" },
    annuaire = [],
  } = options;
  let ignored = options.ignored ?? [];

  const transactions = new Map<string, string>();
  let autoId = 0;

  const room = {
    roomId: "!salon:tacita.test",
    getJoinedMembers: () => members,
    getJoinedMemberCount: () => members.length,
    getMembers: () => members,
    getMember: (userId: string) => members.find((member) => member.userId === userId) ?? null,
    // L'agrégation des annotations est celle du SDK : le mock rend ce qu'elle rendrait,
    // il ne la refait pas — sinon le test validerait notre propre regroupement.
    relations: {
      getChildEventsForEvent: vi.fn((_eventId: string, _relType: string, _type: string) => ({
        getRelations: () =>
          reactions.map(({ key, sender = "@luca:tacita.test", redacted = false }) => ({
            ...fakeEvent("$reaction", { "m.relates_to": { key } }, sender, "m.reaction"),
            isRedacted: () => redacted,
          })),
      })),
    },
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
    // Le modèle social de D-09 (REQ-MSG-16 à 19). `ignored` est un état porté par le
    // mock et non un tableau figé : `ignoreUser` relit la liste avant d'écrire, et un
    // faux qui rendrait toujours la même chose ne prouverait pas cette relecture.
    joinRoom: vi.fn(async (roomId: string) => ({ roomId })),
    leave: vi.fn(async (_roomId: string) => ({})),
    getIgnoredUsers: vi.fn((): string[] => ignored),
    setIgnoredUsers: vi.fn(async (userIds: string[]) => {
      ignored = userIds;
      return {};
    }),
    getProfileInfo: vi.fn(async (_userId: string) => profile),
    setDisplayName: vi.fn(async (_name: string) => ({})),
    setAvatarUrl: vi.fn(async (_url: string) => ({})),
    searchUserDirectory: vi.fn(async (_options: { term: string; limit?: number }) => ({
      results: annuaire,
      limited: false,
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
    // La conversion est ici, et nulle part ailleurs : les tests posent des faux
    // événements réduits à ce que `messages()` en lit, alors que le contrat rend des
    // `MatrixEvent`. C'est le `satisfies` ci-dessous qui a révélé l'écart — le mock
    // annonçait `unknown[]`, et personne ne le voyait.
    timeline: vi.fn((_roomId: string) => ({ events: () => timelineEvents as MatrixEvent[] })),
    // Audit des jonctions — `satisfies` ancre les membres définis ici sur le vrai
    // contrat. Les membres absents sont complétés par `asSession`, qui les fait lever
    // au lieu de manquer. Le `client` reste un faux assumé.
  } satisfies { client: unknown } & Partial<Omit<Session, "client">>;

  return {
    session: asSession(session),
    client,
    crypto,
    room,
    setTimeline(events: unknown[]) {
      timelineEvents = events;
    },
  };
}
