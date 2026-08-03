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

/** REQ-COR-11 — ce qu'il faut pour rouvrir la session, et rien de plus. */
interface StoredCredentials {
  accessToken: string;
  userId: string;
  deviceId: string;
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

const CREDENTIALS_DB = "tacita-session";
const CREDENTIALS_STORE = "credentials";
const CREDENTIALS_KEY = "current";

/**
 * REQ-COR-11 — les credentials en IndexedDB, seul stockage autorisé (interdit n°2).
 *
 * Ils y sont **en clair** : `initRustCrypto` tourne sans clé de pickle, donc l'état
 * crypto voisin — clés Megolm comprises — l'est déjà. Chiffrer le seul jeton en
 * laissant les clés à côté présenterait une garantie que le module n'offre pas
 * (interdit n°13). Limite et conditions pour la relever : README.md, à consigner en
 * `DECISIONS.md` (D-06) avant toute implémentation.
 *
 * ponytail: troisième copie du motif open/commit IndexedDB (avec outbox et search).
 * Le factoriser ici et l'exporter le jour où C3 et C4 sont tous deux sur main —
 * refactorer à cheval sur deux branches coûterait plus que la duplication.
 */
async function openCredentials(indexedDB: IDBFactory) {
  const request = indexedDB.open(CREDENTIALS_DB, 1);
  request.onupgradeneeded = () => {
    request.result.createObjectStore(CREDENTIALS_STORE);
  };
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

  // On attend `oncomplete` et non `onsuccess` : le succès d'une requête précède le
  // commit, qui peut encore avorter. Un jeton annoncé écrit mais absent au
  // rechargement renverrait l'utilisateur vers l'OIDC sans raison visible.
  const commit = (mutate: (store: IDBObjectStore) => void): Promise<void> =>
    new Promise((resolve, reject) => {
      const transaction = db.transaction(CREDENTIALS_STORE, "readwrite");
      mutate(transaction.objectStore(CREDENTIALS_STORE));
      transaction.oncomplete = () => resolve();
      transaction.onabort = transaction.onerror = () =>
        reject(transaction.error ?? new Error("transaction IndexedDB avortée"));
    });

  return {
    read: () =>
      new Promise<StoredCredentials | undefined>((resolve, reject) => {
        const query = db
          .transaction(CREDENTIALS_STORE, "readonly")
          .objectStore(CREDENTIALS_STORE)
          .get(CREDENTIALS_KEY);
        query.onsuccess = () => resolve(query.result as StoredCredentials | undefined);
        query.onerror = () => reject(query.error);
      }),
    write: (credentials: StoredCredentials) =>
      commit((store) => {
        store.put(credentials, CREDENTIALS_KEY);
      }),
    clear: () =>
      commit((store) => {
        store.clear();
      }),
  };
}

/** Le magasin, pas les credentials : `saved.read()`, pas `saved.accessToken`. */
type CredentialStore = Awaited<ReturnType<typeof openCredentials>>;

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

/**
 * Queue commune aux deux entrées : la seule différence entre une première connexion
 * et une reprise est l'origine des credentials.
 */
async function buildSession(
  credentials: StoredCredentials,
  config: Omit<SessionConfig, "loginToken">,
  saved: CredentialStore,
): Promise<Session> {
  const log = createLogger();

  // REQ-COR-03 — IndexedDB est le seul store de persistance : historique consultable
  // hors ligne. localStorage/sessionStorage ne sont jamais touchés.
  const store = new IndexedDBStore({
    indexedDB: config.indexedDB ?? globalThis.indexedDB,
    dbName: "tacita",
  });

  const client = createClient({
    baseUrl: config.homeserverUrl,
    accessToken: credentials.accessToken,
    userId: credentials.userId,
    deviceId: credentials.deviceId,
    store,
  });

  // `startup()` **après** l'affectation au client, jamais avant : le SDK lève
  // « must be called after assigning it to the client » quand il relit un store
  // existant. Sur une base vierge l'ordre inverse passe — c'est pourquoi ni la
  // suite sur mocks ni un premier lancement ne le voyaient, et pourquoi seule la
  // reprise de session (REQ-COR-11) échouait, à chaque fois.
  await store.startup();

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
      // REQ-COR-11 — les credentials partent en premier : si tout le reste échoue,
      // mieux vaut une session locale morte qu'un jeton qui survit à la déconnexion.
      try {
        await saved.clear();
      } catch {
        log.error("effacement des credentials échoué");
      }

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

export async function initSession(config: SessionConfig): Promise<Session> {
  // REQ-COR-08 — `loginWithToken` est déprécié : il ne reporte pas le `device_id`,
  // indispensable à la crypto. On fait la requête, puis on construit le client
  // définitif avec les credentials complets.
  const auth = createClient({ baseUrl: config.homeserverUrl });
  const login = await auth.loginRequest({ type: "m.login.token", token: config.loginToken });

  if (!login.device_id) {
    // Sans identité d'appareil, aucune session Megolm ne peut être établie : mieux
    // vaut échouer ici que rendre un client qui n'enverra jamais rien de chiffré.
    throw new Error("le homeserver n'a pas attribué de device_id : session refusée");
  }

  const credentials: StoredCredentials = {
    accessToken: login.access_token,
    userId: login.user_id,
    deviceId: login.device_id,
  };

  const saved = await openCredentials(config.indexedDB ?? globalThis.indexedDB);
  await saved.write(credentials);
  return buildSession(credentials, config, saved);
}

/**
 * REQ-COR-11 — rouvre la session précédente sans réseau : c'est ce qui rend
 * exploitables l'historique hors ligne (REQ-COR-03), la file d'envoi réhydratée
 * (spec 07) et l'index de recherche persisté (spec 09), qui survivent tous à un
 * rechargement mais qu'aucun chemin ne savait rouvrir.
 *
 * `null` n'est pas une erreur : c'est « aucune session locale, passe par l'OIDC »
 * (spec 11). Le jeton n'est pas validé ici — le valider demanderait le réseau, ce que
 * cette fonction existe précisément pour éviter. Un jeton révoqué se manifeste par un
 * `M_UNKNOWN_TOKEN` au premier appel, que le shard UI route vers l'OIDC.
 */
export async function restoreSession(
  config: Omit<SessionConfig, "loginToken">,
): Promise<Session | null> {
  const saved = await openCredentials(config.indexedDB ?? globalThis.indexedDB);
  const credentials = await saved.read();
  if (!credentials) return null;

  try {
    return await buildSession(credentials, config, saved);
  } catch (error) {
    // Restauration impossible : store crypto corrompu, wasm qui n'a pas chargé,
    // IndexedDB à moitié évincée. On rend `null` sans effacer — un échec de
    // chargement est souvent passager, et l'effacer forcerait un OIDC qui exige le
    // réseau, précisément ce que l'utilisateur hors ligne n'a pas. Si la panne est
    // définitive, l'OIDC réécrira ces credentials de toute façon : les détruire
    // ici n'achèterait rien et coûterait la tentative suivante.
    //
    // Mais un `null` muet est indiagnosticable : côté appelant il ne se distingue
    // pas d'un premier lancement. On journalise la raison — c'est un message
    // d'erreur technique, jamais du contenu déchiffré (REQ-COR-09).
    createLogger().error("reprise de session impossible, retour à l'OIDC", {
      raison: error instanceof Error ? error.message : "erreur inconnue",
    });
    return null;
  }
}
