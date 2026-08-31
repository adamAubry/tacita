import type { Session } from "@tacita/client-core";
import { Direction, RoomStateEvent, type MatrixEvent } from "matrix-js-sdk";
import { ClientWidgetApi, MatrixWidgetType, Widget } from "matrix-widget-api";

import { CallWidgetDriver } from "./driver";
import {
  CALL_MEMBER_EVENT_TYPE,
  callMemberStateKey,
  isLivekitFocus,
  isLiveMembership,
  RTC_FOCI_WELL_KNOWN_KEY,
  type LivekitFocus,
} from "./matrixrtc";

export { CallWidgetDriver };
export {
  CALL_MEMBER_EVENT_TYPE,
  callMemberStateKey,
  LIVEKIT_FOCUS_TYPE,
  RTC_FOCI_WELL_KNOWN_KEY,
} from "./matrixrtc";
export type { LivekitFocus } from "./matrixrtc";

/**
 * REQ-CAL-02 — erreur typée, pas de bouton inerte : sans focus, l'UI doit pouvoir dire
 * *pourquoi* l'appel est impossible. `reason` distingue les trois pannes réelles, qui
 * n'appellent pas la même action côté exploitant.
 */
export class RtcFociMissingError extends Error {
  constructor(
    readonly reason: "well-known-unreachable" | "well-known-absent" | "no-livekit-focus",
  ) {
    super(`aucun focus MatrixRTC utilisable : ${reason}`);
    this.name = "RtcFociMissingError";
  }
}

export type CallStatus = "idle" | "active" | "ended";

export interface CallState {
  status: CallStatus;
  /** Identifiants des participants dont l'appartenance est vivante. */
  participants: string[];
}

export interface ActiveCall {
  current(): CallState;
  subscribe(listener: (state: CallState) => void): () => void;
  stop(): void;
}

export interface CallWidget {
  url: string;
  params: Record<string, string>;
}

export interface CallWidgetOptions {
  /** Base du déploiement Element Call, ex. `https://call.tacita.chat`. */
  elementCallUrl: string;
  /** Origine du shard UI, que le widget rappelle en postMessage. */
  parentUrl: string;
  /** Identifiant du widget côté client, repris tel quel par le driver. */
  widgetId: string;
  /**
   * Le point d'entrée : « appel audio » ou « appel vidéo » (REQ-UIX-38). C'est le seul
   * paramètre de lancement que l'UI choisit — ce qu'Element Call en fait à l'intérieur
   * de l'appel lui appartient (E-07).
   */
  media?: "audio" | "video";
  /** Rejoindre un appel déjà en cours (bandeau REQ-CAL-03) plutôt qu'en démarrer un. */
  join?: boolean;
}

/**
 * REQ-CAL-02 — découverte des foci via `.well-known/matrix/client` (servi par le proxy
 * avec CORS, spec 02 REQ-RTC-05). Toute panne remonte typée.
 */
export async function discoverFocus(homeserverUrl: string): Promise<LivekitFocus> {
  let wellKnown: Record<string, unknown>;
  try {
    const response = await fetch(new URL("/.well-known/matrix/client", homeserverUrl));
    if (!response.ok) throw new Error(String(response.status));
    wellKnown = (await response.json()) as Record<string, unknown>;
  } catch {
    // Réseau, CORS, JSON illisible : du point de vue de l'UI c'est le même geste.
    throw new RtcFociMissingError("well-known-unreachable");
  }

  const foci = wellKnown[RTC_FOCI_WELL_KNOWN_KEY];
  if (!Array.isArray(foci) || foci.length === 0) {
    throw new RtcFociMissingError("well-known-absent");
  }

  const focus = foci.find(isLivekitFocus);
  if (!focus) throw new RtcFociMissingError("no-livekit-focus");
  return focus;
}

/**
 * REQ-CAL-01 — URL du widget Element Call, prête pour une iframe montée par le shard UI
 * (spec 11). Les paramètres vivent dans le fragment : ils ne partent jamais au serveur
 * qui héberge Element Call.
 *
 * Aucun credential LiveKit n'apparaît ici. L'autorisation SFU se fait plus tard, par
 * l'échange jeton OpenID → `lk-jwt-service` que porte le driver (REQ-CAL-05).
 *
 * **`preload` a été retiré en câblant M-I** : il fait attendre le widget jusqu'à l'action
 * `io.element.join`, que personne ne lui envoie ici — le shard monte l'iframe au moment
 * de l'appel, pas en avance. Le garder donnait un écran d'appel qui ne démarre jamais.
 */
