import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { backoffMs, BASE_BACKOFF_MS, createOutbox, MAX_BACKOFF_MS, type Outbox } from "../src";
import { fakeSession, matrixError, networkError } from "./session-mock";

const ROOM = "!salon:tacita.test";
const message = (body: string) => ({ msgtype: "m.text", body });

let ctx: ReturnType<typeof fakeSession>;
let outbox: Outbox;

beforeEach(async () => {
  ctx = fakeSession();
  outbox = await createOutbox(ctx.session, { indexedDB: ctx.indexedDB });
  // fake-indexeddb ordonnance ses callbacks sur setImmediate : le faker par défaut
  // le gèle et plus aucune transaction ne se termine. On ne fake que ce que le
  // backoff utilise.
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
});

afterEach(() => {
  outbox.dispose();
  vi.useRealTimers();
});

describe("REQ-OBX-07 — backoff exponentiel sur rate-limit et erreurs réseau", () => {
  it("le délai double à chaque tentative jusqu'à un plafond", () => {
    expect(backoffMs(0, networkError())).toBe(BASE_BACKOFF_MS);
    expect(backoffMs(1, networkError())).toBe(BASE_BACKOFF_MS * 2);
    expect(backoffMs(2, networkError())).toBe(BASE_BACKOFF_MS * 4);
    expect(backoffMs(50, networkError())).toBe(MAX_BACKOFF_MS);
  });

  it("le retry_after_ms du serveur prime sur le calcul local", () => {
    expect(backoffMs(0, matrixError("M_LIMIT_EXCEEDED", 429, 7_500))).toBe(7_500);
    expect(backoffMs(5, matrixError("M_LIMIT_EXCEEDED", 429, 200))).toBe(200);
  });

  it("un 429 sans délai serveur retombe sur l'exponentiel", () => {
    expect(backoffMs(1, matrixError("M_LIMIT_EXCEEDED", 429))).toBe(BASE_BACKOFF_MS * 2);
  });

  it("une entrée en attente de backoff n'est pas réessayée avant l'heure", async () => {
    ctx.client.sendEvent.mockRejectedValue(matrixError("M_LIMIT_EXCEEDED", 429, 30_000));
    await outbox.enqueue(ROOM, message("un"), "t1");
    await outbox.flush();
    ctx.client.sendEvent.mockClear();

    await outbox.flush();
    expect(ctx.client.sendEvent).not.toHaveBeenCalled();

    vi.setSystemTime(Date.now() + 30_000);
    await outbox.flush();
    expect(ctx.client.sendEvent).toHaveBeenCalledOnce();
  });

  it("les tentatives successives espacent de plus en plus les envois", async () => {
    ctx.client.sendEvent.mockRejectedValue(networkError());
    await outbox.enqueue(ROOM, message("un"), "t1");

    const delays: number[] = [];
    for (let i = 0; i < 3; i++) {
      const before = Date.now();
      await outbox.flush();
      delays.push(outbox.pending(ROOM)[0]!.nextAttemptAt - before);
      vi.setSystemTime(outbox.pending(ROOM)[0]!.nextAttemptAt);
    }

    expect(delays).toEqual([BASE_BACKOFF_MS, BASE_BACKOFF_MS * 2, BASE_BACKOFF_MS * 4]);
  });

  it("pas de flood : une reconnexion ne rejoue pas une entrée encore en backoff", async () => {
    ctx.client.sendEvent.mockRejectedValue(matrixError("M_LIMIT_EXCEEDED", 429, 60_000));
    await outbox.enqueue(ROOM, message("un"), "t1");
    await outbox.flush();
    ctx.client.sendEvent.mockClear();

    for (let i = 0; i < 10; i++) ctx.emitSync("SYNCING", "ERROR");
    await vi.advanceTimersByTimeAsync(0);
    expect(ctx.client.sendEvent).not.toHaveBeenCalled();
  });
});
