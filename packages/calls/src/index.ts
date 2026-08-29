import type { Session } from "@tacita/client-core";
import { Direction, RoomStateEvent, type MatrixEvent } from "matrix-js-sdk";
import { ClientWidgetApi, Widget } from "matrix-widget-api";

import { CallWidgetDriver } from "./driver";
import {
  CALL_APPLICATION,
  CALL_MEMBER_EVENT_TYPE,
  callMemberStateKey,
  isLivekitFocus,
  isLiveMembership,
  RTC_FOCI_WELL_KNOWN_KEY,
  type LivekitFocus,
} from "./matrixrtc";

export { CallWidgetDriver } from "./driver";
export { callHistory } from "./history";
export type { CallLogEntry } from "./history";
export { incomingCalls, RINGING_WINDOW_MS } from "./incoming";
export type { IncomingCall, IncomingCalls } from "./incoming";
export {
  CALL_MEMBER_EVENT_TYPE,
  callMemberStateKey,
  LIVEKIT_FOCUS_TYPE,
  RTC_FOCI_WELL_KNOWN_KEY,
} from "./matrixrtc";
export type { LivekitFocus } from "./matrixrtc";

/**
 * erreur typée, pas de bouton inerte : sans focus, l'UI doit pouvoir dire
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
  /**
   * Les **personnes** dont l'appartenance est vivante, dédoublonnées.
   *
   * Des identifiants d'utilisateur, et non les state keys : celles-ci portent l'appareil,
   * si bien qu'une seule personne connectée depuis son téléphone et son ordinateur
   * comptait double — « 2 personnes y participent » pour une. Et une state key ne se
   * montre pas : c'est un identifiant collé à un identifiant d'appareil.
   */
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
   * Point d'entrée : `true` pour « appel vidéo », `false` pour « appel audio »
   * C'est un **paramètre de lancement**, pas un réglage : la bascule
   * voix↔vidéo pendant l'appel appartient à Element Call (E-07).
   *
   * Traduit en `intent`, relu dans `src/UrlParams.ts` de la **v0.23.0** — la version
   * qu'épingle `infra/rtc/`. E-14 close : la version précédente de ce
   * fichier envoyait `video=true|false`, un paramètre qu'Element Call **ne lit nulle
   * part**. Il ne cassait rien et ne faisait rien.
   */
  video?: boolean;
}

/**
 * les intentions de lancement d'Element Call, relues dans l'enum
 * `UserIntent` de la v0.23.0. Elles ne se recopient pas de mémoire : `infra/rtc/README.md`
 * dit où les relire au prochain bump d'image.
 *
 * `start_call` et `start_call_voice` posent tous deux `skipLobby: false` : le lobby
 * reste, et avec lui le rattrapage si l'intention envoyée n'est pas celle qu'on voulait.
 *
 * Les variantes `_dm` ne sont toujours pas utilisées, et pour une raison qui a changé :
 * la sonnerie qu'elles activent vit **dans le widget**, donc seulement une fois l'écran
 * d'appel ouvert — c'est-à-dire précisément là où on n'a pas besoin d'être prévenu.
 * `incomingCalls` fait sonner depuis n'importe quel écran, ce qu'aucune intention
 * d'Element Call ne peut faire de l'intérieur d'une iframe qui n'est pas montée.
 */
const INTENT_AUDIO = "start_call_voice";
const INTENT_VIDEO = "start_call";

