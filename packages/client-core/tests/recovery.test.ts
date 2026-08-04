import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { resetSdk, type CryptoMock } from "./mocks";
import { initSession, type SessionConfig } from "../src";

vi.mock("matrix-js-sdk", async () => (await import("./mocks")).sdkModule());

const config: SessionConfig = {
  homeserverUrl: "https://tacita.test",
  loginToken: "loginToken",
  indexedDB: new IDBFactory(),
};

let crypto: CryptoMock;

beforeEach(() => {
  ({ crypto } = resetSdk());
});

describe("REQ-COR-06 — clé de récupération E2EE obligatoire à l'inscription", () => {
  it("expose recoveryRequired quand aucun backup de clés n'est actif", async () => {
    crypto.getActiveSessionBackupVersion.mockResolvedValue(null);
    const session = await initSession(config);
    await expect(session.recoveryRequired()).resolves.toBe(true);
  });

  it("n'exige plus rien une fois le backup configuré", async () => {
    crypto.getActiveSessionBackupVersion.mockResolvedValue("1");
    const session = await initSession(config);
    await expect(session.recoveryRequired()).resolves.toBe(false);
  });

  it("setupRecoveryKey crée le backup et rend la clé à afficher à l'utilisateur", async () => {
    const session = await initSession(config);
    const key = await session.setupRecoveryKey();

    expect(crypto.bootstrapCrossSigning).toHaveBeenCalledOnce();
    expect(crypto.bootstrapSecretStorage).toHaveBeenCalledWith(
      expect.objectContaining({ setupNewKeyBackup: true }),
    );
    expect(key.encodedPrivateKey).toBe("EsTb ABCD EFGH");
  });

  it("échoue franchement si le secret storage existait déjà, sans inventer de clé", async () => {
    // Secret storage déjà provisionné : le SDK n'appelle pas notre fabrique.
    crypto.bootstrapSecretStorage.mockImplementation(async () => {});
    const session = await initSession(config);
    await expect(session.setupRecoveryKey()).rejects.toThrow(/aucune clé de récupération/);
  });

});
