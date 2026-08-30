/**
 * Un message dans un salon : l'envoyer, y répondre, l'éditer, le retirer, y réagir.
 *
 * Fonctions pures ou prenant la `Session` en premier argument ; aucun état ici.
 * Les réactions sont des annotations Matrix — donc en clair, et le README du paquet
 * le dit.
 */
import type { Session } from "@tacita/client-core";
import {
  EventType,
  MatrixEventEvent,
  MsgType,
  RelationType,
  RoomEvent,
  type ISendEventResponse,
  type MatrixEvent,
  type Room,
} from "matrix-js-sdk";

import { parseMentions, type MentionCandidate } from "./mentions";
import { assertEncrypted } from "./rooms";

export interface SendOptions {
  /**
   * identifiant de transaction. La déduplication est celle du SDK et
   * du serveur : rejouer la même requête avec le même `txnId` rend le même
   * `event_id`. Omis, c'est `MatrixClient.makeTxnId` qui en fabrique un — ce
   * package n'en génère jamais et n'empile aucun cache par-dessus.
   */
  txnId?: string;
  /** Candidats d'autocomplétion pour résoudre les `@pseudo` du texte. */
  mentions?: MentionCandidate[];
}

type TextContent = {
  msgtype: MsgType.Text;
  body: string;
  "m.mentions"?: { room?: true; user_ids?: string[] };
  "m.new_content"?: { msgtype: MsgType.Text; body: string };
  "m.relates_to"?: Record<string, unknown>;
};

/** Tout envoi du package passe ici : un seul endroit où la garde de chiffrement vit. */
async function send(
  session: Session,
  roomId: string,
  type: EventType,
  content: object,
  txnId?: string,
): Promise<ISendEventResponse> {
  await assertEncrypted(session, roomId);
  return session.client.sendEvent(roomId, type as never, content as never, txnId);
}

function textContent(text: string, opts: SendOptions): TextContent {
  const { body, "m.mentions": mentions } = parseMentions(text, opts.mentions);
  const content: TextContent = { msgtype: MsgType.Text, body };
  if (Object.keys(mentions).length > 0) content["m.mentions"] = mentions;
  return content;
}

/** message texte chiffré (`m.room.message` en salon chiffré). */
export function sendText(
  session: Session,
  roomId: string,
  text: string,
  opts: SendOptions = {},
): Promise<ISendEventResponse> {
  return send(session, roomId, EventType.RoomMessage, textContent(text, opts), opts.txnId);
}

/**
 * la relation de réponse, **telle qu'elle s'écrit**.
 *
 * Exportée parce que deux chemins la posent : `reply` ici, et la file d'envoi du shard,
 * qui met en file un contenu déjà formé. Deux littéraux recopiés auraient
 * dérivé, et la lecture d'en face n'aurait plus reconnu que l'un des deux.
 */
export const replyRelation = (inReplyToEventId: string) => ({
  "m.relates_to": { "m.in_reply_to": { event_id: inReplyToEventId } },
});

/**
 * côté **lecture** — l'événement auquel ce contenu répond, s'il y en a un.
 *
 * Sans ce membre, le shard ne pouvait pas dire à quel message une réponse répond : le
 * `body` porte bien une citation en `> `, mais `messageText` la retire et
 * elle ne dit de toute façon ni qui, ni quoi quand le cité est une photo. Signalé par les
 * utilisateurs : « rien ne montre à quel message on fait référence ».
 *
 * Prend un **contenu** et non un événement : une entrée de la file d'envoi n'est pas
 * encore un événement, et l'affichage optimiste doit citer aussi bien qu'un message reçu.
 */
export function replyToOf(content: unknown): string | undefined {
  const relation = (content as { "m.relates_to"?: { "m.in_reply_to"?: { event_id?: unknown } } })
    ?.["m.relates_to"];
  const eventId = relation?.["m.in_reply_to"]?.event_id;
  return typeof eventId === "string" ? eventId : undefined;
}

/** la même lecture, sur un événement de la timeline. */
export const replyTo = (event: MatrixEvent): string | undefined => replyToOf(event.getContent());

/** réponse via la relation `m.in_reply_to`. */
export function reply(
  session: Session,
  roomId: string,
  inReplyToEventId: string,
  text: string,
  opts: SendOptions = {},
): Promise<ISendEventResponse> {
  const content: TextContent = {
    ...textContent(text, opts),
    ...replyRelation(inReplyToEventId),
  };
  return send(session, roomId, EventType.RoomMessage, content, opts.txnId);
}

/**
 * modification via `m.replace`. Le `body` de premier niveau est le
 * fallback affiché par les clients qui n'agrègent pas les éditions ; `m.new_content`
 * porte le texte réel.
 */
