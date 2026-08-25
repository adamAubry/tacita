import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { encodeRecoveryKey } from "matrix-js-sdk/lib/crypto-api";

import { resetSdk, type ClientMock, type CryptoMock } from "./mocks";
import { creerCompte, initSession, type SessionConfig } from "../src";

vi.mock("matrix-js-sdk", async () => (await import("./mocks")).sdkModule());

const config: SessionConfig = {
  homeserverUrl: "https://tacita.test",
  identifiant: "adam",
  motDePasse: "motdepasse-essai",
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

  /*
   * Ce test affirmait l'inverse — « l'inscription ne demande aucune confirmation : le
   * premier dépôt passe sans UIA » — et son `envoyer` ne levait jamais. Il ne prouvait
   * donc rien de Synapse : il prouvait le mock (règle 3).
   *
   * MSC3967 n'est pas activé sur ce déploiement — ni par défaut en v1.155.0, ni dans
   * `infra/synapse/homeserver.yaml.tmpl`, qui ne porte aucun `experimental_features`.
   * L'inscription prend donc le 401 comme la réinitialisation, et le rappel d'UIA est
   * son chemin normal, pas son chemin d'exception. Escalade E-22.
   */
  it("l'inscription passe elle aussi par la ré-authentification : MSC3967 n'est pas activé", async () => {
    const { appels, envoyer } = envoyerQuiDemandeUneUia([{ stages: ["m.login.sso"] }]);
    crypto.bootstrapCrossSigning.mockImplementation(async (opts) => {
      await opts.authUploadDeviceSigningKeys?.(envoyer);
    });

    const vues: string[] = [];
    const session = await initSession(config);
    const cle = await session.setupRecoveryKey({
      confirmerIdentite: async (url) => {
        vues.push(url);
      },
    });

    expect(vues).toHaveLength(1);
    expect(appels).toEqual([null, { session: "sessionUia" }]);
    // Et la clé est bel et bien rendue : l'UIA franchie, l'inscription aboutit.
    expect(cle.encodedPrivateKey).toBe("EsTb ABCD EFGH");
  });

  /*
   * **Le point mort remonté par l'utilisateur, en un test.**
   *
   * Première tentative : le secret storage et la sauvegarde sont écrits, puis le dépôt de
   * l'identité échoue (UIA abandonnée, fenêtre fermée, réseau). Le compte porte désormais
   * un secret storage et aucune identité.
   *
   * Seconde tentative : avec `setupNewSecretStorage: false`, le SDK ne rappelait plus la
   * fabrique, `generated` restait vide, et la fonction levait « secret storage déjà
   * initialisé » — à chaque essai, sans issue. La seule sortie était « j'ai perdu ma clé »,
   * proposée à quelqu'un qui n'en avait jamais eu.
   */
  it("une inscription interrompue au dépôt de l'identité se rejoue, sans point mort", async () => {
    const session = await initSession(config);

    crypto.bootstrapCrossSigning.mockRejectedValueOnce(new Error("dépôt interrompu"));
    await expect(session.setupRecoveryKey()).rejects.toThrow(/dépôt interrompu/);
    // La première tentative a bien laissé un secret storage derrière elle.
    expect(crypto.secretStorageAUneCle).toBe(true);

    // La seconde repart d'une clé neuve plutôt que de buter sur celle qui traîne.
    const cle = await session.setupRecoveryKey();
    expect(cle.encodedPrivateKey).toBe("EsTb ABCD EFGH");
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

describe("REQ-COR-08 — l'inscription franchit toutes les étapes de l'UIA", () => {
  /*
   * **Le défaut trouvé le 25/08/2026 en montant la pile.** `creerCompte` ne franchissait
   * que `m.login.registration_token` et tenait le 401 suivant pour une panne : aucune
   * inscription n'aboutissait.
   *
   * Mesuré contre le vrai Synapse v1.155.0, et relu dans son code
   * (`_calculate_registration_flows`) : sans e-mail ni MSISDN configurés, la liste de base
   * vaut `[[m.login.dummy]]`, et `registration_requires_token` **préfixe** le jeton à
   * chaque flow. Le flow servi est donc `[m.login.registration_token, m.login.dummy]`.
   *
   * Ni la compilation ni la suite ne le voyaient — le mock répondait ce qu'on attendait.
   */
  const serveurEnDeuxEtapes = () => {
    const faits: string[] = [];
    return vi.fn(async (corps: { auth?: { type: string; token?: string } }) => {
      const etape = corps.auth?.type;
      if (etape === "m.login.registration_token" && corps.auth?.token === "JETON") {
        faits.push(etape);
      } else if (etape === "m.login.dummy" && faits.includes("m.login.registration_token")) {
        return { access_token: "syt_access", user_id: "@neuf:tacita.test", device_id: "DEV1" };
      }
      throw Object.assign(new Error("Unauthorized"), {
        httpStatus: 401,
        data: {
          session: "sessionUia",
          completed: [...faits],
          flows: [{ stages: ["m.login.registration_token", "m.login.dummy"] }],
        },
      });
    });
  };

  it("le jeton ne suffit pas : le stage suivant est franchi aussi", async () => {
    const registre = serveurEnDeuxEtapes();
    client.registerRequest = registre;

    const session = await creerCompte({ ...config, jetonInscription: "JETON" });

    expect(session).toBeTruthy();
    const types = registre.mock.calls.map((c) => c[0].auth?.type);
    expect(types).toEqual([undefined, "m.login.registration_token", "m.login.dummy"]);
  });

  it("un jeton refusé remonte, plutôt que de tourner en boucle", async () => {
    client.registerRequest = serveurEnDeuxEtapes();
    await expect(
      creerCompte({ ...config, jetonInscription: "MAUVAIS" }),
    ).rejects.toThrow(/Unauthorized/);
  });

  it("un flow qu'on ne sait pas franchir échoue franchement", async () => {
    // Un e-mail exigé : avancer dans ce flow ferait croire que ça progresse, et
    // s'arrêterait dans un cul-de-sac. On refuse au premier regard.
    client.registerRequest = vi.fn(async () => {
      throw Object.assign(new Error("Unauthorized"), {
        httpStatus: 401,
        data: { session: "s", flows: [{ stages: ["m.login.email.identity"] }] },
      });
    });
    await expect(
      creerCompte({ ...config, jetonInscription: "JETON" }),
    ).rejects.toThrow(/Unauthorized/);
  });
});

describe("REQ-COR-06 — recoveryState distingue l'inscription de la reconnexion", () => {
  it("un appareil signé par son propriétaire est prêt, sans rien demander au serveur", async () => {
    const session = await initSession(config);
    await expect(session.recoveryState()).resolves.toBe("prete");
    // Hors ligne, c'est exactement ce qui compte : la réponse ne coûte aucun appel.
    expect(crypto.userHasCrossSigningKeys).not.toHaveBeenCalled();
  });

  it("un appareil non signé sur un compte sans identité : c'est une inscription", async () => {
    appareilNonSigne();
    crypto.userHasCrossSigningKeys.mockResolvedValue(false);
    const session = await initSession(config);
    await expect(session.recoveryState()).resolves.toBe("creation");
  });

  it("un appareil non signé sur un compte qui a déjà son identité : déverrouillage, jamais création", async () => {
    // Le défaut réparé : chaque reconnexion OIDC donne un `device_id` neuf, donc un
    // appareil non signé. Répondre « création » proposait d'écraser l'identité.
    appareilNonSigne();
    crypto.userHasCrossSigningKeys.mockResolvedValue(true);
    const session = await initSession(config);
    await expect(session.recoveryState()).resolves.toBe("deverrouillage");
  });

  /*
   * **La sauvegarde ne décide pas.** C'est l'état qu'une inscription interrompue laisse
   * derrière elle : `setupRecoveryKey` provisionne le secret storage *et la sauvegarde*
   * avant de déposer l'identité, et seul ce dépôt peut échouer sur une UIA.
   *
   * Lu sur la sauvegarde, cet état répondait `deverrouillage` : l'écran proposait de saisir
   * une clé qui n'ouvre rien — il n'y a aucune identité à redescendre — et le parcours
   * d'inscription devenait inatteignable. C'est le défaut remonté le 25/08/2026.
   */
  it("une sauvegarde sans identité reste une inscription, pas un déverrouillage", async () => {
    appareilNonSigne();
    crypto.getKeyBackupInfo.mockResolvedValue({ version: "1" });
    crypto.userHasCrossSigningKeys.mockResolvedValue(false);
    const session = await initSession(config);
    await expect(session.recoveryState()).resolves.toBe("creation");
  });

  it("serveur injoignable : déverrouillage, l'erreur ne penche jamais vers l'écrasement", async () => {
    appareilNonSigne();
    crypto.userHasCrossSigningKeys.mockRejectedValue(new Error("réseau"));
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
