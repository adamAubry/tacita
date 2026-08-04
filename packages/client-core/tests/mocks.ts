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
    globalBlacklistUnverifiedDevices: false,
    getActiveSessionBackupVersion: vi.fn(async (): Promise<string | null> => "1"),
    isEncryptionEnabledInRoom: vi.fn(async (_roomId: string) => true),
    createRecoveryKeyFromPassphrase: vi.fn(async () => ({
      privateKey: new Uint8Array(32),
      encodedPrivateKey: "EsTb ABCD EFGH",
    })),
    bootstrapCrossSigning: vi.fn(async (_opts: unknown) => {}),
    bootstrapSecretStorage: vi.fn(
      async (opts: { createSecretStorageKey?: () => Promise<unknown> }) => {
        await opts.createSecretStorageKey?.();
      },
    ),
    requestDeviceVerification: vi.fn(async (userId: string, deviceId: string) => ({
      transactionId: `${userId}/${deviceId}`,
    })),
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
    getRoom: vi.fn((_roomId: string): unknown => null),
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

/** Une `Room` réduite à `getLiveTimeline().getEvents()`. */
export function fakeRoom(events: unknown[]) {
  return { getLiveTimeline: () => ({ getEvents: () => events }) };
}
