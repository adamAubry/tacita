import {
  count,
  create,
  getByID,
  insertMultiple,
  load,
  remove,
  removeMultiple,
  save,
  search,
  updateMultiple,
} from "@orama/orama";

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
  // Deux horodatages, deux usages, jamais interchangeables (spec 09).
  tsIndexed: "number",
  tsOrigin: "number",
  body: "string",
} as const;

export interface IndexableEvent {
  eventId: string;
  roomId: string;
  sender: string;
  /**
   * `origin_server_ts`. Sert **uniquement** aux bornes de `stats()` (REQ-SRC-06) :
   * jamais à trier, jamais à évincer (interdit n°6).
   */
  tsOrigin: number;
  body: string;
}

/**
 * Le document tel qu'il vit dans l'index. `tsIndexed` est posé ici et jamais par
 * l'appelant : c'est l'ordre d'indexation locale, **seul** critère d'éviction (D-01).
 * Évincer par `tsOrigin` ferait qu'un rattrapage d'historique — qui insère par
 * définition des événements anciens — s'auto-évincerait au premier plafond atteint.
 */
type IndexedDocument = {
  id: string;
  roomId: string;
  sender: string;
  tsIndexed: number;
  tsOrigin: number;
  body: string;
};

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
  /** REQ-SRC-10 — retire les documents redactés. Les identifiants inconnus sont ignorés. */
  remove(eventIds: string[]): Promise<void>;
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
  tsOrigin: hit.document.tsOrigin as number,
  body: hit.document.body as string,
  score: hit.score,
});

/** REQ-SRC-06 — bornes affichées : la date d'origine, celle qui parle à l'utilisateur. */
const edgeTs = async (db: Database, order: "ASC" | "DESC"): Promise<number | null> => {
  const results = await search(db, { limit: 1, sortBy: { property: "tsOrigin", order } });
  return (results.hits[0]?.document.tsOrigin as number | undefined) ?? null;
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

  /**
   * `tsIndexed` doit être **strictement croissant** : un lot entier s'insère dans la
   * même milliseconde, et `Date.now()` seul laisserait l'ordre d'éviction arbitraire à
   * l'intérieur d'un lot — donc pas FIFO, ce que D-01 exige. Un compteur qui ne recule
   * jamais départage les ex aequo sans cesser d'être un horodatage.
   *
   * ponytail: repart de l'horloge à chaque ouverture plutôt que du maximum stocké.
   * Une horloge qui recule entre deux sessions fausserait l'ordre d'éviction ; relire
   * le maximum de l'index au chargement le jour où ça compte.
   */
  let lastIndexed = 0;
  const nextIndexedAt = (): number => (lastIndexed = Math.max(Date.now(), lastIndexed + 1));

  /** DECISIONS D-01 — au-delà du plafond, les premiers indexés sortent. */
  const evict = async (): Promise<void> => {
    const excess = count(db) - maxEvents;
    if (excess <= 0) return;
    const oldest = await search(db, {
      limit: excess,
      sortBy: { property: "tsIndexed", order: "ASC" },
    });
    for (const hit of oldest.hits) await remove(db, hit.id);
  };

  return {
    // REQ-SRC-09 — par lots, avec rendu de la main : un sync de rattrapage ne doit
    // pas monopoliser le worker d'un bloc.
    async index(events) {
      for (let offset = 0; offset < events.length; offset += BATCH_SIZE) {
        // Un même identifiant peut apparaître deux fois dans un lot : une rafale de
        // sync livre souvent un message et son édition ensemble, et l'édition porte
        // l'identifiant de sa cible. Orama refuse deux insertions du même id et
        // rejetterait le lot entier — la dernière version l'emporte.
        const batch = new Map<string, IndexableEvent>();
        for (const event of events.slice(offset, offset + BATCH_SIZE)) {
          batch.set(event.eventId, event);
        }

        const fresh: IndexedDocument[] = [];
        const replaced: IndexedDocument[] = [];

        for (const { eventId, ...rest } of batch.values()) {
          const previous = getByID(db, eventId) as IndexedDocument | undefined;
          // REQ-SRC-10 — réindexer un événement connu **remplace** son document au lieu
          // d'en créer un second. C'est ce qui fait qu'une édition ne laisse pas
          // l'ancienne version trouvable (le proxy indexe une édition sous l'identifiant
          // de sa cible), et ça rend le re-déchiffrement d'un événement inoffensif.
          //
          // Les deux horodatages restent ceux du premier passage : l'éviction suit
          // l'ordre d'indexation (D-01), et les bornes de stats() la date d'origine du
          // message — pas celle de sa dernière correction.
          if (previous) {
            replaced.push({ ...previous, ...rest, tsOrigin: previous.tsOrigin });
          } else {
            fresh.push({ id: eventId, ...rest, tsIndexed: nextIndexedAt() });
          }
        }

        if (fresh.length > 0) await insertMultiple(db, fresh);
        if (replaced.length > 0) {
          await updateMultiple(
            db,
            replaced.map((document) => document.id),
            replaced,
          );
        }

        // Purge à chaque lot, pas à la fin : un rattrapage massif ne doit pas tenir
        // tout l'historique en mémoire avant d'évincer. Sous le plafond, l'appel
        // court-circuite sur une soustraction.
        await evict();
        if (offset + BATCH_SIZE < events.length) await yieldTo();
      }
      await persist();
    },

    // REQ-SRC-10 — le texte d'un message supprimé ne doit plus être trouvable. Les
    // identifiants inconnus sont filtrés : on redacte aussi des messages que l'index
    // n'a jamais vus (média, échec de déchiffrement), ce n'est pas une erreur.
    async remove(eventIds) {
      const known = eventIds.filter((eventId) => getByID(db, eventId));
      if (known.length === 0) return;
      await removeMultiple(db, known);
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
