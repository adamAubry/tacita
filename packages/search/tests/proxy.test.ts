import { readFileSync } from "node:fs";

import { IDBFactory } from "fake-indexeddb";
import { MatrixEventEvent } from "matrix-js-sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BUFFER_MS, createSearch, type Search } from "../src";
// Moteur et worker s'importent par leur module : le point d'entrée principal ne
// les réexporte pas, sinon Orama atterrirait dans le bundle du thread principal.
import { createEngine } from "../src/engine";
import { serve } from "../src/worker";
import { fakeSession, fakeWorker, matrixEvent, packageCode } from "./session-mock";

const ROOM = "!salon:tacita.test";

let ctx: ReturnType<typeof fakeSession>;
let worker: ReturnType<typeof fakeWorker>;
let search: Search;

beforeEach(async () => {
  ctx = fakeSession();
  // Le worker « fictif » relaie vers le vrai module worker : c'est le protocole
  // qu'on teste, pas l'API Worker du navigateur.
  worker = fakeWorker();
  serve(worker.inside, createEngine({ indexedDB: new IDBFactory() }));
  search = createSearch(ctx.session, worker.outside);
});

afterEach(() => {
  search.dispose();
  vi.useRealTimers();
});

describe("REQ-SRC-01 — indexation et requêtes déportées dans le worker", () => {
  it("index et search passent par des messages, pas par un appel direct", async () => {
    await search.index({
      eventId: "$e1",
      roomId: ROOM,
      sender: "@luca:tacita.test",
      ts: 1,
      body: "rendez-vous au parc",
    });

    expect(worker.posted.map((message) => message.method)).toEqual(["index"]);
    expect((await search.search("parc")).map((hit) => hit.eventId)).toEqual(["$e1"]);
  });

  it("un événement déchiffré alimente l'index sans que l'appelant s'en occupe", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });

    ctx.emitDecrypted(matrixEvent("$e1", ROOM, "réunion demain"));
    ctx.emitDecrypted(matrixEvent("$e2", ROOM, "réunion annulée"));
    expect(worker.posted).toHaveLength(0); // rien n'est parti pendant la rafale

    await vi.advanceTimersByTimeAsync(BUFFER_MS);
    vi.useRealTimers();
    await vi.waitFor(async () => expect(await search.stats()).toMatchObject({ size: 2 }));

    // REQ-SRC-09 — un seul message pour les deux événements de la rafale.
    expect(worker.posted.filter((message) => message.method === "index")).toHaveLength(1);
  });

  it("n'indexe ni les échecs de déchiffrement ni les événements sans corps", async () => {
    ctx.emitDecrypted(matrixEvent("$e1", ROOM, "visible"));
    ctx.emitDecrypted(matrixEvent("$e2", ROOM, "raté", { failed: true }));
    ctx.emitDecrypted(matrixEvent("$e3", ROOM, "", {}));
    ctx.emitDecrypted(matrixEvent("$e4", ROOM, "réaction", { type: "m.reaction" }));

    await vi.waitFor(async () => expect(await search.stats()).toMatchObject({ size: 1 }));
    expect((await search.search("visible")).map((hit) => hit.eventId)).toEqual(["$e1"]);
  });

  it("une erreur du worker remonte comme rejet, sans casser les appels suivants", async () => {
    const cassé = fakeWorker();
    serve(cassé.inside, Promise.reject(new Error("index illisible")));
    const fragile = createSearch(fakeSession().session, cassé.outside);

    await expect(fragile.stats()).rejects.toThrow("index illisible");
    fragile.dispose();
  });
});

describe("REQ-SRC-03 — aucune recherche n'émet d'appel réseau", () => {
  it("fetch et XMLHttpRequest ne sont pas touchés pendant une recherche", async () => {
    const fetchSpy = vi.fn();
    const xhrSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    vi.stubGlobal("XMLHttpRequest", class { open = xhrSpy; send = xhrSpy });

    await search.index({
      eventId: "$e1",
      roomId: ROOM,
      sender: "@luca:tacita.test",
      ts: 1,
      body: "hors ligne",
    });
    await search.search("hors ligne");
    await search.stats();

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(xhrSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("aucun code du package n'appelle l'endpoint /search de Synapse", () => {
    const code = packageCode();
    expect(code).not.toMatch(/_matrix\/client|\/search\b|fetch\(|XMLHttpRequest/);
    expect(code).not.toMatch(/client\.search|searchRoomEvents|backPaginateRoomEventsSearch/);
  });
});

describe("REQ-SRC-06 — le périmètre couvert est exposé pour l'UI", () => {
  it("stats donne de quoi dire « historique téléchargé », pas « tout l'historique »", async () => {
    await search.index([
      { eventId: "$e1", roomId: ROOM, sender: "@luca:tacita.test", ts: 1_000, body: "un" },
      { eventId: "$e2", roomId: ROOM, sender: "@luca:tacita.test", ts: 9_000, body: "deux" },
    ]);

    expect(await search.stats()).toEqual({
      size: 2,
      max: 200_000,
      oldestTs: 1_000,
      newestTs: 9_000,
    });
  });

  it("la limite est documentée plutôt que masquée", () => {
    const readme = readFileSync(new URL("../README.md", import.meta.url), "utf-8");
    expect(readme).toMatch(/historique téléchargé/i);
    expect(readme).toMatch(/\/search/);
  });
});

describe("REQ-SRC-08 — wipe enregistré au registre de la Session", () => {
  it("s'enregistre sous le nom search et vide l'index quand il est appelé", async () => {
    expect(ctx.session.registerWipe).toHaveBeenCalledWith("search", expect.any(Function));

    await search.index({
      eventId: "$e1",
      roomId: ROOM,
      sender: "@luca:tacita.test",
      ts: 1,
      body: "secret",
    });
    await ctx.runWipes();

    expect(await search.search("secret")).toEqual([]);
    expect((await search.stats()).size).toBe(0);
  });

  it("dispose détache le hook de déchiffrement", () => {
    search.dispose();
    expect(ctx.client.off).toHaveBeenCalledWith(MatrixEventEvent.Decrypted, expect.any(Function));
  });
});
