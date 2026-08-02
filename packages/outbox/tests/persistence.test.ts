import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createOutbox, type Outbox } from "../src";
import { fakeSession, matrixError } from "./session-mock";

const ROOM = "!salon:tacita.test";
const message = (body: string) => ({ msgtype: "m.text", body });

const code = ["outbox.ts", "store.ts", "entry.ts", "index.ts"]
  .map((name) => readFileSync(new URL(`../src/${name}`, import.meta.url), "utf-8"))
  .join("\n")
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^[ \t]*\/\/.*$/gm, "");

let ctx: ReturnType<typeof fakeSession>;
let outbox: Outbox;

beforeEach(async () => {
  ctx = fakeSession();
  outbox = await createOutbox(ctx.session, { indexedDB: ctx.indexedDB });
});

describe("REQ-OBX-01 — persistance IndexedDB avant tout réseau, survit au reload", () => {
  it("écrit l'entrée avant la première tentative d'envoi", async () => {
    const order: string[] = [];
    ctx.client.sendEvent.mockImplementation(async () => {
      order.push("send");
      return { event_id: "$ok" };
    });
    outbox.subscribe(() => order.push("persist"));

    await outbox.enqueue(ROOM, message("un"), "t1");
    await vi.waitFor(() => expect(order).toContain("send"));
    expect(order[0]).toBe("persist");
  });

  it("l'entrée est toujours là après destruction et recréation du module", async () => {
    ctx.client.sendEvent.mockRejectedValue(new Error("hors ligne"));
    await outbox.enqueue(ROOM, message("composé hors ligne"), "t1");
    outbox.dispose();

    const rechargé = await createOutbox(ctx.session, { indexedDB: ctx.indexedDB });
    expect(rechargé.pending(ROOM)).toEqual([
      expect.objectContaining({ txnId: "t1", content: message("composé hors ligne") }),
    ]);
    rechargé.dispose();
  });

  it("une entrée laissée en « sending » par un onglet tué repart en file", async () => {
    let resolveSend: (() => void) | undefined;
    ctx.client.sendEvent.mockImplementation(
      () => new Promise((resolve) => (resolveSend = () => resolve({ event_id: "$ok" }))),
    );

    await outbox.enqueue(ROOM, message("un"), "t1");
    await vi.waitFor(() => expect(outbox.pending(ROOM)[0]?.status).toBe("sending"));
    outbox.dispose(); // onglet fermé en plein envoi

    const rechargé = await createOutbox(ctx.session, { indexedDB: ctx.indexedDB });
    expect(rechargé.pending(ROOM)[0]?.status).toBe("queued");
    resolveSend?.();
    rechargé.dispose();
  });
});

describe("REQ-OBX-06 — le contenu ne passe ni par localStorage ni par les logs", () => {
  it("aucun stockage synchrone du navigateur n'est touché", () => {
    expect(code).not.toMatch(/localStorage|sessionStorage|document\.cookie/);
  });

  it("le module n'écrit rien dans la console", () => {
    expect(code).not.toMatch(/console\./);
  });

  it("une entrée en échec ne retient que le code d'erreur, pas le message", async () => {
    ctx.client.sendEvent.mockRejectedValue(
      Object.assign(new Error("échec sur le corps « rendez-vous à 18h »"), {
        errcode: "M_FORBIDDEN",
        httpStatus: 403,
      }),
    );
    await outbox.enqueue(ROOM, message("rendez-vous à 18h"), "t1");
    await outbox.flush();

    const [entry] = outbox.pending(ROOM);
    expect(entry?.errcode).toBe("M_FORBIDDEN");
    expect(Object.keys(entry!)).not.toContain("error");
    // Le contenu vit dans `content`, qui est ce que la Session chiffrera — nulle part ailleurs.
    expect(JSON.stringify({ ...entry, content: undefined })).not.toContain("18h");
  });
});

describe("REQ-OBX-08 — le store est enregistré au registre de wipe de la Session", () => {
  it("s'enregistre sous le nom outbox", () => {
    expect(ctx.session.registerWipe).toHaveBeenCalledWith("outbox", expect.any(Function));
  });

  it("le wipe vide la file en mémoire et sur disque", async () => {
    ctx.client.sendEvent.mockRejectedValue(matrixError("M_FORBIDDEN", 403));
    await outbox.enqueue(ROOM, message("un"), "t1");
    await outbox.flush();
    expect(outbox.pending(ROOM)).toHaveLength(1);

    await ctx.runWipes();
    expect(outbox.pending(ROOM)).toEqual([]);

    outbox.dispose();
    const rechargé = await createOutbox(ctx.session, { indexedDB: ctx.indexedDB });
    expect(rechargé.pending(ROOM)).toEqual([]);
    rechargé.dispose();
  });
});
