import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { ClientEvent, EventStatus, ReceiptType, RoomEvent } from "matrix-js-sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Session } from "@tacita/client-core";
import { asSession } from "@tacita/client-core/testing";

import { createReceipts, DELIVERED_EVENT_TYPE, type ReceiptStatus } from "../src/index";

const MOI = "@moi:tacita.test";
const TOI = "@toi:tacita.test";
const SALON = "!salon:tacita.test";

type Handler = (...args: never[]) => void;

/** `MatrixClient` réduit à ce que le module en touche. */
function fakeClient() {
  const handlers = new Map<string, Set<Handler>>();
  return {
    getUserId: () => MOI,
    sendToDevice: vi.fn(
      async (_type: string, _content: Map<string, Map<string, { event_ids: string[] }>>) => ({}),
    ),
    sendReceipt: vi.fn(async () => ({})),
    on(event: string, handler: Handler) {
      (handlers.get(event) ?? handlers.set(event, new Set()).get(event)!).add(handler);
    },
    off(event: string, handler: Handler) {
      handlers.get(event)?.delete(handler);
    },
    emit(event: string, ...args: unknown[]) {
      for (const handler of handlers.get(event) ?? []) (handler as (...a: unknown[]) => void)(...args);
    },
  };
}

type FakeClient = ReturnType<typeof fakeClient>;

/** `MatrixEvent` réduit à ce que le module en lit. */
function fakeEvent(id: string, sender: string, status: EventStatus | null = null) {
  return { getId: () => id, getSender: () => sender, isState: () => false, status };
}

/** Insertion en store : le SDK émet `Room.timeline` pour tout événement live. */
function insert(client: FakeClient, event: ReturnType<typeof fakeEvent>) {
  client.emit(RoomEvent.Timeline, event, { roomId: SALON }, false, false, { liveEvent: true });
}

function readReceipt(eventIds: string[], reader: string) {
  const content = Object.fromEntries(
    eventIds.map((id) => [id, { [ReceiptType.Read]: { [reader]: { ts: 1 } } }]),
  );
  return { getContent: () => content };
}

/** La timeline telle que le SDK l'a accumulée depuis `/sync`. */
function fakeRoom(...eventIds: string[]) {
  return {
    getLiveTimeline: () => ({
      getEvents: () => eventIds.map((id) => ({ getId: () => id })),
    }),
  };
}

function delivered(eventIds: string[]) {
  return { message: { type: DELIVERED_EVENT_TYPE, sender: TOI, content: { event_ids: eventIds } } };
}

let client: FakeClient;
let session: Session;

beforeEach(() => {
  vi.useFakeTimers();
  client = fakeClient();
  // Ce paquet ne lit que `client`. `asSession` fournit le reste du contrat en
  // levées nommées : un membre ajouté à `Session` ne manque plus en silence.
  session = asSession({ client });
});

describe("« envoyé » dérivé de l'event_id serveur, `sending` avant", () => {
  it("passe de sending à sent quand l'écho local reçoit son identifiant", () => {
    const receipts = createReceipts(session);
    const seen: [string, ReceiptStatus][] = [];
    receipts.subscribe((id, status) => seen.push([id, status]));

    insert(client, fakeEvent("~local", MOI, EventStatus.SENDING));
    expect(receipts.status("~local")).toBe("sending");

    client.emit(RoomEvent.LocalEchoUpdated, fakeEvent("$reel", MOI), { roomId: SALON }, "~local");

    expect(receipts.status("$reel")).toBe("sent");
    // L'entrée d'écho est retirée, pas laissée figée à `sending`.
    expect(receipts.status("~local")).toBeUndefined();
    expect(seen).toEqual([
      ["~local", "sending"],
      ["$reel", "sent"],
    ]);
  });

  it("ne fait pas reculer un statut acquis quand l'écho est ré-émis sans nouvel id", () => {
    const receipts = createReceipts(session);
    insert(client, fakeEvent("$a", MOI));
    client.emit(ClientEvent.ReceivedToDeviceMessage, delivered(["$a"]));

    // Le SDK ré-émet aussi l'écho local sur un simple changement de statut d'envoi.
    client.emit(RoomEvent.LocalEchoUpdated, fakeEvent("$a", MOI), { roomId: SALON }, "$a");

    expect(receipts.status("$a")).toBe("delivered");
  });

  it("ne suit pas les messages entrants : ils n'ont pas de statut d'envoi", () => {
    const receipts = createReceipts(session);
    insert(client, fakeEvent("$deToi", TOI));
    expect(receipts.status("$deToi")).toBeUndefined();
  });
});

