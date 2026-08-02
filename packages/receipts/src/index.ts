import { createLogger, type Session } from "@tacita/client-core";
import {
  ClientEvent,
  ReceiptType,
  RoomEvent,
  type MatrixEvent,
  type ReceivedToDeviceMessage,
} from "matrix-js-sdk";

/**
 * REQ-RCP-03 — le niveau « délivré » n'existe pas dans Matrix : type préfixé maison.
 * REQ-RCP-06 — extension non standard, voir README.md.
 */
export const DELIVERED_EVENT_TYPE = "org.tacita.delivered";

export type ReceiptStatus = "sending" | "sent" | "delivered" | "read";

/** Le statut ne recule jamais : un `read` déjà connu n'est pas ramené à `delivered`. */
const RANK: Record<ReceiptStatus, number> = { sending: 0, sent: 1, delivered: 2, read: 3 };

export interface Receipts {
  /** `undefined` = message non suivi (voir « limites » dans README.md). */
  status(eventId: string): ReceiptStatus | undefined;
  /** Rend le désabonnement. Notifié à chaque changement de statut. */
  subscribe(listener: (eventId: string, status: ReceiptStatus) => void): () => void;
  /**
   * REQ-RCP-08 — `true` tant qu'un message est à `sent` : de l'expéditeur, « pas
   * encore délivré » et « destinataire en mode masqué » sont indiscernables, et un
   * message vers un utilisateur masqué reste à `sent` indéfiniment. L'UI (spec 11)
   * rend l'ambiguïté explicite au lieu de promettre une progression.
   */
  deliveryUnknowable(eventId: string): boolean;
  /** REQ-RCP-07 — `m.read`, ou `m.read.private` en mode masqué. */
  markRead(event: MatrixEvent): Promise<void>;
  setHiddenMode(hidden: boolean): void;
  stop(): void;
}

export interface ReceiptsOptions {
  /** REQ-RCP-09 — fenêtre de regroupement des « délivré ». */
  debounceMs?: number;
}

export function createReceipts(session: Session, options: ReceiptsOptions = {}): Receipts {
  const { debounceMs = 500 } = options;
  const client = session.client;
  const log = createLogger();
  const self = client.getUserId();

  const statuses = new Map<string, ReceiptStatus>();
  /** Écho local → identifiant serveur, pour que l'UI puisse interroger l'ancien id. */
  const aliases = new Map<string, string>();
  const listeners = new Set<(eventId: string, status: ReceiptStatus) => void>();

  /** REQ-RCP-09 — destinataire → événements reçus depuis le dernier envoi. */
  const pending = new Map<string, Set<string>>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let hidden = false;

  const resolve = (eventId: string): string => aliases.get(eventId) ?? eventId;

  function advance(eventId: string, next: ReceiptStatus, seed = false): void {
    const id = resolve(eventId);
    const current = statuses.get(id);
    // REQ-RCP-04 — les reçus « délivré » surnuméraires (N appareils par compte)
    // retombent ici et ne changent rien : le premier arrivé fait foi.
    if (current === undefined ? !seed : RANK[next] <= RANK[current]) return;
    statuses.set(id, next);
    for (const listener of listeners) listener(id, next);
    if (id !== eventId) for (const listener of listeners) listener(eventId, next);
  }

  /**
   * REQ-RCP-01 — « envoyé » est dérivé de l'`event_id` rendu par le serveur : tant que
   * le SDK porte un statut d'envoi, l'événement n'est qu'un écho local.
   * Un envoi en échec reste `sending` : les reprises sont le domaine de l'outbox (spec 07).
   */
  const ownStatus = (event: MatrixEvent): ReceiptStatus =>
    event.status === null ? "sent" : "sending";

  function flush(): void {
    timer = undefined;
    // REQ-RCP-08 — en mode masqué, aucune émission : le lot en attente est abandonné,
    // pas mis en file (le destinataire ne doit rien apprendre a posteriori).
    if (!hidden) {
      for (const [userId, eventIds] of pending) {
        // REQ-RCP-05 — `sendToDevice` en clair, délibérément : chiffrer un accusé
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
   * REQ-RCP-03 — l'accusé part à l'entrée de l'événement dans le store local, pas à
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
    if (!eventId || removed || toStartOfTimeline || !data.liveEvent || event.isState()) return;

    if (event.getSender() === self) {
      advance(eventId, ownStatus(event), true);
      return;
    }

    const sender = event.getSender();
    if (!sender) return;
    let batch = pending.get(sender);
    if (!batch) pending.set(sender, (batch = new Set()));
    batch.add(eventId);
    // REQ-RCP-09 — un sync de rattrapage insère N messages d'un coup : un seul envoi.
    timer ??= setTimeout(flush, debounceMs);
  };

  /** REQ-RCP-01 — l'écho local reçoit son identifiant serveur. */
  const onLocalEcho = (event: MatrixEvent, _room: unknown, oldEventId?: string): void => {
    const eventId = event.getId();
    if (!eventId || event.getSender() !== self) return;
    if (oldEventId && oldEventId !== eventId) {
      aliases.set(oldEventId, eventId);
      statuses.set(eventId, statuses.get(oldEventId) ?? "sending");
      statuses.delete(oldEventId);
      // Notifie sous les deux identifiants : l'UI n'a encore que celui de l'écho.
      advance(oldEventId, ownStatus(event), true);
      return;
    }
    advance(eventId, ownStatus(event), true);
  };

  /** REQ-RCP-02 — « lu » vient des reçus `m.read` natifs. */
  const onReceipt = (event: MatrixEvent): void => {
    const content = event.getContent() as Record<
      string,
      Record<string, Record<string, unknown> | undefined> | undefined
    >;
    for (const [eventId, byType] of Object.entries(content)) {
      if (!byType) continue;
      const readers = byType[ReceiptType.Read];
      if (readers && Object.keys(readers).some((userId) => userId !== self)) {
        advance(eventId, "read");
      }
    }
  };

  /** REQ-RCP-04 — premier appareil atteint : `advance` ignore les suivants. */
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
    status: (eventId) => statuses.get(resolve(eventId)),

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    deliveryUnknowable: (eventId) => statuses.get(resolve(eventId)) === "sent",

    markRead(event) {
      // REQ-RCP-07 — pas de désactivation pure : le reçu privé continue de synchroniser
      // les compteurs de non-lus entre les appareils du compte.
      return client
        .sendReceipt(event, hidden ? ReceiptType.ReadPrivate : ReceiptType.Read)
        .then(() => {});
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