export function buildCallWidget(
  session: Session,
  roomId: string,
  options: CallWidgetOptions,
): CallWidget {
  const userId = session.client.getUserId();
  const deviceId = session.client.getDeviceId();
  if (!userId || !deviceId) throw new Error("session sans identité : widget non constructible");

  const params: Record<string, string> = {
    roomId,
    userId,
    deviceId,
    baseUrl: session.client.baseUrl,
    widgetId: options.widgetId,
    parentUrl: options.parentUrl,
    // Mode widget : Element Call se pilote par l'API widget, pas par sa propre navigation.
    embed: "true",
    hideHeader: "true",
    // Le média reste chiffré par participant : le SFU relaie sans déchiffrer.
    perParticipantE2EE: "true",
    // REQ-UIX-38 — audio ou vidéo, démarrage ou reprise : les quatre valeurs de `intent`
    // qu'Element Call accepte (`UrlParams.ts`, relu le 2026-08-06). `skipLobby` est
    // déprécié en sa faveur ; le reste du comportement est interne au widget (E-07).
    intent: `${options.join ? "join_existing" : "start_call"}${options.media === "audio" ? "_voice" : ""}`,
  };

  return {
    params,
    url: `${options.elementCallUrl.replace(/\/$/, "")}/room#?${new URLSearchParams(params).toString()}`,
  };
}

/**
 * REQ-CAL-05 — branche l'iframe montée par le shard (spec 11) sur le driver. Sans ce
 * raccordement, Element Call en mode widget attend un client qui ne répond pas : il
 * reçoit l'identité par l'URL, mais tout le reste — état du salon, jeton OpenID, clés de
 * média — passe par l'API widget.
 *
 * L'iframe vient de l'appelant : le paquet ne rend rien, il ne fait que parler à ce qui
 * est déjà à l'écran. `ClientWidgetApi` a besoin de l'élément lui-même pour écouter son
 * chargement et cibler ses `postMessage`.
 *
 * `waitForIframeLoad` reste au défaut (`true`) : Element Call envoie aussi
 * `content_loaded`, qui reçoit alors une réponse d'erreur sans conséquence. L'inverse —
 * attendre une action que le widget n'enverrait pas — laisserait l'appel muet.
 */
export function attachCallWidget(
  iframe: HTMLIFrameElement,
  session: Session,
  roomId: string,
  widget: CallWidget,
): () => void {
  // L'API widget filtre les messages entrants sur cet identifiant : le prendre ailleurs
  // que dans l'URL montée donnerait un widget qui parle sans être entendu.
  const widgetId = widget.params.widgetId;
  if (!widgetId) throw new Error("widget sans identifiant : construit hors de buildCallWidget");

  const api = new ClientWidgetApi(
    new Widget({
      id: widgetId,
      creatorUserId: session.client.getUserId() ?? "",
      type: MatrixWidgetType.Custom,
      url: widget.url,
    }),
    iframe,
    new CallWidgetDriver(session, roomId),
  );

  return () => api.stop();
}

/**
 * REQ-CAL-03 — état d'appel d'un salon, dérivé des seuls événements d'état MatrixRTC.
 * YAGNI assumé : ni sonnerie, ni refus, ni appel manqué — l'état d'appartenance dit déjà
 * qui est là et depuis quand.
 */
export function activeCall(session: Session, roomId: string): ActiveCall {
  const client = session.client;
  const listeners = new Set<(state: CallState) => void>();
  function read(previous: CallStatus): CallState {
    const room = client.getRoom(roomId);
    const events =
      room?.getLiveTimeline().getState(Direction.Forward)?.getStateEvents(CALL_MEMBER_EVENT_TYPE) ??
      [];
    const participants = events
      .filter((event) => isLiveMembership(event.getContent(), event.getTs()))
      .map((event) => event.getStateKey() ?? "")
      .filter(Boolean);
    // `ended` n'existe que par contraste : un salon qui n'a jamais eu d'appel est `idle`.
    const status: CallStatus =
      participants.length > 0 ? "active" : previous === "active" ? "ended" : "idle";
    return { status, participants };
  }

  let state = read("idle");

  const onStateEvent = (event: MatrixEvent): void => {
    if (event.getType() !== CALL_MEMBER_EVENT_TYPE || event.getRoomId() !== roomId) return;
    state = read(state.status);
    for (const listener of listeners) listener(state);
  };

  client.on(RoomStateEvent.Events, onStateEvent);

  return {
    current: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    stop() {
      listeners.clear();
      client.off(RoomStateEvent.Events, onStateEvent);
    },
  };
}

/**
 * Retire notre propre appartenance. Le widget le fait déjà quand il se ferme proprement ;
 * ceci couvre le cas où le shard UI démonte l'iframe sans laisser le temps au widget.
 */
export async function hangupLocal(session: Session, roomId: string): Promise<void> {
  const userId = session.client.getUserId();
  const deviceId = session.client.getDeviceId();
  if (!userId || !deviceId) return;

  await session.client.sendStateEvent(
    roomId,
    CALL_MEMBER_EVENT_TYPE as never,
    {} as never,
    callMemberStateKey(userId, deviceId),
  );
}