describe("« lu » dérivé des reçus m.read natifs", () => {
  it("passe à read sur reçu d'un autre utilisateur, ignore le sien", () => {
    const receipts = createReceipts(session);
    insert(client, fakeEvent("$a", MOI));

    client.emit(RoomEvent.Receipt, readReceipt(["$a"], MOI), fakeRoom("$a"));
    expect(receipts.status("$a")).toBe("sent");

    client.emit(RoomEvent.Receipt, readReceipt(["$a"], TOI), fakeRoom("$a"));
    expect(receipts.status("$a")).toBe("read");
  });

  it("marque lu tout ce qui précède : « m.read » vaut « lu jusqu'ici »", () => {
    const receipts = createReceipts(session);
    for (const id of ["$a1", "$a2", "$a3"]) insert(client, fakeEvent(id, MOI));

    // Le reçu ne pointe que le dernier message.
    client.emit(RoomEvent.Receipt, readReceipt(["$a3"], TOI), fakeRoom("$a1", "$a2", "$a3"));

    expect(["$a1", "$a2", "$a3"].map(receipts.status)).toEqual(["read", "read", "read"]);
  });

  it("ne remonte rien pour un reçu hors de la timeline chargée", () => {
    const receipts = createReceipts(session);
    insert(client, fakeEvent("$a", MOI));

    client.emit(RoomEvent.Receipt, readReceipt(["$a"], TOI), fakeRoom("$autre"));

    expect(receipts.status("$a")).toBe("read");
  });
});

describe("« délivré » émis à l'entrée en store, pas à l'affichage", () => {
  it("émet un accusé pour un message entrant, jamais pour les siens", async () => {
    createReceipts(session);

    insert(client, fakeEvent("$deToi", TOI));
    insert(client, fakeEvent("$deMoi", MOI));
    // Rien n'est parti avant l'échéance du lot.
    expect(client.sendToDevice).not.toHaveBeenCalled();

    await vi.runAllTimersAsync();

    expect(client.sendToDevice).toHaveBeenCalledTimes(1);
    const [type, contentMap] = client.sendToDevice.mock.calls[0]!;
    expect(type).toBe(DELIVERED_EVENT_TYPE);
    // `*` : l'expéditeur n'a pas à deviner lequel de ses appareils écoute.
    expect(contentMap.get(TOI)!.get("*")).toEqual({ event_ids: ["$deToi"] });
  });
});

describe("« délivré » au premier appareil atteint, surnuméraires idempotents", () => {
  it("ne notifie qu'une fois pour deux accusés de deux appareils du même compte", () => {
    const receipts = createReceipts(session);
    const seen: ReceiptStatus[] = [];
    insert(client, fakeEvent("$a", MOI));
    receipts.subscribe((_id, status) => seen.push(status));

    client.emit(ClientEvent.ReceivedToDeviceMessage, delivered(["$a"]));
    client.emit(ClientEvent.ReceivedToDeviceMessage, delivered(["$a"]));

    expect(receipts.status("$a")).toBe("delivered");
    expect(seen).toEqual(["delivered"]);
  });

  it("ne fait jamais reculer read vers delivered", () => {
    const receipts = createReceipts(session);
    insert(client, fakeEvent("$a", MOI));
    client.emit(RoomEvent.Receipt, readReceipt(["$a"], TOI), fakeRoom("$a"));

    client.emit(ClientEvent.ReceivedToDeviceMessage, delivered(["$a"]));

    expect(receipts.status("$a")).toBe("read");
  });
});

