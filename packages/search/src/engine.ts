import { count, create, insertMultiple, load, remove, save, search } from "@orama/orama";

import { openSnapshot, type Snapshot } from "./snapshot";

/** DECISIONS D-01 — plafond dur, éviction des plus anciens au-delà. */
export const MAX_EVENTS = 200_000;

/** REQ-SRC-09 — taille d'un lot entre deux rendus de la main au worker. */
export const BATCH_SIZE = 500;

/**
 * Schéma minimal (spec 09) : de quoi retrouver l'événement et filtrer par salon.
 * Pas de facettes, pas de fuzzy — YAGNI tant que personne ne les demande.
 */
const schema = {
  // `enum` et non `string` : une propriété `string` est tokenisée et le `where`
  // devient une correspondance floue — un identifiant de salon doit filtrer à
  // l'égalité exacte (REQ-SRC-04). Ça les sort aussi de la recherche plein texte,
  // ce qui est voulu : chercher un mot ne doit pas matcher un identifiant.
  roomId: "enum",
  sender: "enum",
  ts: "number",
  body: "string",
} as const;

export interface IndexableEvent {
  eventId: string;
  roomId: string;
  sender: string;
  /** Horodatage local d'indexation : sert à l'ordre d'éviction, pas au tri d'affichage. */
  ts: number;
  body: string;
}

export interface SearchHit extends IndexableEvent {
  score: number;
}

export interface SearchStats {
  /** REQ-SRC-05 — nombre d'événements actuellement indexés. */
  size: number;
  /** Le plafond, pour que l'UI puisse dire « les plus anciens ont été évincés ». */
  max: number;
  /**
   * REQ-SRC-06 — bornes réellement couvertes. La recherche porte sur l'historique
   * téléchargé, pas sur celui du serveur : c'est ce couple que l'UI doit afficher
   * plutôt que laisser croire à une recherche exhaustive.
   */
  oldestTs: number | null;
  newestTs: number | null;
}

export interface EngineOptions {
  indexedDB: IDBFactory;
  /** Abaissable en test : indexer 200 001 documents réels prend des minutes. */
  maxEvents?: number;
  /** Rendu de la main entre deux lots. */
  yieldTo?: () => Promise<void>;
}

export interface SearchEngine {
  index(events: IndexableEvent[]): Promise<void>;
  search(query: string, roomId?: string): Promise<SearchHit[]>;
  stats(): Promise<SearchStats>;
  wipe(): Promise<void>;
  close(): void;
}

type Database = ReturnType<typeof create<typeof schema>>;

const toHit = (hit: { id: string; score: number; document: Record<string, unknown> }): SearchHit => ({
  eventId: hit.id,
  roomId: hit.document.roomId as string,
  sender: hit.document.sender as string,
  ts: hit.document.ts as number,
  body: hit.document.body as string,
  score: hit.score,
});

const edgeTs = async (db: Database, order: "ASC" | "DESC"): Promise<number | null> => {
  const results = await search(db, { limit: 1, sortBy: { property: "ts", order } });
  return (results.hits[0]?.document.ts as number | undefined) ?? null;
};

export async function createEngine(options: EngineOptions): Promise<SearchEngine> {
  const maxEvents = options.maxEvents ?? MAX_EVENTS;
  const yieldTo = options.yieldTo ?? (() => new Promise<void>((resolve) => setTimeout(resolve, 0)));

  const snapshot: Snapshot = await openSnapshot(options.indexedDB);
  let db: Database = create({ schema });

  // REQ-SRC-02 — l'index reprend là où il s'était arrêté ; pas de réindexation
  // complète au démarrage.
  const restored = await snapshot.read();
  if (restored) load(db, restored);

  /**
   * ponytail: snapshot complet à chaque appel d'`index`. Suffisant tant que
   * l'indexation se fait par vagues de sync ; passer à une écriture débattue par
   * un timer si le coût devient visible sur un gros index.
   */
  const persist = () => snapshot.write(save(db));

  /** DECISIONS D-01 — au-delà du plafond, les plus anciens sortent. */
  const evict = async (): Promise<void> => {
    const excess = count(db) - maxEvents;
    if (excess <= 0) return;
    const oldest = await search(db, {
      limit: excess,
      sortBy: { property: "ts", order: "ASC" },
    });
    for (const hit of oldest.hits) await remove(db, hit.id);
  };

  return {
    // REQ-SRC-09 — par lots, avec rendu de la main : un sync de rattrapage ne doit
    // pas monopoliser le worker d'un bloc.
    async index(events) {
      for (let offset = 0; offset < events.length; offset += BATCH_SIZE) {
        const batch = events.slice(offset, offset + BATCH_SIZE);
        await insertMultiple(
          db,
          batch.map(({ eventId, ...rest }) => ({ id: eventId, ...rest })),
        );
        if (offset + BATCH_SIZE < events.length) await yieldTo();
      }
      await evict();
      await persist();
    },

    // REQ-SRC-03/04 — mot-clé, tous salons ou un seul, strictement en local.
    async search(query, roomId) {
      const results = await search(db, {
        term: query,
        limit: 50,
        // Une propriété `enum` se filtre par opérateur explicite ; une valeur nue
        // serait lue caractère par caractère comme autant d'opérations.
        ...(roomId ? { where: { roomId: { eq: roomId } } } : {}),
      });
      return results.hits.map(toHit);
    },

    async stats() {
      return {
        size: count(db),
        max: maxEvents,
        oldestTs: await edgeTs(db, "ASC"),
        newestTs: await edgeTs(db, "DESC"),
      };
    },

    // REQ-SRC-08 — l'index contient du contenu déchiffré : la déconnexion le détruit.
    async wipe() {
      db = create({ schema });
      await snapshot.clear();
    },

    close: () => snapshot.close(),
  };
}
