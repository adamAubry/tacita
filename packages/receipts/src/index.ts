import { createLogger, type Session } from "@tacita/client-core";
import {
  ClientEvent,
  ReceiptType,
  RoomEvent,
  type MatrixEvent,
  type ReceivedToDeviceMessage,
  type Room,
} from "matrix-js-sdk";

/**
 * le niveau « délivré » n'existe pas dans Matrix : type préfixé maison.
 * extension non standard, voir README.md.
 */
export const DELIVERED_EVENT_TYPE = "org.tacita.delivered";

export type ReceiptStatus = "sending" | "sent" | "delivered" | "read";

/** Le statut ne recule jamais : un `read` déjà connu n'est pas ramené à `delivered`. */
const RANK: Record<ReceiptStatus, number> = { sending: 0, sent: 1, delivered: 2, read: 3 };

/** fenêtre de regroupement des « délivré ». */
const DEBOUNCE_MS = 500;

export interface Receipts {
  /** `undefined` = message non suivi (voir « limites » dans README.md). */
  status(eventId: string): ReceiptStatus | undefined;
  /** Rend le désabonnement. Notifié à chaque changement de statut. */
  subscribe(listener: (eventId: string, status: ReceiptStatus) => void): () => void;
  /**
   * `true` tant qu'un message est à `sent` : de l'expéditeur, « pas
   * encore délivré » et « destinataire en mode masqué » sont indiscernables, et un
   * message vers un utilisateur masqué reste à `sent` indéfiniment. L'UI
   * rend l'ambiguïté explicite au lieu de promettre une progression.
   */
  deliveryUnknowable(eventId: string): boolean;
  /** `m.read`, ou `m.read.private` en mode masqué. */
  markRead(event: MatrixEvent): Promise<void>;
  setHiddenMode(hidden: boolean): void;
  stop(): void;
}

