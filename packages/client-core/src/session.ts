import {
  createClient,
  HttpApiEvent,
  IndexedDBStore,
  type MatrixClient,
  type MatrixEvent,
} from "matrix-js-sdk";
// La racine du SDK n'exporte pas les classes de `crypto-api` (seulement des types) et
// ce mode est une *valeur*, pas un type : le sous-chemin est le seul accès. Module
// léger, aucun wasm tiré avec lui.
// ponytail: casse si le SDK réorganise ses chemins ; repasser à la racine le jour où
// elle réexporte crypto-api.
import { decodeRecoveryKey, OnlySignedDevicesIsolationMode } from "matrix-js-sdk/lib/crypto-api";

import { createLogger } from "./logger";

/** Types dérivés du SDK : pas de réimport de sous-chemins internes. */
export type CryptoApi = NonNullable<ReturnType<MatrixClient["getCrypto"]>>;
export type RecoveryKey = Awaited<ReturnType<CryptoApi["createRecoveryKeyFromPassphrase"]>>;

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

/**
 * REQ-COR-06 — l'état de la clé de récupération **du point de vue de cet appareil-ci**,
 * en trois cas et pas deux. C'est la distinction qui manquait : un booléen « clé requise »
 * confond « ce compte n'a pas de clé » et « ce compte en a une, que cet appareil n'a pas
 * reçue ». Le second est le cas normal de toute reconnexion — chaque `m.login.token`
 * donne un `device_id` neuf — et le traiter comme le premier proposait de *créer* une clé
 * à quelqu'un qui en a déjà une, donc d'écraser sa sauvegarde.
 *
 * - `prete` — cet appareil est signé par l'identité de son propriétaire ; il peut chiffrer.
 * - `creation` — le compte n'a aucune sauvegarde : c'est l'inscription (REQ-UI-04).
 * - `deverrouillage` — la sauvegarde existe ; cet appareil attend la clé (`unlockRecovery`).
 */
export type RecoveryState = "prete" | "creation" | "deverrouillage";

/** Les deux cas de `setupRecoveryKey`. Voir le membre de `Session` pour le contrat. */
export interface SetupRecoveryOptions {
  reinitialiser?: boolean;
  /**
   * REQ-COR-06 — **le passage obligé du « j'ai perdu ma clé ».** Synapse laisse déposer
   * une identité cross-signing sans authentification la *première* fois (MSC3967), mais
   * exige une UIA pour en **remplacer** une (`rest/client/keys.py`, v1.155.0). Sans mot
   * de passe natif (REQ-INF-09), le seul flow proposé est `m.login.sso` : il n'a pas de
   * réponse à calculer, il se termine dans le navigateur, chez Keycloak.
   *
   * Le module rend donc l'URL et attend ; ouvrir une fenêtre est un geste d'UI, et il
   * doit partir d'un clic sous peine d'être bloqué comme pop-up. La promesse résolue
   * signifie « l'utilisateur a confirmé » ; rejetée, l'opération s'arrête là.
   *
   * Absent, un 401 remonte tel quel à l'appelant — c'était le défaut du 09/08/2026 :
   * `bootstrapCrossSigning` partait sans rappel, prenait le 401, et l'écran de
   * réinitialisation échouait après avoir déjà remplacé le secret storage.
   */
  confirmerIdentite?: (url: string) => Promise<void>;
}

/**
 * Le défi UIA `m.login.sso` d'une erreur, s'il y en a un — l'identifiant de session à
 * rejouer une fois l'utilisateur revenu.
 *
 * Lu en canard plutôt que par `instanceof MatrixError` : la suite mocke `matrix-js-sdk`
 * (spec 04) et n'exporte que ce que le module utilise vraiment. On ne fait ici que lire
 * la forme documentée de la réponse 401.
 *
 * Un flow à plusieurs étapes est ignoré volontairement : rejouer la session après le seul
 * SSO ne l'achèverait pas, et faire comme si serait une garantie qu'on n'offre pas.
 */
