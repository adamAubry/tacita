import type { Session } from "@tacita/client-core";
import {
  ClientEvent,
  Direction,
  MatrixEventEvent,
  RoomEvent,
  RoomStateEvent,
  type MatrixEvent,
  type ReceivedToDeviceMessage,
  type Room,
} from "matrix-js-sdk";
import { ClientWidgetApi, Widget, type IWidgetApiRequest } from "matrix-widget-api";

import { CallWidgetDriver } from "./driver";
import {
  CALL_APPLICATION,
  CALL_MEMBER_EVENT_TYPE,
  callMemberStateKey,
  ELEMENT_ACTION_ALWAYS_ON_SCREEN,
  ELEMENT_ACTION_CLOSE,
  ELEMENT_ACTION_DEVICE_MUTE,
  ELEMENT_ACTION_HANGUP,
  ELEMENT_ACTION_JOIN,
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
  ELEMENT_ACTION_ALWAYS_ON_SCREEN,
  ELEMENT_ACTION_CLOSE,
  ELEMENT_ACTION_DEVICE_MUTE,
  ELEMENT_ACTION_HANGUP,
  ELEMENT_ACTION_JOIN,
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
  /**
   * Appelé quand Element Call annonce que l'appel est terminé — `im.vector.hangup` ou
   * `io.element.close`. C'est le **seul** signal de raccrochage : le bouton vit dans le
   * widget (E-07 refuse deux sorties concurrentes), donc sans cet écouteur, raccrocher
   * dans Element Call laissait l'écran d'appel ouvert sur une session finie.
   */
  onRaccrocher?: () => void,
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

  /*
   * **Le widget ne reçoit que ce qu'on lui pousse.** `ClientWidgetApi` sait *répondre*
   * aux demandes du widget — c'est le rôle du driver — mais il n'observe rien tout seul.
   * `feedEvent` et `feedToDevice` sont des méthodes de l'hôte, et la doc d'amont le dit
   * en toutes lettres : « As a client you are expected to call this for every to-device
   * event you receive. » Sans elles, la conversation est à sens unique.
   *
   * Ce que ça coûtait, constaté sur staging le 29/08/2026 : l'appel se connecte, ICE
   * s'établit en UDP direct, les deux côtés publient leur piste — et personne n'entend
   * rien. Element Call chiffre le média **par participant** (`perParticipantE2EE`, la
   * garantie du produit) et distribue les clés par des événements Matrix. Chacun envoyait
   * la sienne — `sendEvent` marche, il passe par le driver — et ne recevait jamais celle
   * d'en face. Deux flux GCM que personne ne peut ouvrir.
   *
   * L'appartenance, elle, fonctionnait : elle se lit dans l'**état** du salon, que le
   * widget va chercher par `readRoomState`. C'est ce qui rendait le défaut si trompeur —
   * tout ce qui se tire marchait, tout ce qui se pousse manquait.
   */
  const nourrir = (event: MatrixEvent): void => {
    // Un événement qu'on ne sait pas déchiffrer n'a rien à dire au widget, et le lui
    // envoyer chiffré lui ferait croire à un message inconnu.
    if (event.isDecryptionFailure()) return;
    void api.feedEvent(event.getEffectiveEvent() as never, roomId).catch(() => {});
  };

  const surTimeline = (event: MatrixEvent, room: Room | undefined): void => {
    if (room?.roomId === roomId) nourrir(event);
  };

  /*
   * Le salon est chiffré : un événement arrive d'abord en `m.room.encrypted` et n'est
   * déchiffré qu'ensuite. `Room.timeline` le voit sous sa forme fermée — c'est
   * `Decrypted` qui porte le contenu, et donc la clé de média. Même paire d'écouteurs
   * que `@tacita/messaging`, et pour la même raison.
   */
  const surDechiffrement = (event: MatrixEvent): void => {
    if (event.getRoomId() === roomId) nourrir(event);
  };

  /*
   * **`feedEvent` ne met pas l'état à jour, et l'état est la liste des participants.**
   *
   * Deuxième moitié du même défaut qu'`ebf53c5`, un étage plus bas. L'hôte a *deux*
   * obligations distinctes, et leurs docstrings d'amont le disent chacune : `feedEvent`
   * « pour tout nouvel événement », `feedStateUpdate` « pour toute mise à jour d'état ».
   * On ne tenait que la première.
   *
   * Ce que ça coûte, relu dans `matrix-js-sdk/lib/embedded.js` de l'image épinglée :
   * quand l'hôte annonce la version d'API `msc2762_update_state` — et `matrix-widget-api@1.18.0`
   * l'annonce toujours — le widget injecte les événements reçus par `send_event` avec une
   * liste d'état **vide**. Un événement d'état poussé par `feedEvent` atterrit dans la
   * timeline du widget et **jamais dans son état**. `ClientWidgetApi` ne pousse l'état
   * complet qu'une fois, à l'octroi des capacités ; après ça, `feedStateUpdate` est le
   * seul chemin.
   *
   * Conséquence exacte : `MatrixRTCSession.memberships` d'Element Call reste figé sur qui
   * était dans l'appel à l'instant où son widget a démarré. `RTCEncryptionManager` ne
   * distribue une clé qu'aux appartenances qui *changent* ; sans mise à jour, il n'appelle
   * `sendKey` qu'avec nous-même, que `ToDeviceKeyTransport` filtre — et n'envoie donc
   * rien. Deux widgets ouverts avant que quiconque ait rejoint : personne n'apprend
   * l'arrivée de l'autre, aucune clé ne part, pas un seul `send_to_device` sur le pont.
   * L'appel se connecte, les pistes se publient, et `MissingKey` des deux côtés.
   *
   * `RoomStateEvent.Events` et non la timeline : c'est le même écouteur qu'`activeCall`
   * plus bas, et le seul qui voie aussi l'état arrivé hors fenêtre de timeline.
   */
  const surEtat = (event: MatrixEvent): void => {
    if (event.getRoomId() !== roomId) return;
    void api.feedStateUpdate(event.getEffectiveEvent() as never).catch(() => {});
  };

  const surToDevice = ({ message, encryptionInfo }: ReceivedToDeviceMessage): void => {
    // `encryptionInfo` vaut `null` quand le message est arrivé en clair : c'est
    // exactement le booléen que le widget attend, pas une supposition de notre part.
    void api.feedToDevice(message as never, encryptionInfo !== null).catch(() => {});
  };

  /*
   * **Les actions que la bibliothèque ne traite pas, et qu'elle n'a pas à traiter.**
   * `ClientWidgetApi.handleMessage` a un `switch` de dix-huit actions ; tout le reste
   * tombe dans son `default:` et repart en « Unknown or unsupported from-widget action ».
   * Ce n'est pas un manque d'amont : la bibliothèque émet d'abord `action:<nom>` en
   * événement **annulable**, et c'est à l'hôte de le préempter puis de répondre. Element
   * Web fait exactement ça ; nous ne le faisions pas, donc Element Call recevait une
   * erreur à chacune des quatre actions qu'il nous adresse.
   *
   * `m.always_on_screen` est le cas le plus net : on accordait la capacité et on
   * répondait « inconnue » quand il s'en servait. Une promesse affichée et non tenue, la
   * même que celle du driver, un étage plus haut.
   *
   * Répondre `{}` n'est pas éluder : sauf pour l'écran toujours allumé — qui attend un
   * `success` — ces actions **notifient**, elles ne demandent rien. Ce que l'hôte en fait
   * lui appartient : ici, seul le raccrochage a une conséquence.
   */
  const repondre = (nom: string, reponse: unknown, effet?: () => void): (() => void) => {
    const handler = (ev: CustomEvent<IWidgetApiRequest>): void => {
      // Sans `preventDefault`, la bibliothèque répondrait « action inconnue » par-dessus.
      ev.preventDefault();
      void api.transport.reply(ev.detail, reponse as never);
      effet?.();
    };
    api.on(`action:${nom}`, handler);
    return () => void api.off(`action:${nom}`, handler);
  };

  const actions = [
    // L'appel occupe tout l'écran de toute façon : la demande est toujours honorée.
    repondre(ELEMENT_ACTION_ALWAYS_ON_SCREEN, { success: true }),
    // Deux notifications : le widget dit ce qu'il fait, l'app n'a rien à en faire.
    repondre(ELEMENT_ACTION_JOIN, {}),
    repondre(ELEMENT_ACTION_DEVICE_MUTE, {}),
    // Le raccrochage, lui, doit sortir de l'écran d'appel — les deux formes le disent.
    repondre(ELEMENT_ACTION_HANGUP, {}, onRaccrocher),
    repondre(ELEMENT_ACTION_CLOSE, {}, onRaccrocher),
  ];

  session.client.on(RoomEvent.Timeline, surTimeline);
  session.client.on(MatrixEventEvent.Decrypted, surDechiffrement);
  session.client.on(RoomStateEvent.Events, surEtat);
  session.client.on(ClientEvent.ReceivedToDeviceMessage, surToDevice);

  return () => {
    session.client.off(RoomEvent.Timeline, surTimeline);
    session.client.off(MatrixEventEvent.Decrypted, surDechiffrement);
    session.client.off(RoomStateEvent.Events, surEtat);
    session.client.off(ClientEvent.ReceivedToDeviceMessage, surToDevice);
    for (const retirer of actions) retirer();
    api.stop();
  };
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
