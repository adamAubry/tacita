import { beforeEach, describe, expect, it, vi } from "vitest";

import { resetSdk, type ClientMock, type CryptoMock } from "./mocks";
import { initSession, type SessionConfig } from "../src";

vi.mock("matrix-js-sdk", async () => (await import("./mocks")).sdkModule());

const config: SessionConfig = {
  homeserverUrl: "https://tacita.test",
  loginToken: "loginToken",
  indexedDB: {} as IDBFactory,
};

let crypto: CryptoMock;
let client: ClientMock;

beforeEach(() => {
  ({ crypto, client } = resetSdk());
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

  it("verifyDevice délègue la vérification interactive au SDK", async () => {
    const session = await initSession(config);
    await session.verifyDevice("@luca:tacita.test", "DEVICE2");
    expect(crypto.requestDeviceVerification).toHaveBeenCalledWith("@luca:tacita.test", "DEVICE2");
    expect(client.getCrypto).toHaveBeenCalled();
  });
});