describe("reçu « délivré » volontairement non chiffré", () => {
  it("remet au SDK une charge lisible, sans enveloppe chiffrée", async () => {
    createReceipts(session);
    insert(client, fakeEvent("$deToi", TOI));
    await vi.runAllTimersAsync();

    // Ce que le serveur verra : des identifiants en clair, jamais de contenu de message.
    const [, contentMap] = client.sendToDevice.mock.calls[0]!;
    expect(contentMap.get(TOI)!.get("*")).toEqual({ event_ids: ["$deToi"] });
  });
});

describe("extension non standard documentée, jamais présentée comme native", () => {
  it("le README nomme la limite au lieu de la masquer", () => {
    const readme = readFileSync(fileURLToPath(new URL("../README.md", import.meta.url)), "utf8");
    expect(readme).toContain("Matrix ne définit aucun accusé « délivré »");
    expect(readme).toContain("non standard");
    expect(readme).toContain("en clair");
  });
});

describe("mode masqué : bascule vers m.read.private, pas de coupure", () => {
  it("choisit le type de reçu selon le mode", async () => {
    const receipts = createReceipts(session);
    const event = fakeEvent("$deToi", TOI);

    await receipts.markRead(event as never);
    expect(client.sendReceipt).toHaveBeenLastCalledWith(event, ReceiptType.Read);

    receipts.setHiddenMode(true);
    await receipts.markRead(event as never);
    // Toujours un reçu : il synchronise les compteurs de non-lus entre appareils.
    expect(client.sendReceipt).toHaveBeenLastCalledWith(event, ReceiptType.ReadPrivate);
  });
});

describe("mode masqué : « délivré » suspendu, expéditeur bloqué à sent", () => {
  it("n'émet aucun accusé et abandonne le lot en attente", async () => {
    const receipts = createReceipts(session);
    insert(client, fakeEvent("$deToi", TOI));
    receipts.setHiddenMode(true);

    await vi.runAllTimersAsync();
    expect(client.sendToDevice).not.toHaveBeenCalled();

    // Pas de rattrapage à la sortie du mode masqué.
    receipts.setHiddenMode(false);
    await vi.runAllTimersAsync();
    expect(client.sendToDevice).not.toHaveBeenCalled();
  });

  it("expose l'ambiguïté d'un message resté à sent", () => {
    const receipts = createReceipts(session);
    insert(client, fakeEvent("$a", MOI));

    expect(receipts.status("$a")).toBe("sent");
    expect(receipts.deliveryUnknowable("$a")).toBe(true);

    client.emit(ClientEvent.ReceivedToDeviceMessage, delivered(["$a"]));
    expect(receipts.deliveryUnknowable("$a")).toBe(false);
  });
});

describe("anti-tempête : « délivré » émis par lot", () => {
  it("groupe un sync de rattrapage en un envoi par destinataire", async () => {
    createReceipts(session);

    for (const id of ["$m1", "$m2", "$m3"]) insert(client, fakeEvent(id, TOI));
    await vi.runAllTimersAsync();

    expect(client.sendToDevice).toHaveBeenCalledTimes(1);
    expect(client.sendToDevice.mock.calls[0]![1].get(TOI)!.get("*")).toEqual({
      event_ids: ["$m1", "$m2", "$m3"],
    });
  });

  it("n'émet plus rien après stop()", async () => {
    const receipts = createReceipts(session);
    insert(client, fakeEvent("$m1", TOI));
    receipts.stop();

    await vi.runAllTimersAsync();
    expect(client.sendToDevice).not.toHaveBeenCalled();
  });
});
