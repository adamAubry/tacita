import { createClient, IndexedDBStore, type MatrixClient, type MatrixEvent } from "matrix-js-sdk";

import { createLogger } from "./logger";

/** Types dérivés du SDK : pas de réimport de sous-chemins internes. */
export type CryptoApi = NonNullable<ReturnType<MatrixClient["getCrypto"]>>;
export type RecoveryKey = Awaited<ReturnType<CryptoApi["createRecoveryKeyFromPassphrase"]>>;
export type VerificationRequest = Awaited<ReturnType<CryptoApi["requestDeviceVerification"]>>;

export interface SessionConfig {
  /** Homeserver Synapse (spec 01), derrière le proxy TLS. */
  homeserverUrl: string;
  /**
   * REQ-COR-08 — jeton `m.login.token` émis à l'issue du flux OIDC du fournisseur
   * externe (spec 01). Le module ne connaît aucun secret utilisateur et
   * n'implémente aucune méthode d'authentification propre.
   */
  loginToken: string;
  /** REQ-COR-03 — surchargeable en test ; `globalThis.indexedDB` en navigateur. */
  indexedDB?: IDBFactory;
}

export interface OrderedTimeline {
  /**
   * REQ-COR-04 — ordre canonique du flux /sync, tel que le SDK l'a accumulé.
   * Aucun tri par `origin_server_ts` : l'horodatage est indicatif seulement.
   */
  events(): MatrixEvent[];
}

export interface Session {
  /** Accès contrôlé pour les autres packages : eux n'importent pas matrix-js-sdk. */
  readonly client: MatrixClient;
  timeline(roomId: string): OrderedTimeline;
  /**
   * REQ-COR-06 — `true` tant qu'aucun backup de clés n'est actif. L'UI d'onboarding
   * (spec 11) bloque dessus : sans clé de récupération, l'historique est perdu au
   * premier nouvel appareil.
   */
  recoveryRequired(): Promise<boolean>;
  setupRecoveryKey(): Promise<RecoveryKey>;
  verifyDevice(userId: string, deviceId: string): Promise<VerificationRequest>;
  /** REQ-COR-10 — un package déclare ici comment effacer ses propres stores. */
  registerWipe(name: string, wipe: () => Promise<void> | void): void;
  logout(): Promise<void>;
}

function requireCrypto(client: MatrixClient): CryptoApi {
  const crypto = client.getCrypto();
  if (!crypto) {
    throw new Error("crypto non initialisée : aucune session ne doit exister sans E2EE");
  }
  return crypto;
}

/**
 * REQ-COR-07 — les clés Megolm ne sont jamais partagées avec un appareil non
 * vérifié. Le réglage est activé puis verrouillé : toute tentative ultérieure de
 * le désarmer lève, plutôt que d'échouer en silence.
 *
 * Limite assumée : le SDK laisse un override par salon
 * (`Room.setBlacklistUnverifiedDevices`) qui prime sur ce réglage global — aucun
 * package Tacita ne l'appelle, voir README.md.
 */
function lockUnverifiedDeviceBlacklist(crypto: CryptoApi): void {
  crypto.globalBlacklistUnverifiedDevices = true;
  Object.defineProperty(crypto, "globalBlacklistUnverifiedDevices", {
    get: () => true,
    set: () => {
      throw new Error("REQ-COR-07 : la politique d'appareils non vérifiés est verrouillée");
    },
    configurable: false,
    enumerable: true,
  });
}

export async function initSession(config: SessionConfig): Promise<Session> {
  const log = createLogger();

  // REQ-COR-08 — `loginWithToken` est déprécié : il ne reporte pas le `device_id`,
  // indispensable à la crypto. On fait la requête, puis on construit le client
  // définitif avec les credentials complets.
  const auth = createClient({ baseUrl: config.homeserverUrl });
  const credentials = await auth.loginRequest({
    type: "m.login.token",
    token: config.loginToken,
  });

  // REQ-COR-03 — IndexedDB est le seul store de persistance : historique consultable
  // hors ligne. localStorage/sessionStorage ne sont jamais touchés.
  const store = new IndexedDBStore({
    indexedDB: config.indexedDB ?? globalThis.indexedDB,
    dbName: "tacita",
  });
  await store.startup();

  const client = createClient({
    baseUrl: config.homeserverUrl,
    accessToken: credentials.access_token,
    userId: credentials.user_id,
    deviceId: credentials.device_id,
    store,
  });

  // REQ-COR-01 — vodozemac via le SDK (`initRustCrypto`), libolm interdit.
  // REQ-COR-02 — la crypto est prête avant que quoi que ce soit puisse être envoyé :
  // le client n'est rendu à l'appelant qu'après cette étape, donc aucun contenu ne
  // peut sortir en clair. Olm pour la négociation entre appareils, Megolm pour les
  // salons, rotation des sessions : gérés nativement par le SDK, rien à réécrire.
  await client.initRustCrypto({ useIndexedDB: true });
  lockUnverifiedDeviceBlacklist(requireCrypto(client));

  // REQ-COR-05 — ouvre la boucle /sync, du long-polling HTTP.
  await client.startClient({ initialSyncLimit: 20 });

  const wipes = new Map<string, () => Promise<void> | void>();

  return {
    client,

    timeline(roomId) {
      return {
        events: () => client.getRoom(roomId)?.getLiveTimeline().getEvents() ?? [],
      };
    },

    async recoveryRequired() {
      return (await requireCrypto(client).getActiveSessionBackupVersion()) === null;
    },

    async setupRecoveryKey() {
      const crypto = requireCrypto(client);
      let generated: RecoveryKey | undefined;

      await crypto.bootstrapCrossSigning({});
      await crypto.bootstrapSecretStorage({
        setupNewKeyBackup: true,
        createSecretStorageKey: async () => {
          generated = await crypto.createRecoveryKeyFromPassphrase();
          return generated;
        },
      });

      if (!generated) {
        // Secret storage déjà provisionné sans passer par notre fabrique : on ne peut
        // pas rendre une clé qu'on n'a pas générée, et en inventer une serait pire.
        throw new Error("aucune clé de récupération générée : secret storage déjà initialisé");
      }
      return generated;
    },

    verifyDevice(userId, deviceId) {
      return requireCrypto(client).requestDeviceVerification(userId, deviceId);
    },

    registerWipe(name, wipe) {
      wipes.set(name, wipe);
    },

    // REQ-COR-10 — déconnexion = wipe complet : stores SDK + tout store applicatif
    // enregistré. L'effacement local ne dépend d'aucune réussite réseau, et l'échec
    // d'un store n'empêche pas les autres d'être effacés.
    async logout() {
      try {
        await client.logout(true);
      } catch {
        log.warn("révocation du jeton côté serveur échouée, wipe local poursuivi");
      }

      for (const [name, wipe] of wipes) {
        try {
          await wipe();
        } catch {
          log.error("wipe d'un store applicatif échoué", { store: name });
        }
      }

      await client.clearStores();
    },
  };
}