export function edit(
  session: Session,
  roomId: string,
  targetEventId: string,
  text: string,
  opts: SendOptions = {},
): Promise<ISendEventResponse> {
  const { body, ...rest } = textContent(text, opts);
  const content: TextContent = {
    ...rest,
    body: `* ${body}`,
    "m.new_content": { msgtype: MsgType.Text, body },
    "m.relates_to": { rel_type: RelationType.Replace, event_id: targetEventId },
  };
  return send(session, roomId, EventType.RoomMessage, content, opts.txnId);
}

/** suppression par redaction. */
export async function redact(
  session: Session,
  roomId: string,
  eventId: string,
  opts: SendOptions = {},
): Promise<ISendEventResponse> {
  await assertEncrypted(session, roomId);
  return session.client.redactEvent(roomId, eventId, opts.txnId);
}

/**
 * les réactions circulent **en clair** en salon chiffré. Ce n'est pas
 * un oubli : l'agrégation des annotations est faite par le serveur, qui doit donc
 * lire la clé. Le serveur voit qui réagit à quoi, et avec quel emoji.
 */
export const REACTIONS_METADATA = {
  cleartext: true,
  reason:
    "m.reaction n'est pas chiffré : le serveur agrège les annotations et doit lire " +
    "la clé. Chiffrer casserait l'agrégation. Le serveur voit qui réagit à quoi.",
} as const;

/** une réaction agrégée : l'emoji, combien, et si j'en fais partie. */
export interface ReactionTally {
  key: string;
  count: number;
  mine: boolean;
}

/**
 * Les annotations vivantes d'un message. Les redactions sont exclues : une réaction
 * retirée reste dans la relation, vidée de son contenu — la compter afficherait un emoji
 * fantôme que personne ne peut retirer.
 */
function annotations(session: Session, roomId: string, eventId: string): MatrixEvent[] {
  return (
    session.client
      .getRoom(roomId)
      ?.relations.getChildEventsForEvent(eventId, RelationType.Annotation, EventType.Reaction)
      ?.getRelations() ?? []
  ).filter((event) => !event.isRedacted());
}

/** La clé d'une annotation, ou `undefined` si l'événement n'en porte pas. */
const cleDe = (event: MatrixEvent): string | undefined => {
  const key = (event.getContent()["m.relates_to"] as { key?: unknown } | undefined)?.key;
  return typeof key === "string" ? key : undefined;
};

/**
 * côté **lecture** — les réactions d'un message, déjà agrégées.
 *
 * L'agrégation est celle du SDK (`relations`), pas une reconstruction : c'est le serveur
 * qui groupe les annotations, et le SDK qui tient le résultat à jour. Sans ce membre, le
 * shard UI pourrait envoyer des réactions sans jamais en afficher — une moitié de
 * fonctionnalité, que l'interdit n°13 proscrit.
 */
export function reactions(session: Session, roomId: string, eventId: string): ReactionTally[] {
  const self = session.client.getUserId();

  const tallies = new Map<string, ReactionTally>();
  /*
   * **Un émetteur ne compte qu'une fois par emoji.** Matrix n'interdit pas d'envoyer deux
   * fois la même annotation, et `react` l'a fait pendant tout le temps où il ne savait
   * qu'ajouter : les salons portent donc des doublons déjà écrits, qu'aucune bascule ne
   * retirera jamais tous. Compter par personne les rend inoffensifs — signalé par les
   * utilisateurs comme « les réactions peuvent être spam ».
   */
  const vus = new Set<string>();
  for (const event of annotations(session, roomId, eventId)) {
    const key = cleDe(event);
    if (key === undefined) continue;
    const empreinte = `${key}\u0000${event.getSender()}`;
    if (vus.has(empreinte)) continue;
    vus.add(empreinte);

    const tally = tallies.get(key) ?? { key, count: 0, mine: false };
    tally.count += 1;
    tally.mine ||= event.getSender() === self;
    tallies.set(key, tally);
  }
  return [...tallies.values()];
}

/**
 * **une réaction est une bascule, pas une pile.** Réagir avec un emoji déjà
 * posé le retire ; c'est ce que rend `mine`, et ce qu'attend le `ToggleButton` de la
 * timeline, qui appelait jusqu'ici un envoi de plus à chaque appui.
 *
 * La bascule vit ici et non dans le shard : deux appelants la demandent (la ligne de
 * réactions et le hold menu), et une garde posée chez l'un aurait laissé l'autre empiler.
 */
export function react(
  session: Session,
  roomId: string,
  eventId: string,
  key: string,
  opts: SendOptions = {},
): Promise<ISendEventResponse> {
  const self = session.client.getUserId();
  const mienne = annotations(session, roomId, eventId).find(
    (event) => event.getSender() === self && cleDe(event) === key,
  );
  const idMien = mienne?.getId();
  if (idMien) return redact(session, roomId, idMien, opts);

  const content = {
    "m.relates_to": { rel_type: RelationType.Annotation, event_id: eventId, key },
  };
  return send(session, roomId, EventType.Reaction, content, opts.txnId);
}

