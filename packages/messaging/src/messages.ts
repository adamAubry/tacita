import type { Session } from "@tacita/client-core";
import {
  EventType,
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
   * REQ-MSG-03 — identifiant de transaction. La déduplication est celle du SDK et
   * du serveur : rejouer la même requête avec le même `txnId` rend le même
   * `event_id`. Omis, c'est `MatrixClient.makeTxnId` qui en fabrique un — ce
   * package n'en génère jamais et n'empile aucun cache par-dessus.
   */
  txnId?: string;
  /** Candidats d'autocomplétion pour résoudre les `@pseudo` du texte (REQ-MSG-10). */
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

/** REQ-MSG-01 — message texte chiffré (`m.room.message` en salon chiffré). */
export function sendText(
  session: Session,
  roomId: string,
  text: string,
  opts: SendOptions = {},
): Promise<ISendEventResponse> {
  return send(session, roomId, EventType.RoomMessage, textContent(text, opts), opts.txnId);
}

/** REQ-MSG-04 — réponse via la relation `m.in_reply_to`. */
export function reply(
  session: Session,
  roomId: string,
  inReplyToEventId: string,
  text: string,
  opts: SendOptions = {},
): Promise<ISendEventResponse> {
  const content: TextContent = {
    ...textContent(text, opts),
    "m.relates_to": { "m.in_reply_to": { event_id: inReplyToEventId } },
  };
  return send(session, roomId, EventType.RoomMessage, content, opts.txnId);
}

/**
 * REQ-MSG-06 — modification via `m.replace`. Le `body` de premier niveau est le
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

/** REQ-MSG-06 — suppression par redaction. */
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
 * REQ-MSG-05 — les réactions circulent **en clair** en salon chiffré. Ce n'est pas
 * un oubli : l'agrégation des annotations est faite par le serveur, qui doit donc
 * lire la clé. Le serveur voit qui réagit à quoi, et avec quel emoji.
 */
export const REACTIONS_METADATA = {
  cleartext: true,
  reason:
    "m.reaction n'est pas chiffré : le serveur agrège les annotations et doit lire " +
    "la clé. Chiffrer casserait l'agrégation. Le serveur voit qui réagit à quoi.",
} as const;

/** REQ-MSG-05 — une réaction agrégée : l'emoji, combien, et si j'en fais partie. */
export interface ReactionTally {
  key: string;
  count: number;
  mine: boolean;
}

/**
 * REQ-MSG-05, côté **lecture** — les réactions d'un message, déjà agrégées.
 *
 * L'agrégation est celle du SDK (`relations`), pas une reconstruction : c'est le serveur
 * qui groupe les annotations, et le SDK qui tient le résultat à jour. Sans ce membre, le
 * shard UI pourrait envoyer des réactions sans jamais en afficher — une moitié de
 * fonctionnalité, que l'interdit n°13 proscrit.
 *
 * Les redactions sont exclues : une réaction retirée reste dans la relation, vidée de son
 * contenu. La compter afficherait un emoji fantôme que personne ne peut retirer.
 */
export function reactions(session: Session, roomId: string, eventId: string): ReactionTally[] {
  const self = session.client.getUserId();
  const related =
    session.client
      .getRoom(roomId)
      ?.relations.getChildEventsForEvent(eventId, RelationType.Annotation, EventType.Reaction)
      ?.getRelations() ?? [];

  const tallies = new Map<string, ReactionTally>();
  for (const event of related) {
    if (event.isRedacted()) continue;
    const key = (event.getContent()["m.relates_to"] as { key?: unknown } | undefined)?.key;
    if (typeof key !== "string") continue;

    const tally = tallies.get(key) ?? { key, count: 0, mine: false };
    tally.count += 1;
    tally.mine ||= event.getSender() === self;
    tallies.set(key, tally);
  }
  return [...tallies.values()];
}

export function react(
  session: Session,
  roomId: string,
  eventId: string,
  key: string,
  opts: SendOptions = {},
): Promise<ISendEventResponse> {
  const content = {
    "m.relates_to": { rel_type: RelationType.Annotation, event_id: eventId, key },
  };
  return send(session, roomId, EventType.Reaction, content, opts.txnId);
}

/**
 * REQ-MSG-12 — l'ordre vient de `OrderedTimeline` (spec 04). Filtrer n'est pas
 * trier : la séquence rendue est celle de /sync, amputée des événements qui ne
 * sont pas des messages.
 */
export function messages(session: Session, roomId: string): MatrixEvent[] {
  return session
    .timeline(roomId)
    .events()
    .filter((event) => event.getType() === EventType.RoomMessage);
}

/**
 * REQ-MSG-07 — texte destiné au presse-papiers (fonction pure ; l'accès au
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

/** REQ-MSG-06 — modifiable : seul l'auteur édite, et il doit pouvoir poster. */
export function canEdit(session: Session, roomId: string, event: MatrixEvent): boolean {
  const userId = session.client.getUserId();
  const room = session.client.getRoom(roomId);
  if (!userId || !room || event.getSender() !== userId) return false;
  return room.currentState.maySendEvent(EventType.RoomMessage, userId);
}

/** REQ-MSG-06 — supprimable : droits de redaction du SDK (auteur ou power level). */
export function canRedact(session: Session, roomId: string, event: MatrixEvent): boolean {
  const userId = session.client.getUserId();
  const room = session.client.getRoom(roomId);
  if (!userId || !room) return false;
  return room.currentState.maySendRedactionForEvent(event, userId);
}

/**
 * Signal de changement pour le shard UI (spec 11), branché sur l'émetteur du SDK :
 * pas de store ni de bus maison par-dessus.
 */
export function subscribe(session: Session, roomId: string, listener: () => void): () => void {
  const handler = (_event: MatrixEvent, room: Room | undefined): void => {
    if (room?.roomId === roomId) listener();
  };
  session.client.on(RoomEvent.Timeline, handler);
  return () => {
    session.client.off(RoomEvent.Timeline, handler);
  };
}
