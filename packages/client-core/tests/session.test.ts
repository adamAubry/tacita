import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createClient, IndexedDBStore, resetSdk, type ClientMock, type CryptoMock } from "./mocks";
import { initSession, type SessionConfig } from "../src";

vi.mock("matrix-js-sdk", async () => (await import("./mocks")).sdkModule());

const config: SessionConfig = {
  homeserverUrl: "https://tacita.test",
  loginToken: "loginToken-emis-par-keycloak",
  indexedDB: {} as IDBFactory,
};

const readSrc = (name: string) => readFileSync(new URL(`../src/${name}`, import.meta.url), "utf-8");
const sources = ["index.ts", "logger.ts", "session.ts"].map(readSrc).join("\n");

/** Les interdits portent sur ce que le module exécute, pas sur ce qu'il documente. */
const code = sources.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

/** Options passées au client définitif (le premier `createClient` ne sert qu'au login). */
const clientOpts = () => createClient.mock.calls[1]![0] as { store: { startup: unknown } };

let crypto: CryptoMock;
let client: ClientMock;

beforeEach(() => {
  ({ crypto, client } = resetSdk());
});

describe("REQ-COR-01 — crypto vodozemac via initRustCrypto, libolm interdit", () => {
  it("initSession initialise la crypto Rust", async () => {
    await initSession(config);
    expect(client.initRustCrypto).toHaveBeenCalledOnce();
    expect(client.initRustCrypto).toHaveBeenCalledWith({ useIndexedDB: true });
  });

  it("aucune session n'est rendue si la crypto n'est pas disponible", async () => {
    client.getCrypto.mockReturnValue(undefined);
    await expect(initSession(config)).rejects.toThrow(/crypto non initialisée/);
  });

  it("le graphe de dépendances installé ne contient pas libolm", () => {
    const lock = readFileSync(new URL("../../../pnpm-lock.yaml", import.meta.url), "utf-8");
    expect(lock).not.toMatch(/@matrix-org\/olm@/);
    expect(lock).not.toMatch(/(^|[/\s])olm@\d/m);
    // vodozemac est livré par ce paquet wasm : sa présence confirme le bon backend.
    expect(lock).toMatch(/@matrix-org\/matrix-sdk-crypto-wasm@/);
  });

  it("aucun code du module n'importe libolm", () => {
    expect(code).not.toMatch(/olm/i);
  });
});

describe("REQ-COR-02 — chiffrement sur l'appareil avant tout envoi réseau", () => {
  it("la crypto est prête avant que la boucle /sync ne démarre", async () => {
    await initSession(config);
    const cryptoReady = client.initRustCrypto.mock.invocationCallOrder[0]!;
    const syncStarted = client.startClient.mock.invocationCallOrder[0]!;
    expect(cryptoReady).toBeLessThan(syncStarted);
  });

  it("aucun client n'échappe au module si l'initialisation crypto échoue", async () => {
    client.initRustCrypto.mockRejectedValueOnce(new Error("wasm indisponible"));
    await expect(initSession(config)).rejects.toThrow("wasm indisponible");
    expect(client.startClient).not.toHaveBeenCalled();
  });
});

describe("REQ-COR-03 — persistance exclusivement IndexedDB", () => {
  it("le store passé au client est un IndexedDBStore démarré", async () => {
    await initSession(config);
    expect(IndexedDBStore).toHaveBeenCalledWith({
      indexedDB: config.indexedDB,
      dbName: "tacita",
    });
    expect(clientOpts().store.startup).toHaveBeenCalledOnce();
  });

  it("la crypto persiste elle aussi dans IndexedDB", async () => {
    await initSession(config);
    expect(client.initRustCrypto).toHaveBeenCalledWith({ useIndexedDB: true });
  });

  it("aucun code du module ne touche localStorage ni sessionStorage", () => {
    expect(code).not.toMatch(/localStorage|sessionStorage/);
  });
});

describe("REQ-COR-05 — /sync est du long-polling HTTP, jamais du WebSocket", () => {
  it("la boucle /sync est ouverte par startClient", async () => {
    await initSession(config);
    expect(client.startClient).toHaveBeenCalledWith({ initialSyncLimit: 20 });
  });

  it("ni le code ni la doc du package ne décrivent le transport comme du WebSocket", () => {
    const readme = readFileSync(new URL("../README.md", import.meta.url), "utf-8");
    expect(sources).not.toMatch(/web\s?socket/i);
    expect(readme).not.toMatch(/web\s?socket/i);
  });
});

describe("REQ-COR-07 — clés Megolm jamais partagées avec un appareil non vérifié", () => {
  it("le réglage est activé", async () => {
    await initSession(config);
    expect(crypto.globalBlacklistUnverifiedDevices).toBe(true);
  });

  it("le réglage est verrouillé : toute tentative de désarmement lève", async () => {
    await initSession(config);
    expect(() => {
      crypto.globalBlacklistUnverifiedDevices = false;
    }).toThrow(/REQ-COR-07/);
    expect(crypto.globalBlacklistUnverifiedDevices).toBe(true);
  });

  it("le module n'appelle jamais l'override par salon qui primerait dessus", () => {
    expect(code).not.toMatch(/setBlacklistUnverifiedDevices/);
  });
});

describe("REQ-COR-08 — authentification déléguée au flux OIDC externe", () => {
  it("consomme le jeton de connexion et construit le client avec ses credentials", async () => {
    await initSession(config);
    expect(client.loginRequest).toHaveBeenCalledWith({
      type: "m.login.token",
      token: config.loginToken,
    });
    expect(clientOpts()).toMatchObject({
      accessToken: "syt_access",
      userId: "@luca:tacita.test",
      deviceId: "DEVICE1",
    });
  });

  it("le module n'implémente ni ne stocke aucun mot de passe", () => {
    expect(code).not.toMatch(/password/i);
  });
});

describe("REQ-COR-10 — déconnexion = wipe complet des données locales", () => {
  it("efface les stores SDK et chaque store applicatif enregistré", async () => {
    const session = await initSession(config);
    const wipeSearch = vi.fn();
    const wipeOutbox = vi.fn(async () => {});
    session.registerWipe("search", wipeSearch);
    session.registerWipe("outbox", wipeOutbox);

    await session.logout();

    expect(client.logout).toHaveBeenCalledWith(true);
    expect(wipeSearch).toHaveBeenCalledOnce();
    expect(wipeOutbox).toHaveBeenCalledOnce();
    expect(client.clearStores).toHaveBeenCalledOnce();
  });

  it("l'échec d'un store n'empêche ni les autres ni l'effacement SDK", async () => {
    const session = await initSession(config);
    const wipeOk = vi.fn();
    session.registerWipe("cassé", () => {
      throw new Error("quota");
    });
    session.registerWipe("ok", wipeOk);

    await expect(session.logout()).resolves.toBeUndefined();
    expect(wipeOk).toHaveBeenCalledOnce();
    expect(client.clearStores).toHaveBeenCalledOnce();
  });

  it("le wipe local a lieu même si la révocation serveur échoue", async () => {
    const session = await initSession(config);
    const wipe = vi.fn();
    session.registerWipe("search", wipe);
    client.logout.mockRejectedValueOnce(new Error("hors ligne"));

    await session.logout();

    expect(wipe).toHaveBeenCalledOnce();
    expect(client.clearStores).toHaveBeenCalledOnce();
  });
});
