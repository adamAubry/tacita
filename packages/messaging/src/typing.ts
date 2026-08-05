import type { Session } from "@tacita/client-core";
import { RoomMemberEvent } from "matrix-js-sdk";

/**
 * REQ-MSG-09 — `m.typing` est une EDU éphémère : rien n'est écrit en base côté
 * serveur. Le coût est en requêtes, d'où le throttling ici : une frappe n'émet pas
 * une requête.
 *
 * Le timeout serveur est plus long que la fenêtre de throttle, sinon l'indicateur
 * s'éteindrait entre deux émissions. L'arrêt automatique après inactivité évite
 * l'indicateur fantôme quand l'utilisateur abandonne sa phrase.
 */
export const THROTTLE_MS = 5_000;
export const SERVER_TIMEOUT_MS = 12_000;
export const IDLE_STOP_MS = 4_000;

export interface TypingIndicator {
  /** À appeler à chaque frappe. Au plus une émission par fenêtre de throttle. */
  keystroke(roomId: string): void;
  /** Arrêt explicite (message envoyé, champ vidé, salon quitté). */
  stop(roomId: string): void;
  /** Annule les arrêts différés en attente. */
  dispose(): void;
}

interface RoomTyping {
  lastSentAt: number;
  idleTimer: ReturnType<typeof setTimeout>;
}

/**
 * REQ-MSG-09, côté **lecture** — qui écrit en ce moment dans ce salon, soi-même exclu.
 *
 * L'état vit sur les membres du salon, alimenté par l'EDU `m.typing` : rien n'est
 * accumulé ici, et il n'y a donc rien à nettoyer quand le serveur cesse d'émettre. Le
 * shard UI (spec 11) rend la liste, il ne la dérive pas.
 */
export function typingUsers(session: Session, roomId: string): string[] {
  const self = session.client.getUserId();
  return (session.client.getRoom(roomId)?.getMembers() ?? [])
    .filter((member) => member.typing && member.userId !== self)
    .map((member) => member.userId);
}

/** REQ-MSG-09 — signal de changement, branché sur l'émetteur du SDK. */
export function subscribeTyping(
  session: Session,
  roomId: string,
  listener: () => void,
): () => void {
  const handler = (_event: unknown, member: { roomId: string }): void => {
    if (member.roomId === roomId) listener();
  };
  session.client.on(RoomMemberEvent.Typing, handler);
  return () => {
    session.client.off(RoomMemberEvent.Typing, handler);
  };
}

export function createTypingIndicator(session: Session): TypingIndicator {
  const rooms = new Map<string, RoomTyping>();

  const emitStop = (roomId: string): void => {
    const state = rooms.get(roomId);
    if (!state) return;
    clearTimeout(state.idleTimer);
    rooms.delete(roomId);
    void session.client.sendTyping(roomId, false, 0);
  };

  return {
    keystroke(roomId) {
      const previous = rooms.get(roomId);
      const now = Date.now();
      const due = !previous || now - previous.lastSentAt >= THROTTLE_MS;

      if (due) void session.client.sendTyping(roomId, true, SERVER_TIMEOUT_MS);
      if (previous) clearTimeout(previous.idleTimer);

      rooms.set(roomId, {
        lastSentAt: due ? now : previous.lastSentAt,
        idleTimer: setTimeout(() => emitStop(roomId), IDLE_STOP_MS),
      });
    },

    stop: emitStop,

    dispose() {
      for (const state of rooms.values()) clearTimeout(state.idleTimer);
      rooms.clear();
    },
  };
}
