import type { OutboxEntry } from "./entry";

const STORE = "entries";
const VERSION = 1;

const promisify = <T>(request: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

export interface OutboxStore {
  all(): Promise<OutboxEntry[]>;
  put(entry: OutboxEntry): Promise<void>;
  remove(txnId: string): Promise<void>;
  clear(): Promise<void>;
  close(): void;
}

/**
 * IndexedDB, un seul object store clé par `txnId`. Pas de
 * localStorage : le contenu en attente est du message utilisateur.
 *
 * L'API brute suffit ici (un store, quatre opérations) — une dépendance de
 * wrapper coûterait plus que les vingt lignes qu'elle remplacerait.
 */
export async function openOutboxStore(
  indexedDB: IDBFactory,
  dbName = "tacita-outbox",
): Promise<OutboxStore> {
  const request = indexedDB.open(dbName, VERSION);
  request.onupgradeneeded = () => {
    request.result.createObjectStore(STORE, { keyPath: "txnId" });
  };
  const db = await promisify(request);

  const reading = () => db.transaction(STORE, "readonly").objectStore(STORE);

  /**
   * « persisté avant toute tentative réseau » veut dire committé : le
   * `onsuccess` d'une requête précède le commit, qui peut encore avorter. Sur erreur,
   * `transaction.error` n'est pas encore posé quand `onerror` se déclenche — d'où le
   * repli, sans lequel on rejetterait avec `null`.
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
    // Une lecture qui a réussi a lu un état committé, et elle a besoin du résultat
    // que `oncomplete` ne porte pas : `promisify` reste le bon outil ici.
    all: () => promisify(reading().getAll() as IDBRequest<OutboxEntry[]>),
    put: (entry) => commit((store) => {
      store.put(entry);
    }),
    remove: (txnId) => commit((store) => {
      store.delete(txnId);
    }),
    clear: () => commit((store) => {
      store.clear();
    }),
    close: () => db.close(),
  };
}
