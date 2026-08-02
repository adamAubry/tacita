import type { Session } from "@tacita/client-core";

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
      const state = rooms.get(roomId);
      const now = Date.now();

      if (!state || now - state.lastSentAt >= THROTTLE_MS) {
        void session.client.sendTyping(roomId, true, SERVER_TIMEOUT_MS);
      }

      if (state) clearTimeout(state.idleTimer);
      rooms.set(roomId, {
        lastSentAt: state && now - state.lastSentAt < THROTTLE_MS ? state.lastSentAt : now,
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
