// @vitest-environment jsdom
import { asSession } from "@tacita/client-core/testing";
import { ClientEvent, MatrixEventEvent, RoomEvent } from "matrix-js-sdk";
import { ClientWidgetApi } from "matrix-widget-api";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  attachCallWidget,
  ELEMENT_ACTION_ALWAYS_ON_SCREEN,
  ELEMENT_ACTION_CLOSE,
  ELEMENT_ACTION_DEVICE_MUTE,
  ELEMENT_ACTION_HANGUP,
  ELEMENT_ACTION_JOIN,
} from "../src/index";

/**
 * **Le pont ne parle que dans un sens tant que l'hôte ne pousse rien.**
 *
 * `ClientWidgetApi` répond aux demandes du widget — c'est le driver — mais n'observe
 * rien de lui-même : `feedEvent` et `feedToDevice` sont des méthodes que le client doit
 * appeler, et la doc d'amont le dit en toutes lettres.
 *
 * Constaté sur staging le 29/08/2026 : appel connecté, ICE établi en UDP direct, les deux
 * côtés publiant leur piste audio — et le silence. Element Call chiffre le média **par
 * participant** et distribue les clés par des événements Matrix ; chacun envoyait la
 * sienne et ne recevait jamais celle d'en face. L'appartenance, elle, marchait : elle se
 * **tire** de l'état du salon. Tout ce qui se tirait marchait, tout ce qui se pousse
 * manquait — et rien dans la suite ne pouvait le voir, puisque les tests éprouvaient le
 * driver, c'est-à-dire précisément le sens qui fonctionnait.
 */
const SALON = "!salon:tacita.chat";
const AUTRE = "!autre:tacita.chat";

/** Les écouteurs posés sur le client, par nom d'événement. */
function fakeSession() {
  const ecouteurs = new Map<string, Set<(...args: unknown[]) => void>>();
  const client = {
    baseUrl: "https://tacita.chat",
    getUserId: () => "@moi:tacita.chat",
    getDeviceId: () => "APPAREIL",
    on: (nom: string, handler: (...args: unknown[]) => void) => {
      (ecouteurs.get(nom) ?? ecouteurs.set(nom, new Set()).get(nom)!).add(handler);
    },
    off: (nom: string, handler: (...args: unknown[]) => void) => ecouteurs.get(nom)?.delete(handler),
  };
  return {
    session: asSession({ client } as never),
    emettre: (nom: string, ...args: unknown[]) => {
      for (const handler of ecouteurs.get(nom) ?? []) handler(...args);
    },
    compte: (nom: string) => ecouteurs.get(nom)?.size ?? 0,
  };
}

const evenement = (roomId: string, dechiffrable = true) => ({
  isDecryptionFailure: () => !dechiffrable,
  getRoomId: () => roomId,
  getEffectiveEvent: () => ({ type: "io.element.call.encryption_keys", room_id: roomId }),
});

type Espion = ReturnType<typeof vi.fn<(...args: unknown[]) => unknown>>;
/** Les deux méthodes de l'hôte, espionnées sur le prototype : c'est leur appel qu'on éprouve. */
let feedEvent: Espion;
let feedToDevice: Espion;
let detacher: () => void;
let pont: ReturnType<typeof fakeSession>;
let api: ClientWidgetApi;
let repondu: unknown[];
let raccroche: number;

beforeEach(() => {
  feedEvent = vi.spyOn(ClientWidgetApi.prototype, "feedEvent").mockResolvedValue(undefined) as Espion;
  feedToDevice = vi
    .spyOn(ClientWidgetApi.prototype, "feedToDevice")
    .mockResolvedValue(undefined) as Espion;
  const cadre = document.createElement("iframe");
  document.body.append(cadre);
  pont = fakeSession();
  repondu = [];
  raccroche = 0;
  // L'instance que `attachCallWidget` construit — attrapée au premier `on`, pour émettre
  // les actions **comme la bibliothèque le fait** plutôt que d'appeler nos handlers en
  // direct : ce qu'on éprouve, c'est qu'ils sont branchés au bon endroit.
  const vraiOn = ClientWidgetApi.prototype.on;
  const capturer = (instance: ClientWidgetApi): ClientWidgetApi => (api = instance);
  const construit = vi
    .spyOn(ClientWidgetApi.prototype, "on")
    .mockImplementation(function (this: ClientWidgetApi, ...args) {
      return vraiOn.apply(capturer(this), args as never);
    });
  detacher = attachCallWidget(
    pont.session,
    SALON,
    cadre,
    { elementCallUrl: "https://call.tacita.chat", widgetId: "widget-1", parentUrl: "https://app.tacita.chat" },
    undefined,
    () => (raccroche += 1),
  );
  construit.mockRestore();
  vi.spyOn(api.transport, "reply").mockImplementation((_req, reponse) => {
    repondu.push(reponse);
  });
});

