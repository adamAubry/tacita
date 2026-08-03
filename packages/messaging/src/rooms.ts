import type { Session } from "@tacita/client-core";
import { EventType, Preset, type ISendEventResponse, type RoomMember } from "matrix-js-sdk";

/** Algorithme Megolm imposé par la spec Matrix pour un salon chiffré. */
const encryptionState = {
  type: EventType.RoomEncryption,
  state_key: "",
  content: { algorithm: "m.megolm.v1.aes-sha2" },
};

/**
 * REQ-MSG-02 — garde unique de tout ce que ce package envoie. Le chiffrement est
 * déjà garanti côté serveur (spec 01, `encryption_enabled_by_default_for_room_type`),
 * mais un envoi en clair est une fuite irréversible : on vérifie côté client avant
 * chaque écriture plutôt que de faire confiance à une config distante.
 */
export async function assertEncrypted(session: Session, roomId: string): Promise<void> {
  // Le prédicat vit dans la Session (spec 04, REQ-COR-12) : la file d'envoi de la
  // spec 07 a besoin de la même garde, et deux copies d'un contrôle de sécurité
  // dérivent. Ici on lève, parce que c'est ce que les appelants de ce package
  // attendent ; l'outbox, elle, consulte le prédicat directement.
  if (!(await session.isEncrypted(roomId))) {
    throw new Error(`salon ${roomId} non chiffré : envoi refusé`);
  }
}

/** REQ-MSG-02 — DM : salon à 2, `is_direct`, chiffré dès la création. */
export function createDirectMessage(session: Session, userId: string): Promise<{ room_id: string }> {
  return session.client.createRoom({
    is_direct: true,
    invite: [userId],
    preset: Preset.TrustedPrivateChat,
    initial_state: [encryptionState],
  });
}

/** REQ-MSG-02 — group chat, chiffré dès la création lui aussi. */
export function createGroupChat(
  session: Session,
  name: string,
  invite: string[] = [],
): Promise<{ room_id: string }> {
  return session.client.createRoom({
    name,
    invite,
    preset: Preset.PrivateChat,
    initial_state: [encryptionState],
  });
}

/**
 * REQ-MSG-08 — l'épinglage passe par `m.room.pinned_events`, un événement d'**état**.
 * Les événements d'état ne sont jamais chiffrés en Matrix : le serveur voit la liste
 * des messages épinglés d'un salon. Exposé ici, documenté dans README.md.
 */
export const PINNED_EVENTS_METADATA = {
  cleartext: true,
  reason:
    "m.room.pinned_events est un événement d'état ; Matrix ne chiffre pas l'état. " +
    "Le serveur voit quels messages sont épinglés, dans quel salon et par qui.",
} as const;

export function getPinnedEvents(session: Session, roomId: string): string[] {
  const state = session.client
    .getRoom(roomId)
    ?.currentState.getStateEvents(EventType.RoomPinnedEvents, "");
  const pinned: unknown = state?.getContent().pinned;
  return Array.isArray(pinned) ? (pinned as string[]) : [];
}

export async function setPinnedEvents(
  session: Session,
  roomId: string,
  eventIds: string[],
): Promise<ISendEventResponse> {
  await assertEncrypted(session, roomId);
  return session.client.sendStateEvent(
    roomId,
    EventType.RoomPinnedEvents,
    { pinned: eventIds },
    "",
  );
}

/**
 * REQ-MSG-11 — l'échelle de power levels Matrix est exposée telle quelle : des
 * entiers. Aucun rôle nommé, aucune catégorie, aucun héritage — la traduction en
 * libellés, si l'UI en veut, est l'affaire de l'UI.
 */
export function powerLevelOf(session: Session, roomId: string, userId: string): number {
  return session.client.getRoom(roomId)?.getMember(userId)?.powerLevel ?? 0;
}

export function setPowerLevel(
  session: Session,
  roomId: string,
  userId: string,
  powerLevel: number,
): Promise<ISendEventResponse> {
  return session.client.setPowerLevel(roomId, userId, powerLevel);
}

export function memberCount(session: Session, roomId: string): number {
  return session.client.getRoom(roomId)?.getJoinedMemberCount() ?? 0;
}

export function members(session: Session, roomId: string): RoomMember[] {
  return session.client.getRoom(roomId)?.getJoinedMembers() ?? [];
}
