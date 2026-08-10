import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { encodeRecoveryKey } from "matrix-js-sdk/lib/crypto-api";

import { resetSdk, type ClientMock, type CryptoMock } from "./mocks";
import { initSession, type SessionConfig } from "../src";

vi.mock("matrix-js-sdk", async () => (await import("./mocks")).sdkModule());

const config: SessionConfig = {
  homeserverUrl: "https://tacita.test",
  loginToken: "loginToken",
  indexedDB: new IDBFactory(),
};

let crypto: CryptoMock;
let client: ClientMock;

/** Une vraie clé encodée : `decodeRecoveryKey` n'est pas mocké, il vérifie la parité. */
const CLE = encodeRecoveryKey(new Uint8Array(32).fill(7))!;

/** Cet appareil n'est pas encore signé par son propriétaire : la porte est fermée. */
const appareilNonSigne = () => crypto.getDeviceVerificationStatus.mockResolvedValue(null);

beforeEach(() => {
  ({ crypto, client } = resetSdk());
});

describe("REQ-COR-06 — clé de récupération E2EE obligatoire à l'inscription", () => {
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

  it("« j'ai perdu ma clé » remplace le secret storage et l'identité, dans cet ordre", async () => {
    // L'ordre est le fond du test : `resetCrossSigning` réexporte les nouvelles clés
    // d'identité vers le secret storage courant. Lancé avant que celui-ci soit remplacé,
    // il chiffrerait avec la clé que l'utilisateur vient de perdre.
    const appels: string[] = [];
    crypto.bootstrapSecretStorage.mockImplementation(async (opts) => {
      appels.push("secretStorage");
      await opts.createSecretStorageKey?.();
    });
    crypto.bootstrapCrossSigning.mockImplementation(async () => {
      appels.push("crossSigning");
    });

    const session = await initSession(config);
    await session.setupRecoveryKey({ reinitialiser: true });

    expect(appels).toEqual(["secretStorage", "crossSigning"]);
    expect(crypto.bootstrapSecretStorage).toHaveBeenCalledWith(
      expect.objectContaining({ setupNewSecretStorage: true }),
    );
    expect(crypto.bootstrapCrossSigning).toHaveBeenCalledWith(
      expect.objectContaining({ setupNewCrossSigning: true }),
    );
  });

  /*
   * L'UIA du remplacement d'identité. Synapse v1.155.0 laisse passer le **premier** dépôt
   * de clés de signature sans authentification (MSC3967) et exige une ré-authentification
   * pour en remplacer une : le 401 n'arrive donc qu'ici, et il n'est pas une panne.
   *
   * Le faux `envoyer` reproduit la forme exacte de la réponse de Synapse — un flow
   * `m.login.sso` à une seule étape, sans mot de passe natif (REQ-INF-09).
   */
  const envoyerQuiDemandeUneUia = (flows: { stages: string[] }[]) => {
    const appels: unknown[] = [];
    return {
      appels,
      envoyer: vi.fn(async (auth: unknown) => {
        appels.push(auth);
        if (auth !== null) return;
        throw Object.assign(new Error("Unauthorized"), {
          httpStatus: 401,
          data: { session: "sessionUia", flows },
        });
      }),
    };
  };

  it("le remplacement d'identité passe par la ré-authentification que le serveur exige", async () => {
    const { appels, envoyer } = envoyerQuiDemandeUneUia([{ stages: ["m.login.sso"] }]);
    crypto.bootstrapCrossSigning.mockImplementation(async (opts) => {
      await opts.authUploadDeviceSigningKeys?.(envoyer);
    });

    const vues: string[] = [];
    const session = await initSession(config);
    await session.setupRecoveryKey({
      reinitialiser: true,
      confirmerIdentite: async (url) => {
        vues.push(url);
      },
    });

    // L'utilisateur a été envoyé sur la page de repli du serveur, pour *cette* session.
    expect(vues).toEqual([
      "https://tacita.test/_matrix/client/v3/auth/m.login.sso/fallback/web?session=sessionUia",
    ]);
    // Premier essai sans auth (le chemin de l'inscription), puis rejeu avec la session.
    expect(appels).toEqual([null, { session: "sessionUia" }]);
  });

  it("l'inscription ne demande aucune confirmation : le premier dépôt passe sans UIA", async () => {
    const envoyer = vi.fn(async (_auth: unknown) => {});
    crypto.bootstrapCrossSigning.mockImplementation(async (opts) => {
      await opts.authUploadDeviceSigningKeys?.(envoyer);
    });

    const session = await initSession(config);
    const confirmerIdentite = vi.fn(async (_url: string) => {});
    await session.setupRecoveryKey({ confirmerIdentite });

    expect(envoyer).toHaveBeenCalledExactlyOnceWith(null);
    expect(confirmerIdentite).not.toHaveBeenCalled();
  });

  it("un défi que le SSO seul n'achève pas remonte, plutôt que d'ouvrir une page inutile", async () => {
    // Deux étapes : rejouer la session après le seul SSO ne terminerait pas l'UIA.
    // Faire comme si serait exactement ce que l'interdit n°13 refuse.
    const { envoyer } = envoyerQuiDemandeUneUia([{ stages: ["m.login.sso", "m.login.terms"] }]);
    crypto.bootstrapCrossSigning.mockImplementation(async (opts) => {
      await opts.authUploadDeviceSigningKeys?.(envoyer);
    });

    const session = await initSession(config);
    const confirmerIdentite = vi.fn(async (_url: string) => {});
    await expect(
      session.setupRecoveryKey({ reinitialiser: true, confirmerIdentite }),
    ).rejects.toThrow(/Unauthorized/);
    expect(confirmerIdentite).not.toHaveBeenCalled();
  });
});