/**
 * découverte des foci via `.well-known/matrix/client` (servi par le proxy
 * avec CORS). Toute panne remonte typée.
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
 * URL du widget Element Call, prête pour une iframe montée par le shard UI
 * Les paramètres vivent dans le fragment : ils ne partent jamais au serveur
 * qui héberge Element Call.
 *
 * Aucun credential LiveKit n'apparaît ici. L'autorisation SFU se fait plus tard, par
 * l'échange jeton OpenID → `lk-jwt-service` que porte le driver.
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
    // `widgetId` + `parentUrl` sont ce qui le fait basculer en mode widget (`isWidget`
    // dans `UrlParams.ts`), et c'est cette bascule qui rend `intent` lisible pour lui.
    embed: "true",
    // `header=none` et non `hideHeader` : ce dernier a disparu de `UrlConfiguration` en
    // v0.23.0 — le commentaire d'amont le dit rétrocompatible, le code ne le lit plus.
    header: "none",
    // Le média reste chiffré par participant : le SFU relaie sans déchiffrer. Explicite
    // et pas hérité du preset d'`intent` : c'est la garantie du produit, elle ne dépend
    // pas d'une valeur par défaut d'amont. Les params explicites gagnent sur le preset.
    perParticipantE2EE: "true",
    // le point d'entrée choisi, transmis au lancement. Défaut audio :
    // allumer la caméra de quelqu'un qui n'a rien demandé se répare mal.
    intent: options.video ? INTENT_VIDEO : INTENT_AUDIO,
  };

  return {
    params,
    url: `${options.elementCallUrl.replace(/\/$/, "")}/room#?${new URLSearchParams(params).toString()}`,
  };
}

/**
 * branche l'API widget sur une iframe **déjà rendue par le shard UI**.
 *
 * Le rendu de l'iframe reste hors de ce paquet ; le pont postMessage, lui, y
 * est : sans lui le widget n'obtient pas son jeton OpenID et l'appel n'est jamais
 * autorisé par le SFU. Il vit ici et pas dans le shard parce que tient une
 * liste close de dépendances qui n'inclut pas `matrix-widget-api` — et n'a pas à
 * l'inclure : c'est du protocole, pas de l'interface.
 *
 * `onReady` est appelé quand le widget **nous a parlé**. C'est le seul signal qui dise
 * qu'Element Call a démarré : le `load` de l'iframe, lui, se déclenche pour n'importe
 * quel document — y compris une page d'erreur du serveur qui l'héberge. Le shard s'en
 * sert pour son délai de chargement.
 */
export function attachCallWidget(
  session: Session,
  roomId: string,
  iframe: HTMLIFrameElement,
  options: CallWidgetOptions,
  onReady?: () => void,
): () => void {
  const { url } = buildCallWidget(session, roomId, options);
  const widget = new Widget({
    id: options.widgetId,
    creatorUserId: session.client.getUserId() ?? "",
    type: CALL_APPLICATION,
    url,
    // Element Call annonce lui-même son chargement par `content_loaded`, qu'il envoie
    // dès son initialisation et **sans condition** — relu dans le bundle de l'image
    // épinglée v0.23.0, où l'appel à `sendContentLoaded()` ne dépend d'aucun paramètre
    // d'URL. Attendre en plus le `load` de l'iframe ferait démarrer la session deux fois.
    waitForIframeLoad: false,
  });

  const api = new ClientWidgetApi(widget, iframe, new CallWidgetDriver(session, roomId));
  if (onReady) api.once("ready", onReady);
  return () => api.stop();
}

/**
 * état d'appel d'**un** salon, dérivé des seuls événements d'état MatrixRTC.
 *
 * Le pendant multi-salons est `incomingCalls` : c'est lui qui porte la sonnerie, parce
 * qu'un appel entrant doit se voir sans avoir le bon salon ouvert. Le journal des appels
 * passés, appels manqués compris, est dans `callHistory`. Reste hors périmètre, et le
 * reste : le **refus**, que MatrixRTC ne définit pas — rien n'est envoyé à l'appelant
 * quand on n'y va pas, et l'interface ne prétend pas le contraire.
 */
export function activeCall(session: Session, roomId: string): ActiveCall {
  const client = session.client;
  const listeners = new Set<(state: CallState) => void>();
  function read(previous: CallStatus): CallState {
    const room = client.getRoom(roomId);
    const events =
      room?.getLiveTimeline().getState(Direction.Forward)?.getStateEvents(CALL_MEMBER_EVENT_TYPE) ??
      [];
    const participants = [
      ...new Set(
        events
          .filter((event) => isLiveMembership(event.getContent(), event.getTs()))
          .map((event) => event.getSender() ?? "")
          .filter(Boolean),
      ),
    ];
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