/**
 * l'ordre vient de `OrderedTimeline`. Filtrer n'est pas
 * trier : la séquence rendue est celle de /sync, amputée des événements qui ne
 * sont pas des messages.
 */
export function messages(session: Session, roomId: string): MatrixEvent[] {
  return (
    session
      .timeline(roomId)
      .events()
      .filter((event) => event.getType() === EventType.RoomMessage)
      /*
       * **une modification remplace, elle ne s'ajoute pas.** Un `m.replace`
       * est lui aussi un `m.room.message` : il restait donc dans la liste, à côté de
       * l'original dont le SDK a déjà réécrit le contenu sur place. Résultat mesuré au
       * navigateur : un message modifié s'affichait **deux fois**, avec le
       * même texte. Et supprimer n'en effaçait qu'un — la redaction vise l'original, la
       * bulle du remplacement survivait, message compris.
       *
       * Filtrer n'est pas trier : l'ordre reste celui du flux, on en retire
       * des événements qui ne sont pas des messages à afficher.
       */
      .filter((event) => !event.isRelation(RelationType.Replace))
  );
}

/**
 * texte destiné au presse-papiers (fonction pure ; l'accès au
 * presse-papiers est dans l'UI). Rend le texte édité s'il y en a un, et retire le
 * bloc de citation que Matrix préfixe aux réponses.
 */
export function messageText(event: MatrixEvent): string {
  const content = event.getContent();
  const edited = content["m.new_content"] as { body?: unknown } | undefined;
  const body = typeof edited?.body === "string" ? edited.body : content.body;
  if (typeof body !== "string") return "";
  return body
    .split("\n")
    .filter((line) => !line.startsWith("> "))
    .join("\n")
    .trim();
}

/** modifiable : seul l'auteur édite, et il doit pouvoir poster. */
export function canEdit(session: Session, roomId: string, event: MatrixEvent): boolean {
  const userId = session.client.getUserId();
  const room = session.client.getRoom(roomId);
  if (!userId || !room || event.getSender() !== userId) return false;
  return room.currentState.maySendEvent(EventType.RoomMessage, userId);
}

/** supprimable : droits de redaction du SDK (auteur ou power level). */
export function canRedact(session: Session, roomId: string, event: MatrixEvent): boolean {
  const userId = session.client.getUserId();
  const room = session.client.getRoom(roomId);
  if (!userId || !room) return false;
  return room.currentState.maySendRedactionForEvent(event, userId);
}

/**
 * Signal de changement pour le shard UI, branché sur l'émetteur du SDK :
 * pas de store ni de bus maison par-dessus.
 */
export function subscribe(session: Session, roomId: string, listener: () => void): () => void {
  const handler = (_event: MatrixEvent, room: Room | undefined): void => {
    if (room?.roomId === roomId) listener();
  };

  /*
   * **Le déchiffrement n'est pas un événement de timeline.** Un message entre dans la
   * timeline chiffré, et son texte n'existe qu'au `Decrypted` qui suit — parfois
   * bien plus tard, quand la clé Megolm arrive par to-device. Sans cet écouteur, rien
   * ne redemandait un rendu : le message restait une ligne vide, avec son auteur et son
   * heure, jusqu'à ce qu'un autre événement force la mise à jour.
   *
   * En conversation vive, l'événement suivant masquait le défaut. Au rechargement, non :
   * mesuré au navigateur, une conversation rouverte affichait « 13:57 » et
   * un nom, sans une ligne de texte. Même famille que `ClientEvent.Room` —
   * un événement de moins que ce que la vie réelle exige.
   */
  const surDechiffrement = (event: MatrixEvent): void => {
    if (event.getRoomId() === roomId) listener();
  };

  /*
   * **Une suppression n'est pas non plus un événement de timeline.** Le SDK émet
   * `Room.redaction` et vide l'événement d'origine sur place ; `Room.timeline` ne dit
   * rien. Sans cet écouteur, ne tenait qu'à moitié : l'auteur voyait son
   * message partir, le destinataire continuait de le lire jusqu'au message suivant.
   * Mesuré au navigateur, entre deux sessions réelles.
   */
  const surSuppression = (_event: MatrixEvent, room: Room): void => {
    if (room.roomId === roomId) listener();
  };

  session.client.on(RoomEvent.Timeline, handler);
  session.client.on(MatrixEventEvent.Decrypted, surDechiffrement);
  session.client.on(RoomEvent.Redaction, surSuppression);
  return () => {
    session.client.off(RoomEvent.Timeline, handler);
    session.client.off(MatrixEventEvent.Decrypted, surDechiffrement);
    session.client.off(RoomEvent.Redaction, surSuppression);
  };
}
