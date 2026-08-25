import { vi } from "vitest";

/**
 * matrix-js-sdk instrumenté (spec 04 — « suite Vitest avec matrix-js-sdk
 * mocké/instrumenté »). Chaque fichier de test fait :
 *
 *   vi.mock("matrix-js-sdk", async () => (await import("./mocks")).sdkModule());
 *
 * L'état est reconstruit à chaque test via `resetSdk()` : `initSession` verrouille
 * `setDeviceIsolationMode` en non-configurable (REQ-COR-07), un objet partagé entre
 * tests serait donc figé dès le premier.
 */

export type CryptoMock = ReturnType<typeof makeCrypto>;
export type ClientMock = ReturnType<typeof makeClient>;

const state: { crypto: CryptoMock; client: ClientMock } = {
  crypto: null as unknown as CryptoMock,
  client: null as unknown as ClientMock,
};

export const createClient = vi.fn((_opts: unknown) => state.client);

export const IndexedDBStore = vi.fn((opts: unknown) => ({
  opts,
  startup: vi.fn(async () => {}),
}));

export const sdkModule = () => ({ createClient, IndexedDBStore });

function makeCrypto() {
  return {
    /**
     * REQ-COR-07 — `initSession` pose le mode puis remplace la méthode par le verrou
     * (`defineProperty`). Le spy ne survit donc pas à l'appel : on retient le mode
     * appliqué dans un champ, qui lui reste lisible.
     */
    isolationMode: undefined as unknown,
    setDeviceIsolationMode: vi.fn(function (this: CryptoMock, mode: unknown) {
      this.isolationMode = mode;
    }),
    getActiveSessionBackupVersion: vi.fn(async (): Promise<string | null> => "1"),
    /**
     * REQ-COR-06 — la source de `recoveryState()`. Par défaut l'appareil est signé :
     * le cas normal est une session déjà utilisable, et les tests qui veulent une porte
     * fermée le disent.
     */
    getDeviceVerificationStatus: vi.fn(
      async (_userId: string, _deviceId: string): Promise<{ signedByOwner: boolean } | null> => ({
        signedByOwner: true,
      }),
    ),
    /**
     * REQ-COR-06 — la seconde source de `recoveryState()`. `false` = ce compte n'a aucune
     * identité cross-signing, donc une inscription.
     *
     * C'est cette question-là et pas `getKeyBackupInfo()` : une sauvegarde peut exister
     * sans identité (inscription interrompue au dépôt), et aucune clé ne déverrouille
     * alors quoi que ce soit.
     */
    userHasCrossSigningKeys: vi.fn(async (): Promise<boolean> => false),
    getKeyBackupInfo: vi.fn(async (): Promise<unknown> => null),
    loadSessionBackupPrivateKeyFromSecretStorage: vi.fn(async () => {}),
    checkKeyBackupAndEnable: vi.fn(async () => null),
    isEncryptionEnabledInRoom: vi.fn(async (_roomId: string) => true),
    createRecoveryKeyFromPassphrase: vi.fn(async () => ({
      privateKey: new Uint8Array(32),
      encodedPrivateKey: "EsTb ABCD EFGH",
    })),
    /**
     * REQ-COR-06 — `authUploadDeviceSigningKeys` est typé ici parce que les tests d'UIA
     * le rappellent : c'est le SDK qui l'invoque en vrai, avec la requête à envoyer.
     */
    bootstrapCrossSigning: vi.fn(
      async (_opts: {
        setupNewCrossSigning?: boolean;
        authUploadDeviceSigningKeys?: (
          envoyer: (auth: unknown) => Promise<void>,
        ) => Promise<void>;
      }) => {},
    ),
    /**
     * Un secret storage déjà provisionné sur ce compte. Basculé par
     * `bootstrapSecretStorage` lui-même, pour qu'une seconde tentative rencontre l'état
     * que la première a laissé.
     */
    secretStorageAUneCle: false,
    /**
     * **Reproduit la garde du SDK épinglé**, `rust-crypto.js` v42.0.0 :
     *
     *     isNewSecretStorageKeyNeeded = setupNewSecretStorage || !(await hasAESKey())
     *
     * et `createSecretStorageKey` n'est appelé que si ce booléen est vrai.
     *
     * Le mock appelait la fabrique inconditionnellement. Il ne pouvait donc pas infirmer
     * l'hypothèse « le chemin de création est rejouable » — il la confirmait par
     * construction (règle 3), pendant qu'une seconde tentative levait pour de bon contre
     * le vrai SDK.
     */
    bootstrapSecretStorage: vi.fn(async function (
      this: CryptoMock,
      opts: {
        createSecretStorageKey?: () => Promise<unknown>;
        setupNewSecretStorage?: boolean;
      },
    ) {
      if (opts.setupNewSecretStorage || !this.secretStorageAUneCle) {
        await opts.createSecretStorageKey?.();
        this.secretStorageAUneCle = true;
      }
    }),
    // REQ-COR-07 / D-08 — `needsUserApproval` est le signal du SDK pour « cet
    // utilisateur a changé d'identité depuis qu'on l'a vue ». Faux par défaut : le cas
    // normal est qu'il ne se passe rien.
    getUserVerificationStatus: vi.fn(async (_userId: string) => ({
      needsUserApproval: false,
    })),
    pinCurrentUserIdentity: vi.fn(async (_userId: string) => {}),
  };
}

