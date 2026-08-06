import type { Session } from "@tacita/client-core";
import {
  ConditionKind,
  EventType,
  Preset,
  PushRuleActionName,
  PushRuleKind,
  type EmptyObject,
  type IPushRule,
  type ISendEventResponse,
  type RoomMember,
} from "matrix-js-sdk";

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

/**
 * REQ-MSG-11 — le droit d'exclure quelqu'un, **lu dans l'état du salon**, jamais deviné.
 *
 * Deux conditions, et les deux comptent : atteindre le niveau exigé pour l'action `kick`,
 * et être **strictement au-dessus** de la personne visée. Matrix refuse la seconde même
 * entre deux comptes à 100, et une UI qui ne testerait que la première afficherait un
 * bouton dont le serveur refuserait l'appel.
 *
 * Le prédicat vit ici parce que l'UI doit **masquer** le bouton non autorisé plutôt que
 * de le griser (M-H) : sans lui, le shard referait ce calcul de power levels, ce que la
 * spec 00 lui interdit.
 */
export function canKick(session: Session, roomId: string, userId: string): boolean {
  const room = session.client.getRoom(roomId);
  const self = session.client.getUserId();
  // Se sortir soi-même d'un salon est un `leave`, pas un `kick` : deux gestes distincts.
  if (!room || !self || userId === self) return false;

  const mine = room.getMember(self)?.powerLevel ?? 0;
  return (
    room.currentState.hasSufficientPowerLevelFor("kick", mine) &&
    mine > (room.getMember(userId)?.powerLevel ?? 0)
  );
}

export function kick(
  session: Session,
  roomId: string,
  userId: string,
  reason?: string,
): Promise<EmptyObject> {
  return session.client.kick(roomId, userId, reason);
}

/** REQ-MSG-11 — inviter dans un salon existant. Le chemin natif de D-09, sans détour. */
export function invite(session: Session, roomId: string, userId: string): Promise<EmptyObject> {
  return session.client.invite(roomId, userId);
}

/**
 * REQ-UIX-36 — les trois niveaux de notification d'un salon. Ce sont des **push rules
 * Matrix natives**, pas un réglage maison : le serveur les évalue, elles suivent le
 * compte sur tous ses appareils, et rien n'est à synchroniser de notre côté.
 */
export type RoomNotificationLevel = "all" | "mentions" | "mute";

/**
 * Une règle qui ne notifie pas. `dont_notify` est la forme que le SDK épinglé (42.0.0)
 * écrit lui-même dans `setRoomMutePushRule` ; une liste d'actions vide dit la même chose
 * et se rencontre sur les comptes réglés par d'autres clients. **On reconnaît les deux à
 * la lecture, on écrit celle du SDK** — s'écarter de sa forme ferait diverger notre
 * lecture de la sienne.
 */
const silent = (rule: IPushRule | undefined): boolean =>
  rule !== undefined && !rule.actions.includes(PushRuleActionName.Notify);

/** La règle d'un salon pour un genre donné : son identifiant **est** le `roomId`. */
const ruleFor = (session: Session, kind: PushRuleKind, roomId: string): IPushRule | undefined =>
  session.client.pushRules?.global?.[kind]?.find((rule) => rule.rule_id === roomId);

/**
 * REQ-UIX-36 — l'état actuel, tel que le compte le porte.
 *
 * L'ordre de lecture est celui de l'évaluation côté serveur : une règle `override`
 * l'emporte sur une règle `room`, donc « silencieux » se teste avant « mentions
 * uniquement ». L'inverse rendrait « mentions » sur un salon complètement muet.
 */
export function roomNotificationLevel(session: Session, roomId: string): RoomNotificationLevel {
  if (silent(ruleFor(session, PushRuleKind.Override, roomId))) return "mute";
  if (silent(ruleFor(session, PushRuleKind.RoomSpecific, roomId))) return "mentions";
  return "all";
}

/**
 * REQ-UIX-36 — poser le niveau.
 *
 * Les deux règles sont retirées avant d'en écrire une : un salon ne porte qu'un niveau,
 * et laisser l'ancienne à côté de la nouvelle ferait dépendre le résultat de l'ordre
 * d'évaluation du serveur plutôt que du choix de l'utilisateur.
 *
 * - `mentions` — une règle de genre `room` qui ne notifie pas. Les mentions passent quand
 *   même : `.m.rule.is_user_mention` et `.m.rule.roomnotif` sont des `override`, évaluées
 *   avant. C'est exactement ce que le niveau promet.
 * - `mute` — une règle `override` sur le `room_id`, qui passe donc **avant** les mentions
 *   et les éteint aussi.
 */
export async function setRoomNotificationLevel(
  session: Session,
  roomId: string,
  level: RoomNotificationLevel,
): Promise<void> {
  for (const kind of [PushRuleKind.Override, PushRuleKind.RoomSpecific]) {
    if (ruleFor(session, kind, roomId)) await session.client.deletePushRule("global", kind, roomId);
  }

  if (level === "mute") {
    await session.client.addPushRule("global", PushRuleKind.Override, roomId, {
      conditions: [{ kind: ConditionKind.EventMatch, key: "room_id", pattern: roomId }],
      actions: [PushRuleActionName.DontNotify],
    });
  } else if (level === "mentions") {
    // Une règle de genre `room` s'applique par son identifiant : aucune condition à écrire.
    await session.client.addPushRule("global", PushRuleKind.RoomSpecific, roomId, {
      actions: [PushRuleActionName.DontNotify],
    });
  }
}
