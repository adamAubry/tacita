import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createOutbox, type Outbox } from "../src";
import { fakeSession, matrixError } from "./session-mock";

const ROOM = "!salon:tacita.test";
const AUTRE = "!autre:tacita.test";
const message = (body: string) => ({ msgtype: "m.text", body });

/** Au-delà de MAX_BACKOFF_MS : rend toute entrée en attente à nouveau tentable. */
const APRÈS_LE_BACKOFF = 120_000;

let ctx: ReturnType<typeof fakeSession>;
let outbox: Outbox;

beforeEach(async () => {
  ctx = fakeSession();
  outbox = await createOutbox(ctx.session, { indexedDB: ctx.indexedDB });
  // Voir backoff.test.ts : fake-indexeddb a besoin d'un setImmediate réel.
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
});

afterEach(() => {
  outbox.dispose();
  vi.useRealTimers();
});

const sentTxnIds = () => ctx.client.sendEvent.mock.calls.map((call) => call[3]);

describe("REQ-OBX-02 — à la reconnexion, la file part en FIFO par salon", () => {
  it("envoie dans l'ordre de mise en file", async () => {
    ctx.client.sendEvent.mockRejectedValue(new Error("hors ligne"));
    await outbox.enqueue(ROOM, message("un"), "t1");
    await outbox.enqueue(ROOM, message("deux"), "t2");
    await outbox.flush();

    ctx.client.sendEvent.mockClear();
    ctx.client.sendEvent.mockResolvedValue({ event_id: "$ok" });
    vi.setSystemTime(Date.now() + APRÈS_LE_BACKOFF);

    ctx.emitSync("SYNCING", "ERROR");
    // `flush()` rend la passe déjà en vol : l'attendre, c'est attendre celle que la
    // reconnexion vient de déclencher.
    await outbox.flush();

    expect(sentTxnIds()).toEqual(["t1", "t2"]);
    expect(outbox.pending(ROOM)).toEqual([]);
  });

  it("un échec bloque la suite du même salon, pas les autres", async () => {
    ctx.client.sendEvent.mockImplementation(async (_room, _type, _content, txnId) => {
      if (txnId === "t1") throw new Error("hors ligne");
      return { event_id: `$${txnId}` };
    });

    await outbox.enqueue(ROOM, message("un"), "t1");
    await outbox.enqueue(ROOM, message("deux"), "t2");
    await outbox.enqueue(AUTRE, message("ailleurs"), "t3");
    await outbox.flush();

    expect(sentTxnIds()).not.toContain("t2");
    expect(sentTxnIds()).toContain("t3");
    expect(outbox.pending(ROOM).map((entry) => entry.txnId)).toEqual(["t1", "t2"]);
    expect(outbox.pending(AUTRE)).toEqual([]);
  });

  it("ne flushe pas sur une transition qui reste dans un état sain", async () => {
    ctx.client.sendEvent.mockRejectedValue(new Error("hors ligne"));
    await outbox.enqueue(ROOM, message("un"), "t1");
    await outbox.flush();

    // Backoff écoulé : seule l'absence de flush explique l'absence d'envoi.
    vi.setSystemTime(Date.now() + APRÈS_LE_BACKOFF);
    ctx.client.sendEvent.mockClear();

    ctx.emitSync("SYNCING", "SYNCING");
    await Promise.resolve();
    expect(ctx.client.sendEvent).not.toHaveBeenCalled();
  });
});

describe("REQ-OBX-03 — txnId stable entre les tentatives", () => {
  it("réutilise le même txnId à chaque essai plutôt que d'en générer un nouveau", async () => {
    ctx.client.sendEvent.mockRejectedValue(new Error("hors ligne"));
    await outbox.enqueue(ROOM, message("un"), "t1");
    await outbox.flush();

    vi.setSystemTime(Date.now() + APRÈS_LE_BACKOFF);
    await outbox.flush();
    await outbox.retry("t1");

    expect(sentTxnIds()).toEqual(["t1", "t1", "t1"]);
    expect(ctx.client.makeTxnId).not.toHaveBeenCalled();
  });

  it("génère le txnId via le SDK quand l'appelant n'en fournit pas", async () => {
    await outbox.enqueue(ROOM, message("un"));
    await outbox.flush();
    expect(ctx.client.makeTxnId).toHaveBeenCalledOnce();
    expect(sentTxnIds()).toEqual(["txn-0"]);
  });
});

