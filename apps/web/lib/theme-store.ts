import type { ThemeMode } from "../components/foundation/primitives";

const BASE = "tacita-ui";
const STORE = "preferences";
const CLE = "theme";

/**
 * REQ-UI-03 — le choix de thème vit en **IndexedDB**. L'interdit n°2 ferme
 * localStorage pour les données utilisateur, et un réglage d'apparence en est une : il
 * dit quelque chose de la personne, et il n'y a pas de raison de lui faire une exception
 * parce qu'il est petit.
 *
 * Conséquence assumée (M-A) : la lecture est asynchrone, donc le mode n'est pas connu au
 * premier rendu. Le défaut sombre limite le flash aux utilisateurs en clair. Il n'existe
 * pas de sortie sans stockage synchrone — ne pas en chercher une.
 */
const ouvrir = (indexedDB: IDBFactory): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    const requete = indexedDB.open(BASE, 1);
    requete.onupgradeneeded = () => requete.result.createObjectStore(STORE);
    requete.onsuccess = () => resolve(requete.result);
    requete.onerror = () => reject(requete.error);
  });

const estMode = (valeur: unknown): valeur is ThemeMode =>
  valeur === "system" || valeur === "light" || valeur === "dark";

export async function lireTheme(indexedDB: IDBFactory): Promise<ThemeMode | undefined> {
  const base = await ouvrir(indexedDB);
  try {
    const valeur = await new Promise<unknown>((resolve, reject) => {
      const requete = base.transaction(STORE, "readonly").objectStore(STORE).get(CLE);
      requete.onsuccess = () => resolve(requete.result);
      requete.onerror = () => reject(requete.error);
    });
    return estMode(valeur) ? valeur : undefined;
  } finally {
    base.close();
  }
}

export async function ecrireTheme(indexedDB: IDBFactory, mode: ThemeMode): Promise<void> {
  const base = await ouvrir(indexedDB);
  try {
    await new Promise<void>((resolve, reject) => {
      // Le `onsuccess` de la requête précède le commit de la transaction, qui peut
      // encore avorter : on attend `oncomplete`, sinon un réglage « enregistré » peut
      // ne pas l'être. Même motif que packages/search/src/snapshot.ts.
      const transaction = base.transaction(STORE, "readwrite");
      transaction.objectStore(STORE).put(mode, CLE);
      transaction.oncomplete = () => resolve();
      transaction.onabort = transaction.onerror = () =>
        reject(transaction.error ?? new Error("transaction IndexedDB avortée"));
    });
  } finally {
    base.close();
  }
}