describe("REQ-COR-06 — recoveryState distingue l'inscription de la reconnexion", () => {
  it("un appareil signé par son propriétaire est prêt, sans rien demander au serveur", async () => {
    const session = await initSession(config);
    await expect(session.recoveryState()).resolves.toBe("prete");
    // Hors ligne, c'est exactement ce qui compte : la réponse ne coûte aucun appel.
    expect(crypto.getKeyBackupInfo).not.toHaveBeenCalled();
  });

  it("un appareil non signé sur un compte sans sauvegarde : c'est une inscription", async () => {
    appareilNonSigne();
    crypto.getKeyBackupInfo.mockResolvedValue(null);
    const session = await initSession(config);
    await expect(session.recoveryState()).resolves.toBe("creation");
  });

  it("un appareil non signé sur un compte qui a déjà sa clé : déverrouillage, jamais création", async () => {
    // Le défaut réparé : chaque reconnexion OIDC donne un `device_id` neuf, donc un
    // appareil non signé. Répondre « création » proposait d'écraser la sauvegarde.
    appareilNonSigne();
    crypto.getKeyBackupInfo.mockResolvedValue({ version: "1" });
    const session = await initSession(config);
    await expect(session.recoveryState()).resolves.toBe("deverrouillage");
  });

  it("serveur injoignable : déverrouillage, l'erreur ne penche jamais vers l'écrasement", async () => {
    appareilNonSigne();
    crypto.getKeyBackupInfo.mockRejectedValue(new Error("réseau"));
    const session = await initSession(config);
    await expect(session.recoveryState()).resolves.toBe("deverrouillage");
  });
});

describe("REQ-COR-06 — unlockRecovery : la deuxième connexion", () => {
  it("signe cet appareil et rebranche la sauvegarde", async () => {
    const session = await initSession(config);
    await session.unlockRecovery(CLE);

    // Le geste qui sort l'appareil du silence de D-08.
    expect(crypto.bootstrapCrossSigning).toHaveBeenCalledWith({});
    expect(crypto.loadSessionBackupPrivateKeyFromSecretStorage).toHaveBeenCalledOnce();
    expect(crypto.checkKeyBackupAndEnable).toHaveBeenCalledOnce();
  });

  it("accepte une clé recopiée avec ses espaces et ses retours à la ligne", async () => {
    const session = await initSession(config);
    await expect(session.unlockRecovery(`  ${CLE.replace(/ /g, "\n")}  `)).resolves.toBeUndefined();
  });

  it("une clé malformée lève avant tout appel réseau", async () => {
    const session = await initSession(config);
    await expect(session.unlockRecovery("pas une clé")).rejects.toThrow();
    expect(crypto.bootstrapCrossSigning).not.toHaveBeenCalled();
  });

  it("une clé bien formée mais étrangère au compte lève sans rien amorcer", async () => {
    // Vérifié avant le bootstrap : à moitié amorcé, l'appareil resterait dans un état
    // que rien ne sait rattraper.
    client.secretStorage.checkKey.mockResolvedValue(false);
    const session = await initSession(config);
    await expect(session.unlockRecovery(CLE)).rejects.toThrow(/incorrecte/);
    expect(crypto.bootstrapCrossSigning).not.toHaveBeenCalled();
  });

  it("un compte sans secret storage lève, plutôt que de faire croire au déverrouillage", async () => {
    client.secretStorage.getKey.mockResolvedValue(null);
    const session = await initSession(config);
    await expect(session.unlockRecovery(CLE)).rejects.toThrow(/pas de clé de récupération/);
  });
});