afterEach(() => {
  detacher();
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

describe("l'hôte pousse au widget ce que le widget ne peut pas aller chercher", () => {
  it("un événement de la timeline du salon atteint le widget", () => {
    // C'est par là que passent les clés de média : sans ce chemin, chacun publie du
    // GCM que personne d'autre ne peut ouvrir.
    pont.emettre(RoomEvent.Timeline, evenement(SALON), { roomId: SALON });

    expect(feedEvent).toHaveBeenCalledTimes(1);
    expect(feedEvent.mock.calls[0]![1]).toBe(SALON);
  });

  it("un événement déchiffré après coup y atteint aussi — c'est lui qui porte le contenu", () => {
    // Le salon est chiffré : `Room.timeline` voit l'enveloppe, `Decrypted` porte la clé.
    // Ne brancher que le premier laisserait passer une enveloppe vide.
    pont.emettre(MatrixEventEvent.Decrypted, evenement(SALON));

    expect(feedEvent).toHaveBeenCalledTimes(1);
  });

  it("un message to-device atteint le widget, avec l'état réel de son chiffrement", () => {
    pont.emettre(ClientEvent.ReceivedToDeviceMessage, {
      message: { type: "io.element.call.encryption_keys" },
      encryptionInfo: { sender: "@autre:tacita.chat" },
    });
    pont.emettre(ClientEvent.ReceivedToDeviceMessage, {
      message: { type: "m.dummy" },
      encryptionInfo: null,
    });

    // `encrypted` est **lu** de `encryptionInfo`, jamais supposé : le widget en tire une
    // décision de confiance, et lui mentir serait pire que ne rien lui dire.
    expect(feedToDevice.mock.calls.map((appel) => appel[1])).toEqual([true, false]);
  });

  it("un salon qui n'est pas celui de l'appel ne traverse pas le pont", () => {
    // Le confinement du driver vaut pour ce que le widget demande ; celui-ci vaut pour
    // ce qu'on lui envoie. Les deux sens ont besoin de leur garde.
    pont.emettre(RoomEvent.Timeline, evenement(AUTRE), { roomId: AUTRE });
    pont.emettre(MatrixEventEvent.Decrypted, evenement(AUTRE));

    expect(feedEvent).not.toHaveBeenCalled();
  });

  it("un événement indéchiffrable n'est pas poussé : une enveloppe close n'apprend rien", () => {
    pont.emettre(MatrixEventEvent.Decrypted, evenement(SALON, false));

    expect(feedEvent).not.toHaveBeenCalled();
  });

  it("détacher retire les trois écouteurs : un appel raccroché n'écoute plus", () => {
    detacher();

    for (const nom of [RoomEvent.Timeline, MatrixEventEvent.Decrypted, ClientEvent.ReceivedToDeviceMessage]) {
      expect(pont.compte(nom), `${nom} est resté branché`).toBe(0);
    }
    // `afterEach` rappelle `detacher` : il doit être idempotent.
    detacher = () => {};
  });
});

/**
 * **Les actions qu'Element Call adresse à son hôte.** `ClientWidgetApi` en traite
 * dix-huit dans son `switch` ; les cinq ci-dessous n'en font pas partie et repartent en
 * « Unknown or unsupported from-widget action » tant que l'hôte ne les préempte pas.
 *
 * Constaté sur staging le 29/08/2026, trois d'un coup dans la console du widget :
 * `set_always_on_screen`, `io.element.join` et `io.element.device_mute`. La première est
 * la plus parlante — on accordait `m.always_on_screen` et on répondait « inconnue » quand
 * il s'en servait. Une promesse affichée et non tenue, un étage au-dessus du driver.
 */
describe("l'hôte répond aux actions qu'Element Call lui adresse", () => {
  /** Comme la bibliothèque : un événement annulable, que l'hôte doit préempter. */
  const emettre = (nom: string) => {
    const ev = new CustomEvent(`action:${nom}`, {
      detail: { api: "fromWidget", action: nom, requestId: "r1", widgetId: "widget-1", data: {} },
      cancelable: true,
    });
    api.emit(`action:${nom}`, ev);
    return ev;
  };

  it("chacune des cinq est préemptée : sans quoi la bibliothèque répond « action inconnue »", () => {
    for (const nom of [
      ELEMENT_ACTION_ALWAYS_ON_SCREEN,
      ELEMENT_ACTION_JOIN,
      ELEMENT_ACTION_DEVICE_MUTE,
      ELEMENT_ACTION_HANGUP,
      ELEMENT_ACTION_CLOSE,
    ]) {
      expect(emettre(nom).defaultPrevented, `${nom} n'est pas préemptée`).toBe(true);
    }
    expect(repondu).toHaveLength(5);
  });

  it("l'écran toujours allumé obtient un succès, et pas un objet vide", () => {
    // `setAlwaysOnScreen` lit `response.success` : un `{}` se lirait « refusé ».
    emettre(ELEMENT_ACTION_ALWAYS_ON_SCREEN);

    expect(repondu[0]).toEqual({ success: true });
  });

  it("raccrocher sort de l'écran d'appel, sous ses deux noms", () => {
    // Le bouton de raccrochage vit dans le widget (E-07) : ces deux actions sont le seul
    // signal qui dise que l'appel est fini. Sans elles, l'écran restait ouvert sur une
    // session terminée.
    emettre(ELEMENT_ACTION_HANGUP);
    emettre(ELEMENT_ACTION_CLOSE);

    expect(raccroche).toBe(2);
  });

  it("rejoindre et couper le micro ne font que notifier : aucune sortie d'écran", () => {
    emettre(ELEMENT_ACTION_JOIN);
    emettre(ELEMENT_ACTION_DEVICE_MUTE);

    expect(raccroche).toBe(0);
    expect(repondu).toEqual([{}, {}]);
  });
});
