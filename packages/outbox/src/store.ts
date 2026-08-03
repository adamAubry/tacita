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
 * REQ-OBX-01/06 — IndexedDB, un seul object store clé par `txnId`. Pas de
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

  const objectStore = (mode: IDBTransactionMode) =>
    db.transaction(STORE, mode).objectStore(STORE);

  return {
    all: () => promisify(objectStore("readonly").getAll() as IDBRequest<OutboxEntry[]>),
    put: async (entry) => {
      await promisify(objectStore("readwrite").put(entry));
    },
    remove: async (txnId) => {
      await promisify(objectStore("readwrite").delete(txnId));
    },
    clear: async () => {
      await promisify(objectStore("readwrite").clear());
    },
    close: () => db.close(),
  };
}
