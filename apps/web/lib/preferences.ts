import type { ThemeMode } from "../components/foundation/primitives";

const BASE = "tacita-ui";
const STORE = "preferences";
const VERSION = 1;

/**
 * Les préférences d'interface vivent en **IndexedDB** (interdit n°2 : localStorage est
 * fermé aux données utilisateur, et un réglage en est une — il dit quelque chose de la
 * personne, et sa petite taille ne lui vaut pas d'exception).
 *
 * Une seule base pour toutes : le thème (REQ-UI-03) et le refus de l'écran d'éducation
 * iOS (REQ-UI-18) n'ont aucune raison d'avoir chacun la leur.
 *
 * Ce store ne contient **jamais de contenu déchiffré** : que des choix d'affichage.
 */
const ouvrir = (indexedDB: IDBFactory): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    const requete = indexedDB.open(BASE, VERSION);
    requete.onupgradeneeded = () => requete.result.createObjectStore(STORE);
    requete.onsuccess = () => resolve(requete.result);
    requete.onerror = () => reject(requete.error);
  });

export async function lirePreference(indexedDB: IDBFactory, cle: string): Promise<unknown> {
  const base = await ouvrir(indexedDB);
  try {
    return await new Promise<unknown>((resolve, reject) => {
      const requete = base.transaction(STORE, "readonly").objectStore(STORE).get(cle);
      requete.onsuccess = () => resolve(requete.result);
      requete.onerror = () => reject(requete.error);
    });
  } finally {
    base.close();
  }
}

export async function ecrirePreference(
  indexedDB: IDBFactory,
  cle: string,
  valeur: unknown,
): Promise<void> {
  const base = await ouvrir(indexedDB);
  try {
    await new Promise<void>((resolve, reject) => {
      // Le `onsuccess` de la requête précède le commit de la transaction, qui peut
      // encore avorter : on attend `oncomplete`, sinon un réglage « enregistré » peut ne
      // pas l'être. Même motif que packages/search/src/snapshot.ts.
      const transaction = base.transaction(STORE, "readwrite");
      transaction.objectStore(STORE).put(valeur, cle);
      transaction.oncomplete = () => resolve();
      transaction.onabort = transaction.onerror = () =>
        reject(transaction.error ?? new Error("transaction IndexedDB avortée"));
    });
  } finally {
    base.close();
  }
}

const estMode = (valeur: unknown): valeur is ThemeMode =>
  valeur === "system" || valeur === "light" || valeur === "dark";

/** REQ-UI-03 — une valeur inattendue est ignorée, pas propagée : on retombe au défaut. */
export async function lireTheme(indexedDB: IDBFactory): Promise<ThemeMode | undefined> {
  const valeur = await lirePreference(indexedDB, "theme");
  return estMode(valeur) ? valeur : undefined;
}

export const ecrireTheme = (indexedDB: IDBFactory, mode: ThemeMode) =>
  ecrirePreference(indexedDB, "theme", mode);

/**
 * REQ-UI-18 — l'écran d'éducation iOS n'est **jamais** re-présenté après un refus
 * explicite. Insister est le plus court chemin vers un utilisateur qui n'écoute plus.
 */
export const lireRefusEducationIOS = async (indexedDB: IDBFactory) =>
  (await lirePreference(indexedDB, "education-ios-refusee")) === true;

export const ecrireRefusEducationIOS = (indexedDB: IDBFactory) =>
  ecrirePreference(indexedDB, "education-ios-refusee", true);

/**
 * REQ-UI-18 — même règle pour l'invitation à activer les notifications : écartée une
 * fois, elle ne revient pas d'elle-même. Les réglages restent le chemin de rattrapage.
 */
export const lireRefusInvitePush = async (indexedDB: IDBFactory) =>
  (await lirePreference(indexedDB, "invite-push-refusee")) === true;

export const ecrireRefusInvitePush = (indexedDB: IDBFactory) =>
  ecrirePreference(indexedDB, "invite-push-refusee", true);

/**
 * REQ-UI-13 / REQ-RCP-07 — le mode masqué. **Un réglage d'appareil**, pas de compte :
 * le rendre synchronisé le poserait en account data, que le serveur lit en clair.
 *
 * Le défaut est `false` : les reçus normaux. Un mode masqué activé par défaut donnerait
 * un produit qui ne montre jamais « lu » sans que personne l'ait demandé.
 */
export const lireModeMasque = async (indexedDB: IDBFactory) =>
  (await lirePreference(indexedDB, "mode-masque")) === true;

export const ecrireModeMasque = (indexedDB: IDBFactory, masque: boolean) =>
  ecrirePreference(indexedDB, "mode-masque", masque);

/**
 * REQ-UIX-35 / REQ-UI-20 — le fond d'écran d'une conversation, **sur cet appareil**.
 *
 * Non synchronisé, et le libellé de l'écran le dit — un fond retrouvé sur un seul
 * téléphone n'est pas un bug si on l'a annoncé. Une clé par salon, pour que la remise à
 * zéro d'une conversation n'emporte pas les autres.
 *
 * **Des octets et un type MIME, pas un `Blob`.** Un vrai IndexedDB sait garder un blob ;
 * le `fake-indexeddb` de la suite de tests ne le rend pas — il en fait un objet vide, et
 * un fond d'écran devenu intestable serait un fond d'écran non prouvé. La conversion
 * coûte une ligne de chaque côté, et l'appelant continue de voir un `Blob`.
 */
const cleFond = (roomId: string) => `fond-ecran:${roomId}`;

interface FondEnregistre {
  octets: ArrayBuffer;
  type: string;
}

export async function lireFondEcran(
  indexedDB: IDBFactory,
  roomId: string,
): Promise<Blob | undefined> {
  const valeur = (await lirePreference(indexedDB, cleFond(roomId))) as FondEnregistre | undefined;
  return valeur?.octets ? new Blob([valeur.octets], { type: valeur.type }) : undefined;
}

export const ecrireFondEcran = async (indexedDB: IDBFactory, roomId: string, image: Blob) =>
  ecrirePreference(indexedDB, cleFond(roomId), {
    octets: await image.arrayBuffer(),
    type: image.type,
  } satisfies FondEnregistre);

/** La réinitialisation exigée par REQ-UIX-35 : la clé retombe à `undefined`. */
export const effacerFondEcran = (indexedDB: IDBFactory, roomId: string) =>
  ecrirePreference(indexedDB, cleFond(roomId), undefined);
