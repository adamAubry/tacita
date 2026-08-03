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

  const objectStore = (mode: IDBTransactionMode) =>
    db.transaction(STORE, mode).objectStore(STORE);

  return {
    read: () => promisify(objectStore("readonly").get(KEY) as IDBRequest<RawData | undefined>),
    write: async (raw) => {
      await promisify(objectStore("readwrite").put(raw, KEY));
    },
    clear: async () => {
      await promisify(objectStore("readwrite").clear());
    },
    close: () => db.close(),
  };
}
