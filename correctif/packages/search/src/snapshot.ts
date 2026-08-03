import type { RawData } from "@orama/orama";

const STORE = "index";
const KEY = "orama";
const VERSION = 1;

const promisify = <T>(request: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

export interface Snapshot {
  read(): Promise<RawData | undefined>;
  write(raw: RawData): Promise<void>;
  clear(): Promise<void>;
  close(): void;
}

/**
 * REQ-SRC-02 — l'index sérialisé vit en IndexedDB, sous une seule clé. Rien
 * d'autre : le contenu déchiffré n'a pas à traîner dans un stockage synchrone.
 */
export async function openSnapshot(
  indexedDB: IDBFactory,
  dbName = "tacita-search",
): Promise<Snapshot> {
  const request = indexedDB.open(dbName, VERSION);
  request.onupgradeneeded = () => {
    request.result.createObjectStore(STORE);
  };
  const db = await promisify(request);

  const reading = () => db.transaction(STORE, "readonly").objectStore(STORE);

  /**
   * Le `onsuccess` d'une requête précède le commit de sa transaction, qui peut encore
   * avorter : sans ça, `clear()` (REQ-SRC-08) résout avant que l'effacement soit
   * acquis. Sur erreur, `transaction.error` n'est pas encore posé quand `onerror` se
   * déclenche — d'où le repli, sans lequel on rejetterait avec `null`.
   */
  const commit = (mutate: (store: IDBObjectStore) => void): Promise<void> =>
    new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE, "readwrite");
      mutate(transaction.objectStore(STORE));
      transaction.oncomplete = () => resolve();
      transaction.onabort = transaction.onerror = () =>
        reject(transaction.error ?? new Error("transaction IndexedDB avortée"));
    });

  return {
    read: () => promisify(reading().get(KEY) as IDBRequest<RawData | undefined>),
    write: (raw) => commit((store) => {
      store.put(raw, KEY);
    }),
    clear: () => commit((store) => {
      store.clear();
    }),
    close: () => db.close(),
  };
}
