import type { Session } from "@tacita/client-core";
import {
  ClientEvent,
  EventType,
  KnownMembership,
  NotificationCountType,
  RoomEvent,
  type Room,
} from "matrix-js-sdk";

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

/**
 * REQ-MSG-15 — **inscrit un salon dans `m.direct`.** Personne d'autre ne le fait.
 *
 * `createRoom({ is_direct: true })` ne pose ce drapeau que dans l'invitation envoyée : le
 * serveur n'écrit **pas** l'account data `m.direct` du créateur, et le SDK non plus. Sans
 * cette écriture, un DM créé par l'app n'est un DM pour personne — mesuré avec deux
 * navigateurs contre un vrai Synapse le 07/08/2026, où un DM s'affichait « 2 membres,
 * c'est le début de ce groupe ».
 *
 * Cinq choses en dépendaient, toutes cassées en silence : le libellé et l'avatar du DM,
 * la liste d'amis (vide, elle filtre sur `peerId`), « retirer un ami » (ne trouvait aucun
 * salon), et surtout la déduplication de REQ-MSG-15 — sans `m.direct`, `openDirectMessage`
 * recréait un salon **à chaque fois**, ce que l'exigence interdit explicitement.
 *
 * Lecture-modification-écriture : l'account data est un document unique pour tous les
 * correspondants, l'écraser effacerait les autres DM (même motif que `ignoreUser`).
 */
export async function registerDirect(
  session: Session,
  userId: string,
  roomId: string,
): Promise<void> {
  const contenu = { ...(session.client.getAccountData(EventType.Direct)?.getContent() ?? {}) };
  const existants: string[] = Array.isArray(contenu[userId]) ? [...contenu[userId]] : [];
  if (existants.includes(roomId)) return;

  await session.client.setAccountData(EventType.Direct, {
    ...contenu,
    [userId]: [...existants, roomId],
  });
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
  // Sans cette ligne, la boucle ci-dessus ne retrouvera jamais ce salon et un second
  // sera créé au prochain appel — ce que REQ-MSG-15 interdit.
  await registerDirect(session, userId, room_id);
  return room_id;
}

/**
 * REQ-MSG-13 — signal de changement de la liste, branché sur l'émetteur du SDK comme
 * `subscribe()` (spec 05) : aucun store ni bus maison par-dessus.
 *
 * Cinq événements, parce que cinq choses changent la liste : l'apparition d'un salon
 * (invitation reçue), un message (aperçu et récence), un tag (épingle), un reçu (les
 * compteurs de non-lus retombent quand on lit ailleurs) et l'appartenance (invitation
 * acceptée, salon quitté). En manquer un donne une liste qui se fige jusqu'au prochain
 * message — le défaut le plus difficile à voir en revue, et le premier des cinq a
 * effectivement manqué jusqu'au 07/08/2026.
 *
 * `RoomEvent.UnreadNotifications` serait le signal direct des badges, mais le
 * `MatrixClient` **ne le réémet pas** (il n'est pas dans son union `RoomEvents`, vérifié
 * sur la version épinglée 42.0.0) : s'y abonner ne lèverait pas, ça ne ferait rien.
 * `Receipt` couvre le même besoin par le chemin que le client émet réellement.
 */
export function subscribeConversations(session: Session, listener: () => void): () => void {
  const notifier = (): void => listener();

  /**
   * `ClientEvent.Room` — **l'apparition d'un salon**, et non un changement dans un salon
   * déjà connu. C'est le signal d'une invitation reçue : le salon n'existait pas encore
   * côté client, donc aucun de ses propres événements n'a pu être réémis à temps.
   *
   * Mesuré contre un vrai Synapse le 07/08/2026, avec deux navigateurs : sans lui, une
   * demande d'ami n'apparaissait **qu'après rechargement complet de la page**. Le serveur
   * la livrait bien — elle était dans le `/sync` de l'invité — mais rien dans l'app ne
   * disait qu'il fallait relire. C'est le parcours d'entrée du produit (D-09) : on ne
   * peut pas commencer une conversation sans que l'autre voie la demande.
   *
   * `MyMembership` ne suffit pas et reste nécessaire : il porte l'acceptation et le
   * départ, sur des salons déjà connus.
   */
  session.client.on(ClientEvent.Room, notifier);
  session.client.on(RoomEvent.Timeline, notifier);
  session.client.on(RoomEvent.Tags, notifier);
  session.client.on(RoomEvent.Receipt, notifier);
  session.client.on(RoomEvent.MyMembership, notifier);

  return () => {
    session.client.off(ClientEvent.Room, notifier);
    session.client.off(RoomEvent.Timeline, notifier);
    session.client.off(RoomEvent.Tags, notifier);
    session.client.off(RoomEvent.Receipt, notifier);
    session.client.off(RoomEvent.MyMembership, notifier);
  };
}