function makeClient(crypto: CryptoMock) {
  return {
    loginRequest: vi.fn(async (_data: unknown) => ({
      access_token: "syt_access",
      user_id: "@luca:tacita.test",
      device_id: "DEVICE1",
    })),
    initRustCrypto: vi.fn(async (_opts?: unknown) => {}),
    getCrypto: vi.fn((): CryptoMock | undefined => crypto),
    startClient: vi.fn(async (_opts?: unknown) => {}),
    /**
     * REQ-UIX-06 — la validation du jeton à la reprise. Elle réussit par défaut : les
     * tests qui veulent un jeton refusé le disent explicitement, et ceux qui n'en
     * parlent pas ne doivent pas se voir refuser une session valable.
     */
    whoami: vi.fn(async () => ({ user_id: "@luca:tacita.test" })),
    /**
     * REQ-COR-06 — le secret storage tel que `unlockRecovery` l'interroge : quelle clé
     * protège ce compte, et celle qu'on lui présente est-elle la bonne. `checkKey` accepte
     * par défaut ; les tests de saisie fausse la font refuser.
     */
    secretStorage: {
      getKey: vi.fn(async (): Promise<[string, unknown] | null> => ["cleId", { algorithm: "m.secret_storage.v1.aes-hmac-sha2" }]),
      checkKey: vi.fn(async (_key: Uint8Array, _info: unknown) => true),
    },
    /**
     * REQ-COR-06 — la page de repli SSO que `setupRecoveryKey` fait ouvrir quand Synapse
     * exige une UIA pour remplacer une identité. Même forme que le SDK.
     */
    getFallbackAuthUrl: vi.fn(
      (loginType: string, sessionId: string) =>
        `https://tacita.test/_matrix/client/v3/auth/${loginType}/fallback/web?session=${sessionId}`,
    ),
    getRoom: vi.fn((_roomId: string): unknown => null),
    /**
     * REQ-COR-13 — la pagination arrière du SDK. Elle rend le salon, et c'est
     * `oldState.paginationToken` — mis à `null` par le SDK quand il n'y a plus rien en
     * amont — qui dit si l'historique est épuisé.
     */
    scrollback: vi.fn(async (room: unknown, _limit?: number) => room),
    logout: vi.fn(async (_stop?: boolean) => ({})),
    clearStores: vi.fn(async () => {}),
  };
}

/** À appeler dans un `beforeEach`. Rend un état frais, déjà branché sur les mocks. */
export function resetSdk(): { crypto: CryptoMock; client: ClientMock } {
  vi.clearAllMocks();
  state.crypto = makeCrypto();
  state.client = makeClient(state.crypto);
  return { crypto: state.crypto, client: state.client };
}

/** Un `MatrixEvent` réduit à ce que le module en lit. */
export function fakeEvent(id: string, originServerTs: number) {
  return {
    getId: () => id,
    getRoomId: () => "!salon:tacita.test",
    getType: () => "m.room.message",
    getTs: () => originServerTs,
  };
}

/**
 * Une `Room` réduite à ce que le module en lit : sa timeline vive, et le jeton de
 * pagination de son ancien état (REQ-COR-13). Un jeton présent = il reste de l'historique
 * en amont ; `null` = début du salon.
 */
export function fakeRoom(events: unknown[], paginationToken: string | null = "t42") {
  return {
    getLiveTimeline: () => ({ getEvents: () => events }),
    oldState: { paginationToken },
  };
}