export function createReceipts(session: Session): Receipts {
  const client = session.client;
  const log = createLogger();
  const self = client.getUserId();

  const statuses = new Map<string, ReceiptStatus>();
  const listeners = new Set<(eventId: string, status: ReceiptStatus) => void>();

  /** destinataire → événements reçus depuis le dernier envoi. */
  const pending = new Map<string, Set<string>>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let hidden = false;

  /** `seed` : seuls nos propres messages créent une entrée, un accusé isolé n'en crée pas. */
  function advance(eventId: string, next: ReceiptStatus, seed = false): void {
    const current = statuses.get(eventId);
    // les reçus « délivré » surnuméraires (N appareils par compte)
    // retombent ici et ne changent rien : le premier arrivé fait foi.
    if (current === undefined ? !seed : RANK[next] <= RANK[current]) return;
    statuses.set(eventId, next);
    for (const listener of listeners) listener(eventId, next);
  }

  /**
   * « envoyé » est dérivé de l'`event_id` rendu par le serveur : tant que
   * le SDK porte un statut d'envoi, l'événement n'est qu'un écho local.
   * Un envoi en échec reste `sending` : les reprises sont le domaine de l'outbox.
   */
  const ownStatus = (event: MatrixEvent): ReceiptStatus =>
    event.status === null ? "sent" : "sending";

  function flush(): void {
    timer = undefined;
    // en mode masqué, aucune émission : le lot en attente est abandonné,
    // pas mis en file (le destinataire ne doit rien apprendre a posteriori).
    if (!hidden) {
      for (const [userId, eventIds] of pending) {
        // `sendToDevice` en clair, délibérément : chiffrer un accusé
        // coûterait une session Megolm pour zéro contenu. Fuite de métadonnées assumée.
        // `*` = tous les appareils de l'expéditeur, il n'a pas à deviner lequel écoute.
        const content = new Map([[userId, new Map([["*", { event_ids: [...eventIds] }]])]]);
        client
          .sendToDevice(DELIVERED_EVENT_TYPE, content)
          .catch(() => log.warn("émission d'un accusé « délivré » échouée", { userId }));
      }
    }
    pending.clear();
  }

  /**
   * l'accusé part à l'entrée de l'événement dans le store local, pas à
   * son affichage : rien ici ne dépend du déchiffrement ni du rendu.
   */
  const onTimeline = (
    event: MatrixEvent,
    _room: unknown,
    toStartOfTimeline: boolean | undefined,
    removed: boolean,
    data: { liveEvent?: boolean },
  ): void => {
    const eventId = event.getId();
    const sender = event.getSender();
    if (!eventId || !sender || removed || toStartOfTimeline || !data.liveEvent || event.isState())
      return;

    if (sender === self) {
      advance(eventId, ownStatus(event), true);
      return;
    }

    pending.set(sender, (pending.get(sender) ?? new Set()).add(eventId));
    // un sync de rattrapage insère N messages d'un coup : un seul envoi.
    timer ??= setTimeout(flush, DEBOUNCE_MS);
  };

  /**
   * l'écho local reçoit son identifiant serveur. Le SDK réécrit l'id sur
   * le même `MatrixEvent` : l'UI suit sans que le module ait à tenir de table d'alias.
   */
  const onLocalEcho = (event: MatrixEvent, _room: unknown, oldEventId?: string): void => {
    const eventId = event.getId();
    if (!eventId || event.getSender() !== self) return;
    // L'événement est aussi ré-émis sans changement d'identifiant (simple changement de
    // statut d'envoi) : effacer l'entrée dans ce cas ferait reculer un `delivered` déjà
    // acquis vers `sent`, en contournant la garde de monotonie d'`advance`.
    if (oldEventId && oldEventId !== eventId) statuses.delete(oldEventId);
    advance(eventId, ownStatus(event), true);
  };

  /**
   * Un reçu `m.read` vaut « lu jusqu'ici », pas « ce message-ci est lu » : tout ce qui
   * précède l'événement pointé est lu aussi. Sans ce parcours, un message plus ancien
   * que le dernier reçu resterait affiché `delivered` indéfiniment.
   *
   * L'ordre parcouru est celui du flux `/sync` tel que le SDK l'a accumulé — jamais un
   * tri par `origin_server_ts`.
   */
  function markReadUpTo(room: Room | undefined, eventId: string): void {
    const events = room?.getLiveTimeline().getEvents() ?? [];
    const upTo = events.findIndex((event) => event.getId() === eventId);
    if (upTo === -1) {
      // Reçu portant sur un événement hors de la timeline chargée : rien à remonter.
      advance(eventId, "read");
      return;
    }
    for (const event of events.slice(0, upTo + 1)) {
      const id = event.getId();
      // `advance` ignore les identifiants non suivis : seuls nos propres messages bougent.
      if (id) advance(id, "read");
    }
  }

  /** « lu » vient des reçus `m.read` natifs. */
  const onReceipt = (event: MatrixEvent, room: Room): void => {
    const content = event.getContent() as Record<
      string,
      Record<string, Record<string, unknown> | undefined> | undefined
    >;
    for (const [eventId, byType] of Object.entries(content)) {
      if (!byType) continue;
      const readers = byType[ReceiptType.Read];
      if (readers && Object.keys(readers).some((userId) => userId !== self)) {
        markReadUpTo(room, eventId);
      }
    }
  };

  /** premier appareil atteint : `advance` ignore les suivants. */
  const onToDevice = ({ message }: ReceivedToDeviceMessage): void => {
    if (message.type !== DELIVERED_EVENT_TYPE) return;
    const eventIds = (message.content as { event_ids?: unknown }).event_ids;
    if (!Array.isArray(eventIds)) return;
    for (const eventId of eventIds) {
      if (typeof eventId === "string") advance(eventId, "delivered");
    }
  };

  client.on(RoomEvent.Timeline, onTimeline);
  client.on(RoomEvent.LocalEchoUpdated, onLocalEcho);
  client.on(RoomEvent.Receipt, onReceipt);
  client.on(ClientEvent.ReceivedToDeviceMessage, onToDevice);

  return {
    status: (eventId) => statuses.get(eventId),

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    deliveryUnknowable: (eventId) => statuses.get(eventId) === "sent",

    async markRead(event) {
      // pas de désactivation pure : le reçu privé continue de synchroniser
      // les compteurs de non-lus entre les appareils du compte.
      await client.sendReceipt(event, hidden ? ReceiptType.ReadPrivate : ReceiptType.Read);
    },

    setHiddenMode(next) {
      hidden = next;
    },

    stop() {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
      pending.clear();
      listeners.clear();
      client.off(RoomEvent.Timeline, onTimeline);
      client.off(RoomEvent.LocalEchoUpdated, onLocalEcho);
      client.off(RoomEvent.Receipt, onReceipt);
      client.off(ClientEvent.ReceivedToDeviceMessage, onToDevice);
    },
  };
}