function defiSso(erreur: unknown): string | undefined {
  const { httpStatus, data } = (erreur ?? {}) as {
    httpStatus?: number;
    data?: { session?: string; flows?: { stages?: string[] }[] };
  };
  if (httpStatus !== 401) return undefined;
  const sso = data?.flows?.some(
    (flow) => flow.stages?.length === 1 && flow.stages[0] === "m.login.sso",
  );
  return sso ? data?.session : undefined;
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
   * REQ-COR-12 — état de chiffrement du salon, en **prédicat** : il rend `false`,
   * il ne lève jamais. Les gardes d'envoi des specs 05 et 07 s'appuient dessus.
   *
   * `false` tant que l'état est inconnu — avant le premier `/sync` abouti, ou si la
   * crypto n'est pas là. C'est le sens qu'on veut : dans le doute, on n'envoie pas.
   * Aucune mémorisation ici ; une garde qui ment est pire que pas de garde.
   */
  isEncrypted(roomId: string): Promise<boolean>;
  /**
   * REQ-COR-06 — l'état de la porte d'onboarding (spec 11). Voir {@link RecoveryState}
   * pour ce que chaque valeur engage.
   *
   * La question qu'il pose est **locale** : cet appareil porte-t-il la signature de son
   * propriétaire ? Le magasin crypto y répond sans réseau, et c'est ce qui rend la porte
   * juste hors ligne. L'ancienne source — « une version de sauvegarde est-elle active ? » —
   * ne le pouvait pas : le SDK ne la connaît qu'après l'avoir relue au serveur.
   */
  recoveryState(): Promise<RecoveryState>;
  /**
   * REQ-COR-06 — l'inscription : une clé neuve, la sauvegarde amorcée, le cross-signing
   * en place. Rend la clé **une seule fois**, à afficher (spec 11) ; elle n'est jamais
   * persistée.
   *
   * `reinitialiser` est le cas « j'ai perdu ma clé » : il remplace le secret storage et
   * l'identité cross-signing existants. **Il est destructif** — l'historique chiffré sous
   * l'ancienne sauvegarde devient définitivement illisible — et l'UI doit le dire avant
   * de l'appeler. Sans lui, une clé perdue est un compte mort sans recours.
   *
   * Ce cas-là **exige `confirmerIdentite`** : le serveur réclame une ré-authentification
   * SSO pour remplacer une identité, et sans rappel l'appel échoue sur un 401.
   */
  setupRecoveryKey(options?: SetupRecoveryOptions): Promise<RecoveryKey>;
  /**
   * REQ-COR-06 — **la deuxième connexion.** Déverrouille le secret storage avec la clé
   * que l'utilisateur a conservée, signe cet appareil de son identité cross-signing (sans
   * quoi D-08 le laisse muet *et* sourd), et rebranche la sauvegarde de clés.
   *
   * Lève, et c'est normatif : sur une clé malformée, sur une clé qui ne correspond pas au
   * secret storage du compte, sur un compte qui n'en a pas. Une saisie fausse acceptée en
   * silence débloquerait l'UI devant un client qui ne déchiffrera rien (interdit n°13).
   */
  unlockRecovery(encodedKey: string): Promise<void>;
  /**
   * REQ-COR-07 / D-08 — `true` quand cet utilisateur a **changé d'identité** depuis
   * qu'on l'a vue pour la première fois. Ses anciennes signatures ne valent alors plus
   * rien, et l'UI (spec 11) doit exiger une confirmation explicite avant tout nouvel
   * envoi vers lui — pas un avertissement ignorable.
   *
   * Le membre existe pour que le shard n'ait **rien à dériver lui-même** : la spec 00
   * lui interdit toute logique métier, et lire `needsUserApproval` sur le crypto en
   * serait.
   */
  identityResetOf(userId: string): Promise<boolean>;
  /**
   * REQ-COR-07 / D-08 — la confirmation explicite que l'exigence demande à l'UI, rendue
   * effective : elle épingle la nouvelle identité de cet utilisateur comme authentique,
   * et les envois vers lui repartent.
   *
   * Le pendant de `identityResetOf`. Sans lui, le shard détecterait la réinitialisation
   * sans pouvoir la lever autrement qu'en appelant le crypto lui-même — de la logique
   * métier dans la spec 11, que la spec 00 interdit.
   *
   * **Lève**, contrairement à `identityResetOf` : sur notre propre identifiant, ou sur
   * un utilisateur dont on n'a aucune identité. Une confirmation qui échoue en silence
   * ferait débloquer l'UI alors que le chiffrement refusera toujours.
   */
  confirmIdentityOf(userId: string): Promise<void>;
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

/** Type de l'argument, dérivé du SDK plutôt que réimporté. */
type DeviceIsolationMode = Parameters<CryptoApi["setDeviceIsolationMode"]>[0];

/**
 * REQ-COR-07 (D-08) — les clés Megolm ne sont partagées qu'avec les appareils que
 * leur propriétaire a signés de son identité cross-signing. Le mode est posé puis
 * verrouillé : toute tentative de le desserrer lève, plutôt que d'échouer en silence.
 *
 * Ce que ce mode déclenche dans le SDK, vérifié sur la version épinglée (42.0.0) :
 * `CollectStrategy.identityBasedStrategy()` au chiffrement — la confiance portée sur
 * l'identité, mot pour mot ce que D-08 décide — et `TrustRequirement.CrossSignedOrLegacy`
 * au déchiffrement, donc un événement venu d'un appareil non signé reste illisible.
 *
 * Le verrou ne porte **plus** sur `globalBlacklistUnverifiedDevices` : la doc du SDK
 * dit « Ignored when deviceIsolationMode is OnlySignedDevicesIsolationMode ». L'ancien
 * verrou protégeait donc un drapeau devenu sans effet, et le drapeau lui-même exigeait
 * des appareils *vérifiés* — la rédaction que D-08 a écartée. Corollaire : l'override
 * par salon (`Room.setBlacklistUnverifiedDevices`) ne mord plus non plus.
 */
function lockSignedDevicesOnly(crypto: CryptoApi): void {
  crypto.setDeviceIsolationMode(new OnlySignedDevicesIsolationMode());
  Object.defineProperty(crypto, "setDeviceIsolationMode", {
    value: (mode: DeviceIsolationMode) => {
      if (!(mode instanceof OnlySignedDevicesIsolationMode)) {
        throw new Error("REQ-COR-07 : le mode d'isolation des appareils est verrouillé");
      }
    },
    configurable: false,
    writable: false,
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

  /**
   * REQ-COR-06 — la clé de récupération que `setupRecoveryKey()` vient de générer.
   * Le SDK ne la conserve pas : il rappelle l'application chaque fois qu'il doit
   * déverrouiller le secret storage pour y écrire. Sans ce rappel,
   * `bootstrapSecretStorage` lève « No getSecretStorageKey callback supplied » et
   * **aucune inscription ne peut aboutir**.
   *
   * Elle ne vit qu'en mémoire, le temps de la session : la persister reviendrait à
   * garder la clé qui déverrouille tout à côté de ce qu'elle protège, et
   * `client-core/README.md` promet qu'elle n'est jamais persistée.
   */
  let recoveryKey: RecoveryKey | undefined;

  const client = createClient({
    baseUrl: config.homeserverUrl,
    accessToken: credentials.accessToken,
    userId: credentials.userId,
    deviceId: credentials.deviceId,
    store,
    cryptoCallbacks: {
      getSecretStorageKey: async ({ keys }) => {
        // Rien à rendre tant qu'aucune clé n'a été générée dans cette session : le
        // SDK bascule alors sur son propre chemin d'erreur, ce qui est correct.
        const privateKey = recoveryKey?.privateKey;
        const [keyId] = Object.keys(keys);
        return privateKey && keyId ? [keyId, privateKey] : null;
      },
    },
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
  // `cryptoDatabasePrefix` dérivé du `device_id` plutôt que le défaut fixe du SDK :
  // le magasin de clés appartient à un appareil, pas à un navigateur. Au rechargement
  // le `device_id` est le même, donc les clés sont retrouvées ; deux identités dans le
  // même profil ne se marchent plus dessus. Sans ça, le SDK refuse d'ouvrir un magasin
  // qui appartient à quelqu'un d'autre — « the account in the store doesn't match the
  // account in the constructor ».
  await client.initRustCrypto({
    useIndexedDB: true,
    cryptoDatabasePrefix: `matrix-js-sdk-${credentials.deviceId}`,
  });
  lockSignedDevicesOnly(requireCrypto(client));

  // REQ-COR-05 — ouvre la boucle /sync, du long-polling HTTP.
  await client.startClient({ initialSyncLimit: 20 });

  /*
   * REQ-UI-17 — **forcer l'écriture du store quand la page s'en va.**
   *
   * `IndexedDBStore` du SDK n'écrit son accumulateur de sync qu'une fois toutes les cinq
   * minutes (`WRITE_DELAY_MS`). Tout ce qui est arrivé depuis la dernière écriture n'est
   * nulle part sur disque : mesuré au navigateur le 08/08/2026, une conversation rouverte
   * hors ligne après rechargement était vide, alors que les messages venaient d'être lus
   * à l'écran. Une session de moins de cinq minutes ne laissait aucune trace.
   *
   * Les deux événements, et pas seulement `pagehide` : sur mobile, une application mise
   * en arrière-plan puis tuée par le système ne voit jamais `pagehide`.
   */
  const persister = () => {
    void client.store.save(true).catch(() => log.warn("écriture du store SDK échouée"));
  };
  const surVisibilite = () => {
    if (globalThis.document?.visibilityState === "hidden") persister();
  };
  globalThis.addEventListener?.("pagehide", persister);
  globalThis.document?.addEventListener("visibilitychange", surVisibilite);

  const wipes = new Map<string, () => Promise<void> | void>();

  return {
    client,

    timeline(roomId) {
      return {
        events: () => client.getRoom(roomId)?.getLiveTimeline().getEvents() ?? [],
      };
    },

    // REQ-COR-12 — prédicat, pas assertion : un salon dont on ne sait rien est traité
    // comme non chiffré. Le SDK peut lever si l'état n'est pas encore chargé, d'où le
    // `catch` — c'est le seul endroit où une exception vaut « je ne sais pas ».
    async isEncrypted(roomId) {
      try {
        return (await client.getCrypto()?.isEncryptionEnabledInRoom(roomId)) ?? false;
      } catch {
        return false;
      }
    },

    async recoveryState() {
      const crypto = requireCrypto(client);

      /*
       * La seule question qui décide vraiment : **cet appareil peut-il chiffrer ?**
       * `signedByOwner` dit qu'il porte la signature de l'identité cross-signing de son
       * propriétaire, ce que D-08 exige pour qu'il reçoive et envoie des clés Megolm.
       * C'est une lecture du magasin crypto local — aucun réseau, donc juste hors ligne,
       * là où « une sauvegarde est-elle active ? » rendait `true` à tort et refermait la
       * porte sur un appareil parfaitement configuré (mesuré au navigateur le 08/08/2026).
       */
      const appareil = await crypto.getDeviceVerificationStatus(
        credentials.userId,
        credentials.deviceId,
      );
      if (appareil?.signedByOwner) return "prete";

      /*
       * Non signé. Reste à savoir laquelle des deux étapes il lui faut, et **seul le
       * serveur le sait** : la sauvegarde du compte ne vit pas ici.
       *
       * Injoignable, on répond `deverrouillage`. Ce n'est pas neutre et c'est délibéré :
       * des deux erreurs possibles, celle-là ne coûte qu'un écran inutile à un compte
       * neuf, quand `creation` proposerait d'écraser la sauvegarde d'un compte qui en a
       * une. La création reste atteignable depuis l'écran de saisie, elle n'est pas
       * perdue — seulement placée derrière un geste explicite.
       */
      try {
        return (await crypto.getKeyBackupInfo()) ? "deverrouillage" : "creation";
      } catch {
        return "deverrouillage";
      }
    },

    async setupRecoveryKey({ reinitialiser = false, confirmerIdentite }: SetupRecoveryOptions = {}) {
      const crypto = requireCrypto(client);
      let generated: RecoveryKey | undefined;

      /*
       * **Le secret storage d'abord, le cross-signing ensuite** — l'ordre inverse ne
       * survit pas à `reinitialiser`. `resetCrossSigning` réexporte les nouvelles clés
       * d'identité vers le secret storage *courant* : lancé en premier, il les chiffrerait
       * avec l'ancienne clé 4S, celle que l'utilisateur vient précisément de perdre, et
       * `getSecretStorageKey` n'aurait rien à rendre. L'inscription, elle, s'accommode des
       * deux ordres — un seul chemin suffit donc aux deux cas.
       */
      await crypto.bootstrapSecretStorage({
        setupNewKeyBackup: true,
        setupNewSecretStorage: reinitialiser,
        createSecretStorageKey: async () => {
          generated = await crypto.createRecoveryKeyFromPassphrase();
          // Publiée aussitôt pour `getSecretStorageKey` : le SDK la redemande dans
          // la foulée, à l'intérieur de ce même `bootstrapSecretStorage`.
          recoveryKey = generated;
          return generated;
        },
      });

      if (!generated) {
        // Secret storage déjà provisionné sans passer par notre fabrique : on ne peut
        // pas rendre une clé qu'on n'a pas générée, et en inventer une serait pire.
        throw new Error("aucune clé de récupération générée : secret storage déjà initialisé");
      }

      await crypto.bootstrapCrossSigning({
        setupNewCrossSigning: reinitialiser,
        /*
         * Le dépôt de l'identité est la seule requête de tout le flux qui puisse demander
         * une UIA. On tente d'abord sans : c'est le chemin de l'inscription, que Synapse
         * laisse passer tant qu'aucune identité n'existe (MSC3967). Le 401 n'arrive donc
         * qu'en réinitialisation, et il n'est pas une panne — c'est la question posée.
         */
        authUploadDeviceSigningKeys: async (envoyer) => {
          try {
            return await envoyer(null);
          } catch (erreur) {
            const sessionUia = defiSso(erreur);
            if (sessionUia === undefined || !confirmerIdentite) throw erreur;
            await confirmerIdentite(client.getFallbackAuthUrl("m.login.sso", sessionUia));
            // Rien d'autre que la session : le SSO se prouve côté serveur, la page de
            // repli l'a déjà marquée franchie. Le client ne transporte aucun secret ici.
            return await envoyer({ session: sessionUia });
          }
        },
      });
      return generated;
    },

    async unlockRecovery(encodedKey) {
      const crypto = requireCrypto(client);

      // `decodeRecoveryKey` ne retire que les espaces ; une clé collée depuis un
      // gestionnaire de mots de passe traîne souvent un retour à la ligne. Il vérifie
      // ensuite préfixe, longueur et parité — une faute de frappe lève ici, avant tout
      // appel réseau.
      const privateKey = decodeRecoveryKey(encodedKey.replace(/\s+/g, ""));

      const cle = await client.secretStorage.getKey();
      if (!cle) throw new Error("ce compte n'a pas de clé de récupération à déverrouiller");
      const [, description] = cle;
      if (!(await client.secretStorage.checkKey(privateKey, description))) {
        // Une clé bien formée mais qui n'est pas celle du compte. Vérifié **avant**
        // d'amorcer quoi que ce soit : à moitié bootstrapé, l'appareil resterait dans un
        // état que rien ne sait rattraper.
        throw new Error("clé de récupération incorrecte");
      }

      // Publiée pour `getSecretStorageKey` : tout ce qui suit relit le secret storage.
      recoveryKey = { privateKey, encodedPrivateKey: encodedKey };

      // Importe l'identité cross-signing depuis le secret storage **et signe cet
      // appareil** : c'est ce geste-là qui le sort du silence de D-08. Aucune UIA en jeu,
      // les clés d'identité existent déjà côté serveur — on ne fait que les redescendre.
      await crypto.bootstrapCrossSigning({});

      await crypto.loadSessionBackupPrivateKeyFromSecretStorage();
      await crypto.checkKeyBackupAndEnable();

      // ponytail: pas de `restoreKeyBackup()` intégral — le SDK doc l'annonce à plusieurs
      // heures sur un gros compte, et la clé de sauvegarde étant désormais en magasin, il
      // va rechercher les clés manquantes message par message, à la première non-déchiffre.
      // Le jour où une restauration en tâche de fond est demandée, c'est un écran avec une
      // progression qu'il faut, pas un `await` de plus ici.
    },

    async identityResetOf(userId) {
      try {
        const statut = await requireCrypto(client).getUserVerificationStatus(userId);
        return statut.needsUserApproval;
      } catch {
        // Prédicat, comme `isEncrypted` : il ne remonte jamais d'exception à l'UI.
        //
        // Le repli est `false` — permissif — et c'est délibéré : **la protection ne
        // dépend pas de ce prédicat**. Si l'identité a réellement changé,
        // `OnlySignedDevicesIsolationMode` fait lever le chiffrement au moment de
        // l'envoi, que l'UI ait affiché son dialogue ou non. Ce membre sert à
        // *expliquer* le blocage, pas à le produire.
        //
        // Replier sur `true` bloquerait tout envoi vers cet utilisateur à la moindre
        // panne passagère du crypto — un déni de service pour un gain nul.
        return false;
      }
    },

    confirmIdentityOf(userId) {
      // `pinCurrentUserIdentity` — « accepting it as genuine » côté SDK. C'est le geste
      // qui rend effective la confirmation exigée par REQ-COR-07 ; sans lui, l'UI
      // pourrait détecter la réinitialisation sans jamais la lever.
      //
      // **Ce n'est pas un prédicat, et il ne rattrape rien.** Une confirmation qui
      // échoue en silence laisserait l'UI débloquer l'envoi alors que le crypto
      // refusera toujours. Le SDK lève dans deux cas — sur notre propre identifiant, et
      // sur un utilisateur dont on n'a aucune identité — et l'UI doit les voir.
      return requireCrypto(client).pinCurrentUserIdentity(userId);
    },

    registerWipe(name, wipe) {
      wipes.set(name, wipe);
    },

    // REQ-COR-10 — déconnexion = wipe complet : stores SDK + tout store applicatif
    // enregistré. L'effacement local ne dépend d'aucune réussite réseau, et l'échec
    // d'un store n'empêche pas les autres d'être effacés.
    async logout() {
      // Les écouteurs de persistance meurent avec la session : sans cela, une session
      // suivante dans la même page ferait écrire un store déjà effacé.
      globalThis.removeEventListener?.("pagehide", persister);
      globalThis.document?.removeEventListener("visibilitychange", surVisibilite);

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
    const session = await buildSession(credentials, config, saved);

    /*
     * REQ-UIX-06 — **valider le jeton avant de rendre la session.**
     *
     * Mesuré au navigateur le 08/08/2026 : jeton révoqué côté serveur, page rechargée,
     * et l'application se rouvrait entièrement — liste des conversations comprise. Les
     * credentials locaux suffisaient à démarrer, et plus rien ne demandait au serveur
     * s'ils valaient encore quelque chose. C'était écrit en commentaire ici comme une
     * limite assumée ; c'en était une trop grande.
     *
     * `whoami` est la question exacte, et sa réponse distingue les deux cas qui comptent :
     * un `M_UNKNOWN_TOKEN` est un refus, tout le reste est un serveur qu'on n'atteint pas.
     * Traiter le second comme le premier jetterait dehors quelqu'un qui a seulement perdu
     * le réseau — ce que REQ-UI-17 promet précisément de ne pas faire.
     */
    try {
      await session.client.whoami();
    } catch (error) {
      // `errcode` **et** `httpStatus` : selon le chemin d'erreur, le SDK expose l'un ou
      // l'autre, et un jeton refusé sous une forme qu'on ne reconnaît pas est un jeton
      // qu'on garde — exactement le défaut qu'on est en train de fermer.
      const { errcode, httpStatus } = error as { errcode?: string; httpStatus?: number };
      if (errcode === "M_UNKNOWN_TOKEN" || httpStatus === 401) {
        createLogger().warn("jeton refusé au démarrage, retour à l'OIDC");
        await saved.clear().catch(() => {});
        return null;
      }
      // Réseau absent : la session locale reste valable, c'est tout l'intérêt du hors-ligne.
    }

    return session;
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

/**
 * REQ-UIX-06 / REQ-COR-11 — **un jeton révoqué doit sortir de la session, pas la hanter.**
 *
 * Mesuré au navigateur le 08/08/2026 : jeton révoqué côté serveur, page rechargée —
 * l'application se rouvrait normalement et continuait de rendre une session morte. Rien
 * ne levait : `restoreSession` relit des credentials locaux qu'aucun appel n'a encore
 * démentis, et le refus du serveur arrive plus tard, dans la boucle /sync.
 *
 * `HttpApiEvent.SessionLoggedOut` est **le** signal du SDK pour ça, et il ne se déclenche
 * que sur un refus explicite du jeton (`M_UNKNOWN_TOKEN`). Un réseau absent ne l'émet
 * pas : c'est exactement la distinction qui manquait, et sans elle on jetait dehors
 * quelqu'un qui n'avait perdu que sa connexion.
 *
 * Le wipe reste celui de REQ-COR-10 : ce n'est pas à l'appelant de le réinventer.
 */
export function onSessionInvalidee(session: Session, rappel: () => void): () => void {
  const surRefus = (): void => {
    createLogger().warn("jeton refusé par le serveur, session locale effacée");
    void session.logout().catch(() => {});
    rappel();
  };
  session.client.on(HttpApiEvent.SessionLoggedOut, surRefus);
  return () => {
    session.client.off(HttpApiEvent.SessionLoggedOut, surRefus);
  };
}
