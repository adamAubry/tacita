import type { Bytes } from "./attachments";

/**
 * **le cache de ciphertext, et rien d'autre que du ciphertext.**
 *
 * Ouvrir puis refermer trois fois la même vidéo, c'était trois téléchargements et trois
 * déchiffrements complets. Un `mxc://` désigne un blob immuable : ce qui a été téléchargé
 * une fois n'a aucune raison de l'être à nouveau.
 *
 * **Le clair ne touche jamais ce store**, ni aucun autre stockage persistant (interdit
 * n°8). Le chiffré, lui, est inerte sans les clés Megolm — ce n'est pas une
 * fuite de contenu. Ça reste une trace de qui a échangé quoi et quand sur une machine
 * partagée, et c'est pour ça que le store s'inscrit au registre de wipe.
 */

const BASE = "tacita-media-cache";
const STORE = "chiffres";
const VERSION = 1;

/** 500 Mo : de quoi tenir une conversation vivante, loin des quotas d'origine. */
export const BUDGET_DEFAUT = 500 * 1024 * 1024;

interface Entree {
  /** L'URL `mxc://`, qui **est** l'identité du blob : immuable, donc jamais invalidée. */
  url: string;
  octets: Bytes;
  taille: number;
  /**
   * Rang de dernier accès — la seule chose que l'éviction regarde.
   *
   * Un **compteur** et non une date : deux accès dans la même milliseconde donneraient
   * deux dates égales, et l'ordre d'éviction dépendrait alors de celui du `getAll`. Une
   * suite strictement croissante n'a pas d'ex æquo et ne dépend d'aucune horloge.
   */
  vuA: number;
}

export interface CacheChiffre {
  lire(url: string): Promise<Bytes | undefined>;
  ecrire(url: string, octets: Bytes): Promise<void>;
  /** ce que la déconnexion appelle. */
  vider(): Promise<void>;
  fermer(): void;
}

const promesse = <T>(requete: IDBRequest<T>): Promise<T> =>
  new Promise((resoudre, rejeter) => {
    requete.onsuccess = () => resoudre(requete.result);
    requete.onerror = () => rejeter(requete.error);
  });

export async function ouvrirCacheChiffre(
  indexedDB: IDBFactory,
  budget = BUDGET_DEFAUT,
): Promise<CacheChiffre> {
  const ouverture = indexedDB.open(BASE, VERSION);
  ouverture.onupgradeneeded = () => {
    ouverture.result.createObjectStore(STORE, { keyPath: "url" });
  };
  const base = await promesse(ouverture);

  const existantes = await promesse(
    base.transaction(STORE, "readonly").objectStore(STORE).getAll() as IDBRequest<Entree[]>,
  );
  // Reprend la suite là où la session précédente l'a laissée : l'ordre LRU survit donc à
  // une fermeture d'onglet, comme les entrées elles-mêmes.
  let horloge = existantes.reduce((max, entree) => Math.max(max, entree.vuA), 0);

  const commit = (muter: (store: IDBObjectStore) => void): Promise<void> =>
    new Promise((resoudre, rejeter) => {
      const transaction = base.transaction(STORE, "readwrite");
      muter(transaction.objectStore(STORE));
      transaction.oncomplete = () => resoudre();
      transaction.onabort = transaction.onerror = () =>
        rejeter(transaction.error ?? new Error("transaction IndexedDB avortée"));
    });

  return {
    async lire(url) {
      const entree = await promesse(
        base.transaction(STORE, "readonly").objectStore(STORE).get(url) as IDBRequest<Entree | undefined>,
      );
      if (!entree) return undefined;
      // Un accès rafraîchit le rang : c'est ce qui distingue le LRU d'une simple file.
      // Attendu, et non lancé de côté : une écriture en vol au moment de l'éviction
      // suivante ferait sortir l'entrée qu'on vient justement d'utiliser.
      await commit((store) => {
        store.put({ ...entree, vuA: (horloge += 1) });
      });
      return entree.octets;
    },

    async ecrire(url, octets) {
      /*
       * **Un blob plus gros que le budget n'entre pas**, au lieu de vider le cache pour
       * lui seul. C'est le cas d'une vidéo de 600 Mo reçue d'un client tiers : la mettre
       * en cache évincerait tout le reste pour un fichier qu'on ne rouvrira probablement
       * pas, et la prochaine ouverture repartirait de zéro de toute façon.
       */
      if (octets.length > budget) return;

      const toutes = await promesse(
        base.transaction(STORE, "readonly").objectStore(STORE).getAll() as IDBRequest<Entree[]>,
      );

      let total = toutes.reduce((somme, entree) => somme + entree.taille, 0) + octets.length;
      const aEvincer: string[] = [];
      // Du plus ancien accès au plus récent, jusqu'à repasser sous le budget.
      for (const entree of [...toutes].sort((a, b) => a.vuA - b.vuA)) {
        if (total <= budget) break;
        if (entree.url === url) continue;
        aEvincer.push(entree.url);
        total -= entree.taille;
      }

      await commit((store) => {
        for (const evincee of aEvincer) store.delete(evincee);
        store.put({ url, octets, taille: octets.length, vuA: (horloge += 1) } satisfies Entree);
      });
    },

    vider: () => commit((store) => {
      store.clear();
    }),


    fermer: () => base.close(),
  };
}