describe("REQ-OBX-04 — statuts queued/sending/failed, retry et remove", () => {
  it("un envoi réussi sort de la file plutôt que de passer à un statut « envoyé »", async () => {
    await outbox.enqueue(ROOM, message("un"), "t1");
    await outbox.flush();
    expect(outbox.pending(ROOM)).toEqual([]);
  });

  it("un 4xx hors rate-limit marque l'entrée failed sans réessayer", async () => {
    ctx.client.sendEvent.mockRejectedValue(matrixError("M_FORBIDDEN", 403));
    await outbox.enqueue(ROOM, message("un"), "t1");
    await outbox.flush();

    expect(outbox.pending(ROOM)[0]).toMatchObject({
      status: "failed",
      errcode: "M_FORBIDDEN",
      attempts: 1,
    });

    ctx.client.sendEvent.mockClear();
    vi.setSystemTime(Date.now() + APRÈS_LE_BACKOFF);
    await outbox.flush();
    expect(ctx.client.sendEvent).not.toHaveBeenCalled();
  });

  it("un 5xx reste réessayable", async () => {
    ctx.client.sendEvent.mockRejectedValue(matrixError("M_UNKNOWN", 502));
    await outbox.enqueue(ROOM, message("un"), "t1");
    await outbox.flush();
    expect(outbox.pending(ROOM)[0]?.status).toBe("queued");
  });

  it("retry relance une entrée failed et remet le backoff à zéro", async () => {
    ctx.client.sendEvent.mockRejectedValue(matrixError("M_FORBIDDEN", 403));
    await outbox.enqueue(ROOM, message("un"), "t1");
    await outbox.flush();
    expect(outbox.pending(ROOM)[0]?.status).toBe("failed");

    ctx.client.sendEvent.mockResolvedValue({ event_id: "$ok" });
    await outbox.retry("t1");
    expect(outbox.pending(ROOM)).toEqual([]);
  });

  it("remove abandonne l'entrée", async () => {
    ctx.client.sendEvent.mockRejectedValue(matrixError("M_FORBIDDEN", 403));
    await outbox.enqueue(ROOM, message("un"), "t1");
    await outbox.flush();

    await outbox.remove("t1");
    expect(outbox.pending(ROOM)).toEqual([]);
  });

  it("retry sur un txnId inconnu ne fait rien", async () => {
    await expect(outbox.retry("inexistant")).resolves.toBeUndefined();
  });
});

describe("REQ-OBX-05 — les entrées portent de quoi fusionner avec la timeline", () => {
  it("expose txnId, roomId, contenu, statut et ordre FIFO", async () => {
    ctx.client.sendEvent.mockRejectedValue(new Error("hors ligne"));
    await outbox.enqueue(ROOM, message("un"), "t1");
    await outbox.enqueue(ROOM, message("deux"), "t2");
    await outbox.flush();

    expect(outbox.pending(ROOM)).toEqual([
      expect.objectContaining({ txnId: "t1", roomId: ROOM, content: message("un") }),
      expect.objectContaining({ txnId: "t2", roomId: ROOM, content: message("deux") }),
    ]);
    expect(outbox.pending(AUTRE)).toEqual([]);
  });

  it("notifie les abonnés à chaque changement, et plus après désabonnement", async () => {
    ctx.client.sendEvent.mockRejectedValue(new Error("hors ligne"));
    const listener = vi.fn();
    const unsubscribe = outbox.subscribe(listener);

    await outbox.enqueue(ROOM, message("un"), "t1");
    expect(listener).toHaveBeenCalled();

    unsubscribe();
    listener.mockClear();
    await outbox.enqueue(ROOM, message("deux"), "t2");
    expect(listener).not.toHaveBeenCalled();
  });
});
