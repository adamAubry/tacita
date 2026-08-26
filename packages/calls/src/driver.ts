import type { Session } from "@tacita/client-core";
import { Direction } from "matrix-js-sdk";
import {
  OpenIDRequestState,
  WidgetDriver,
  type Capability,
  type IOpenIDUpdate,
  type IRoomEvent,
  type ISendEventDetails,
  type ITurnServer,
  type SimpleObservable,
} from "matrix-widget-api";

/**
 * le pont entre Element Call et la Session, et rien d'autre : chaque méthode
 * délègue au client Matrix. Aucune logique RTC n'est réimplémentée ici — la négociation,
 * les clés de média et l'appartenance à l'appel restent entièrement dans le widget.
 *
 * aucune méthode ne journalise : elles manipulent des jetons OpenID, des
 * identifiants de salle SFU et des credentials TURN.
 */
export class CallWidgetDriver extends WidgetDriver {
  constructor(
    private readonly session: Session,
    private readonly roomId: string,
  ) {
    super();
  }

  /**
   * Le widget est notre propre déploiement Element Call, dont ce module construit
   * lui-même l'URL : il n'y a pas d'origine tierce à arbitrer, donc pas d'invite
   * utilisateur. Le confinement réel vient de `getKnownRooms` : quelles que soient les
   * capacités accordées, le widget ne voit que le salon de l'appel.
   */
  public validateCapabilities(requested: Set<Capability>): Promise<Set<Capability>> {
    return Promise.resolve(new Set(requested));
  }

  public getKnownRooms(): string[] {
    return [this.roomId];
  }

  public async sendEvent(
    eventType: string,
    content: unknown,
    stateKey: string | null = null,
    roomId: string | null = null,
  ): Promise<ISendEventDetails> {
    const target = this.scope(roomId);
    const sent =
      stateKey === null
        ? await this.session.client.sendEvent(target, eventType as never, content as never)
        : await this.session.client.sendStateEvent(
            target,
            eventType as never,
            content as never,
            stateKey,
          );
    return { roomId: target, eventId: sent.event_id };
  }

  /** Transport des clés de média du widget : jamais ouvert, jamais journalisé. */
  public async sendToDevice(
    eventType: string,
    encrypted: boolean,
    contentMap: { [userId: string]: { [deviceId: string]: object } },
  ): Promise<void> {
    if (!encrypted) {
      await this.session.client.sendToDevice(
        eventType,
        new Map(
          Object.entries(contentMap).map(([userId, devices]) => [
            userId,
            new Map(Object.entries(devices)),
          ]),
        ) as never,
      );
      return;
    }

    // Le SDK chiffre pour une liste d'appareils et *une* charge : le widget en envoie une
    // par appareil (clés de média distinctes), donc un appel par destinataire.
    for (const [userId, devices] of Object.entries(contentMap)) {
      for (const [deviceId, payload] of Object.entries(devices)) {
        await this.session.client.encryptAndSendToDevice(
          eventType,
          [{ userId, deviceId }],
          payload as never,
        );
      }
    }
  }

  public async readRoomState(
    roomId: string,
    eventType: string,
    stateKey: string | undefined,
  ): Promise<IRoomEvent[]> {
    const state = this.session.client
      .getRoom(this.scope(roomId))
      ?.getLiveTimeline()
      .getState(Direction.Forward);
    if (!state) return [];
    const events =
      stateKey === undefined
        ? state.getStateEvents(eventType)
        : [state.getStateEvents(eventType, stateKey)].filter((event) => event !== null);
    return events.map((event) => event.getEffectiveEvent() as unknown as IRoomEvent);
  }

  /** API antérieure à `readRoomState` : les deux coexistent selon la version du widget. */
  public async readStateEvents(
    eventType: string,
    stateKey: string | undefined,
    limit: number,
    roomIds: string[] | null = null,
  ): Promise<IRoomEvent[]> {
    const rooms = roomIds ?? [this.roomId];
    const events = await Promise.all(
      rooms.map((roomId) => this.readRoomState(roomId, eventType, stateKey)),
    );
    return events.flat().slice(0, limit);
  }

  /**
   * l'échange qui autorise le SFU : le widget obtient un jeton OpenID, le
   * présente à `lk-jwt-service` et reçoit un jeton LiveKit. Aucun credential
   * LiveKit ne transite par ce module.
   */
  public askOpenID(observer: SimpleObservable<IOpenIDUpdate>): void {
    this.session.client.getOpenIdToken().then(
      (token) => observer.update({ state: OpenIDRequestState.Allowed, token }),
      () => observer.update({ state: OpenIDRequestState.Blocked }),
    );
  }

  public async *getTurnServers(): AsyncGenerator<ITurnServer> {
    for (const server of this.session.client.getTurnServers()) {
      yield { uris: server.urls, username: server.username, password: server.credential };
    }
  }

  /** Un widget qui demande un autre salon que celui de son appel est hors de son mandat. */
  private scope(roomId: string | null): string {
    if (roomId && roomId !== this.roomId) {
      throw new Error("le widget d'appel ne peut pas accéder à un autre salon");
    }
    return this.roomId;
  }
}
