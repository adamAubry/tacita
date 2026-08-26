import type { Session } from "@tacita/client-core";
import { Direction, RoomStateEvent, type MatrixEvent } from "matrix-js-sdk";

import { CALL_MEMBER_EVENT_TYPE, isLiveMembership } from "./matrixrtc";

/**
 * **Un appel qui commence doit se voir depuis n'importe quel écran.** `activeCall` répond
 * à « ce salon-ci a-t-il un appel ? », et il faut avoir ce salon ouvert pour le demander :
 * quelqu'un qui appelle pendant qu'on lit la liste des conversations ne produisait donc
 * rien du tout. C'est la panne la plus grave possible pour un appel — il n'arrive pas.
 *
 * Ce module observe les appartenances MatrixRTC de **tous** les salons connus, et ne
 * garde que celles où un appel est vivant sans nous.
 */

/**
 * Au-delà, un appel ne sonne plus : il reste rejoignable, en silence.
 *
 * Sans cette fenêtre, ouvrir l'application pendant qu'une conversation de groupe appelle
 * depuis quarante minutes déclencherait une sonnerie plein écran pour un appel que
 * personne n'attend de nous. La sonnerie dit « décroche maintenant » ; un appel commencé
 * il y a longtemps ne dit pas ça, et le bandeau du salon le porte déjà.
 */
export const RINGING_WINDOW_MS = 45_000;

export interface IncomingCall {
  roomId: string;
  /** Qui a ouvert l'appel — l'auteur de la plus ancienne appartenance vivante. */
  from: string;
  /** Horodatage de cette appartenance. */
  since: number;
  /** Vrai tant que `since` tient dans la fenêtre de sonnerie. */
  ringing: boolean;
}

export interface IncomingCalls {
  current(): IncomingCall[];
  subscribe(listener: (calls: IncomingCall[]) => void): () => void;
  stop(): void;
}

/** Les appartenances vivantes d'un salon, telles que l'état courant les porte. */
function liveMemberships(session: Session, roomId: string): MatrixEvent[] {
  const room = session.client.getRoom(roomId);
  const events =
    room?.getLiveTimeline().getState(Direction.Forward)?.getStateEvents(CALL_MEMBER_EVENT_TYPE) ??
    [];
  return events.filter((event) => isLiveMembership(event.getContent(), event.getTs()));
}

/**
 * L'appel entrant d'un salon, s'il y en a un.
 *
 * **L'appartenance se rattache à son émetteur, pas à sa state key.** La clé porte bien
 * l'identifiant, mais collé à celui de l'appareil par des `_` — or un localpart Matrix
 * peut en contenir, et la découper reviendrait à deviner. `getSender()` est la même
 * information, donnée par le serveur, et un utilisateur ne peut poser que sa propre clé.
 */
function callOf(session: Session, roomId: string, maintenant: number): IncomingCall | undefined {
  const moi = session.client.getUserId();
  if (!moi) return undefined;

  const vivantes = liveMemberships(session, roomId);
  // Rejoint sur un autre appareil compte comme rejoint : faire sonner le téléphone de
  // quelqu'un qui est déjà dans l'appel depuis son ordinateur n'a pas de sens.
  if (vivantes.some((event) => event.getSender() === moi)) return undefined;

  const autres = vivantes.filter((event) => event.getSender() !== undefined);
  if (autres.length === 0) return undefined;

  const premiere = autres.reduce((plus, event) => (event.getTs() < plus.getTs() ? event : plus));
  const since = premiere.getTs();
  return {
    roomId,
    from: premiere.getSender() ?? "",
    since,
    ringing: maintenant - since < RINGING_WINDOW_MS,
  };
}

/**
 * Les appels en cours auxquels nous ne participons pas, tous salons confondus.
 *
 * `maintenant` est injecté pour que la fenêtre de sonnerie s'éprouve sans faire attendre
 * un test quarante-cinq secondes.
 */
export function incomingCalls(session: Session, maintenant = Date.now): IncomingCalls {
  const client = session.client;
  const listeners = new Set<(calls: IncomingCall[]) => void>();
  let calls: IncomingCall[] = [];
  let extinction: ReturnType<typeof setTimeout> | undefined;

  function read(): IncomingCall[] {
    const now = maintenant();
    return client
      .getRooms()
      .map((room) => callOf(session, room.roomId, now))
      .filter((appel): appel is IncomingCall => appel !== undefined);
  }

  /**
   * Le passage de « sonne » à « ne sonne plus » n'est déclenché par aucun événement : il
   * arrive tout seul, à l'heure. Sans ce minuteur la sonnerie durerait jusqu'à la
   * prochaine appartenance publiée, c'est-à-dire potentiellement jusqu'à la fin de
   * l'appel.
   */
  function programmerExtinction(): void {
    if (extinction !== undefined) clearTimeout(extinction);
    extinction = undefined;
    const now = maintenant();
    const restants = calls
      .filter((appel) => appel.ringing)
      .map((appel) => appel.since + RINGING_WINDOW_MS - now);
    if (restants.length === 0) return;
    extinction = setTimeout(() => publier(), Math.max(0, Math.min(...restants)));
  }

  function publier(): void {
    calls = read();
    programmerExtinction();
    for (const listener of listeners) listener(calls);
  }

  const surEtat = (event: MatrixEvent): void => {
    if (event.getType() !== CALL_MEMBER_EVENT_TYPE) return;
    publier();
  };

  calls = read();
  programmerExtinction();
  client.on(RoomStateEvent.Events, surEtat);

  return {
    current: () => calls,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    stop() {
      listeners.clear();
      if (extinction !== undefined) clearTimeout(extinction);
      client.off(RoomStateEvent.Events, surEtat);
    },
  };
}
