import type { Session } from "@tacita/client-core";
import { EventType, KnownMembership, NotificationCountType, RoomEvent, type Room } from "matrix-js-sdk";

import { messages, messageText } from "./messages";
import { createDirectMessage } from "./rooms";

/**
 * REQ-MSG-14 — l'épingle est le tag natif `m.favourite`. Rien n'est inventé par-dessus :
 * les tags sont de l'account data de salon, donc synchronisés entre les appareils sans
 * qu'aucun store maison n'ait à l'être. Le serveur les voit — c'est une métadonnée de
 * plus, au même titre que l'appartenance au salon (honnêteté produit, spec 00).
 */
export const FAVOURITE_TAG = "m.favourite";

/** REQ-MSG-13 — une conversation telle que le shard UI (spec 11) en a besoin. */
export interface Conversation {
  roomId: string;
  /** Nom du salon tel que le SDK le calcule ; en DM, c'est celui de l'autre. */
  name: string;
  direct: boolean;
  /** L'autre membre, en DM seulement. La règle d'avatar du shard en dépend. */
  peerId?: string;
  /** Dernier message texte, tel quel. La troncature est un choix de rendu. */
  preview: string;
  /** Horodatage du dernier message, `0` si le salon n'en a aucun. */
  timestamp: number;
  /** Compteur natif de notifications non lues. */
  unread: number;
  /** Au moins une mention non lue. Elle prime sur le compteur, côté rendu. */
  mention: boolean;
  pinned: boolean;
}

/** REQ-MSG-13 — une invitation en attente : la « demande d'ami » de D-09. */
export interface Invitation {
  roomId: string;
  name: string;
  /** L'invitant, quand le SDK le connaît (invitation de DM). */
  from?: string;
}

/**
 * `m.direct` est l'account data qui dit quels salons sont des DM, et avec qui. C'est la
 * seule source : `is_direct` n'est qu'un drapeau de création, il ne survit pas dans
 * l'état du salon.
 */
function directPeers(session: Session): Map<string, string> {
  const content = session.client.getAccountData(EventType.Direct)?.getContent() ?? {};
  const peers = new Map<string, string>();
  for (const [userId, roomIds] of Object.entries(content)) {
    if (!Array.isArray(roomIds)) continue;
    for (const roomId of roomIds as string[]) peers.set(roomId, userId);
  }
  return peers;
}

function describe(session: Session, room: Room, peers: Map<string, string>): Conversation {
  // REQ-MSG-12 — le dernier message est le dernier du flux /sync, pas le plus récemment
  // horodaté. Aucun tri n'est introduit ici.
  const last = messages(session, room.roomId).at(-1);
  const peerId = peers.get(room.roomId);

  return {
    roomId: room.roomId,
    name: room.name,
    direct: peerId !== undefined,
    peerId,
    preview: last ? messageText(last) : "",
    timestamp: last?.getTs() ?? 0,
    unread: room.getUnreadNotificationCount(NotificationCountType.Total),
    mention: room.getUnreadNotificationCount(NotificationCountType.Highlight) > 0,
    pinned: FAVOURITE_TAG in room.tags,
  };
}

/**
 * REQ-MSG-13 — les conversations rejointes, la plus récente d'abord.
 *
 * **Sur l'ordre.** L'interdit de tri par `origin_server_ts` (REQ-COR-04, REQ-MSG-12)
 * porte sur l'ordre des messages *dans* une timeline, où le flux /sync fait autorité et
 * où l'horodatage est un mensonge possible du serveur. Une **liste de salons**, elle,
 * n'a pas d'ordre dans /sync : `getRooms()` rend l'ordre d'insertion du store, qui n'est
 * ni la récence ni rien de stable. La récence du dernier message est le seul signal
 * disponible côté client, et il est ici *le seul* endroit du dépôt où il sert de clé de
 * tri — jamais à l'intérieur d'un salon. Décision et alternatives écartées :
 * `specs/ui/ESCALATIONS.md` § E-09.
 */
export function conversations(session: Session): Conversation[] {
  const peers = directPeers(session);
  return session.client
    .getRooms()
    .filter((room) => room.getMyMembership() === KnownMembership.Join)
    .map((room) => describe(session, room, peers))
    .sort((a, b) => b.timestamp - a.timestamp);
}

/**
 * REQ-MSG-13 — les invitations en attente. D-09 : une demande d'ami **est** une
 * invitation de salon DM native ; il n'y a pas d'autre objet à lire.
 */
export function invitations(session: Session): Invitation[] {
  return session.client
    .getRooms()
    .filter((room) => room.getMyMembership() === KnownMembership.Invite)
    .map((room) => ({ roomId: room.roomId, name: room.name, from: room.getDMInviter() }));
}

/**
 * REQ-MSG-14 — épingler et désépingler. `{}` en métadonnée : l'ordre des favoris se
 * porte par un champ `order` que rien ne lit chez nous, et l'inventer serait un tri de
 * plus à maintenir.
 */
export function setFavourite(session: Session, roomId: string, pinned: boolean): Promise<object> {
  return pinned
    ? session.client.setRoomTag(roomId, FAVOURITE_TAG, {})
    : session.client.deleteRoomTag(roomId, FAVOURITE_TAG);
}

/**
 * REQ-MSG-15 — le DM avec cet utilisateur, existant ou créé. **Jamais un second.**
 *
 * La règle vit ici et pas dans l'UI : deux écrans peuvent ouvrir une conversation
 * (accueil, profil), et une déduplication recopiée dérive. Un DM quitté ne compte pas —
 * il reste listé dans `m.direct` alors qu'on n'y est plus.
 */
export async function openDirectMessage(session: Session, userId: string): Promise<string> {
  for (const [roomId, peerId] of directPeers(session)) {
    if (peerId !== userId) continue;
    if (session.client.getRoom(roomId)?.getMyMembership() === KnownMembership.Join) return roomId;
  }
  const { room_id } = await createDirectMessage(session, userId);
  return room_id;
}

/**
 * REQ-MSG-13 — signal de changement de la liste, branché sur l'émetteur du SDK comme
 * `subscribe()` (spec 05) : aucun store ni bus maison par-dessus.
 *
 * Quatre événements, parce que quatre choses changent la liste : un message (aperçu et
 * récence), un tag (épingle), un reçu (les compteurs de non-lus retombent quand on lit
 * ailleurs) et l'appartenance (invitation acceptée, salon quitté). En manquer un donne
 * une liste qui se fige jusqu'au prochain message — le défaut le plus difficile à voir
 * en revue.
 *
 * `RoomEvent.UnreadNotifications` serait le signal direct des badges, mais le
 * `MatrixClient` **ne le réémet pas** (il n'est pas dans son union `RoomEvents`, vérifié
 * sur la version épinglée 42.0.0) : s'y abonner ne lèverait pas, ça ne ferait rien.
 * `Receipt` couvre le même besoin par le chemin que le client émet réellement.
 */
export function subscribeConversations(session: Session, listener: () => void): () => void {
  const notifier = (): void => listener();

  session.client.on(RoomEvent.Timeline, notifier);
  session.client.on(RoomEvent.Tags, notifier);
  session.client.on(RoomEvent.Receipt, notifier);
  session.client.on(RoomEvent.MyMembership, notifier);

  return () => {
    session.client.off(RoomEvent.Timeline, notifier);
    session.client.off(RoomEvent.Tags, notifier);
    session.client.off(RoomEvent.Receipt, notifier);
    session.client.off(RoomEvent.MyMembership, notifier);
  };
}
