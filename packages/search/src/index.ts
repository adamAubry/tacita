import type { Session } from "@tacita/client-core";
import { MatrixEventEvent, RoomEvent, type MatrixEvent } from "matrix-js-sdk";

import type { IndexableEvent, SearchFilters, SearchHit, SearchStats } from "./engine";
import { ROOM_MENTION, type SearchRequest, type SearchResponse } from "./protocol";

/**
 * Ce point d'entrée ne réexporte volontairement ni le moteur ni `serve` : les
 * réexporter tirerait Orama et l'indexation dans le bundle du thread principal,
 * ce que le découpage en worker existe précisément pour éviter (REQ-SRC-01).
 * Le worker s'importe par `@tacita/search/worker`.
 */
export type { IndexableEvent, SearchFilters, SearchHit, SearchStats } from "./engine";
export { ROOM_MENTION } from "./protocol";

/** Fenêtre d'accumulation des événements déchiffrés avant un envoi au worker. */
export const BUFFER_MS = 250;

export interface Search {
  /** REQ-SRC-01 — indexation manuelle ; un événement ou un lot. */
  index(events: IndexableEvent | IndexableEvent[]): Promise<void>;
  /**
   * REQ-SRC-04/11 — mot-clé, restreint par les critères fournis (salon, expéditeur,
   * type, mentions, bornes de date). Sans critère, la recherche est globale ; un terme
   * vide avec des critères est légitime — c'est ce que fait l'onglet « Mentions ».
   */
  search(query: string, filters?: SearchFilters): Promise<SearchHit[]>;
  /** REQ-SRC-05/06 — taille, plafond et bornes réellement couvertes. */
  stats(): Promise<SearchStats>;
  wipe(): Promise<void>;
  dispose(): void;
}

/**
 * Ce qu'on retient d'un événement déchiffré. Rien d'autre n'entre dans l'index.
 *
 * REQ-SRC-10 — une édition n'est pas un nouveau message : elle est indexée sous
 * l'identifiant de **sa cible**, avec le texte de `m.new_content`. Le moteur remplace
 * alors le document existant, et l'ancienne version cesse d'être trouvable. Indexer
 * l'édition telle quelle laisserait deux documents, dont un au corps « * texte ».
 */
function indexable(event: MatrixEvent): IndexableEvent | undefined {
  if (event.getType() !== "m.room.message" || event.isDecryptionFailure()) return undefined;

  const content = event.getContent();
  const relation = content["m.relates_to"] as { rel_type?: unknown; event_id?: unknown } | undefined;
  const edited = relation?.rel_type === "m.replace";
  const source = (edited ? content["m.new_content"] : content) as
    | Record<string, unknown>
    | undefined;

  const eventId = edited ? relation?.event_id : event.getId();
  const body: unknown = source?.body;
  const roomId = event.getRoomId();
  if (typeof eventId !== "string" || !roomId) return undefined;
  if (typeof body !== "string" || body.length === 0) return undefined;

  return {
    eventId,
    roomId,
    sender: event.getSender() ?? "",
    tsOrigin: event.getTs(),
    body,
    // REQ-SRC-11 — une correction peut changer le type comme le texte : les deux se
    // relisent de `m.new_content`, avec le repli sur l'événement d'origine. `m.text`
    // par défaut : c'est ce que vaut un `m.room.message` sans `msgtype`.
    msgtype: typeof source?.msgtype === "string" ? source.msgtype : "m.text",
    mentions: mentionsOf((source?.["m.mentions"] ?? content["m.mentions"]) as MentionsField),
  };
}

type MentionsField = { user_ids?: unknown; room?: unknown } | undefined;

/**
 * REQ-SRC-11 — `m.mentions` est du contenu déchiffré : il ne quitte pas ce chemin, ne
 * passe par aucun log, et n'existe dans l'index que pour l'onglet « Mentions ».
 *
 * Le contenu vient du réseau : un `user_ids` qui n'est pas un tableau de chaînes est
 * ignoré plutôt que propagé dans l'index.
 */
function mentionsOf(field: MentionsField): string[] {
  const ids = Array.isArray(field?.user_ids)
    ? field.user_ids.filter((id): id is string => typeof id === "string")
    : [];
  return field?.room === true ? [...ids, ROOM_MENTION] : ids;
}

/**
 * REQ-SRC-01 — proxy du worker. Le `Worker` est fourni par l'appelant : ce package
 * ne connaît pas le bundler de l'application.
 *
 * REQ-SRC-07 — rien n'écoute les rotations de session Megolm. Une rotation ne
 * change pas ce qui a déjà été déchiffré et indexé ; la seule invalidation est la
 * purge D-01 ou `wipe()`.
 */
export function createSearch(session: Session, worker: Worker): Search {
  const pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();
  let nextId = 0;

  worker.onmessage = ({ data }: MessageEvent<SearchResponse>) => {
    const slot = pending.get(data.id);
    if (!slot) return;
    pending.delete(data.id);
    if (data.error === undefined) slot.resolve(data.result);
    else slot.reject(new Error(data.error));
  };

  const call = <T>(method: SearchRequest["method"], args: unknown[]): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
      worker.postMessage({ id, method, args } satisfies SearchRequest);
    });

  const index = (events: IndexableEvent | IndexableEvent[]) =>
    call<void>("index", [Array.isArray(events) ? events : [events]]);

  // REQ-SRC-09 — un sync de rattrapage déchiffre en rafale. On accumule sur une
  // fenêtre courte plutôt que de poster un message par événement.
  let buffer: IndexableEvent[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;

  const drain = (): void => {
    timer = undefined;
    if (buffer.length === 0) return;
    const batch = buffer;
    buffer = [];
    void index(batch);
  };

  const onDecrypted = (event: MatrixEvent): void => {
    const entry = indexable(event);
    if (!entry) return;
    buffer.push(entry);
    timer ??= setTimeout(drain, BUFFER_MS);
  };
  session.client.on(MatrixEventEvent.Decrypted, onDecrypted);

  /**
   * REQ-SRC-01 — **l'amorçage : ce que le client tient déjà.**
   *
   * L'écoute seule ne voit que ce qui se déchiffre *après* le branchement. Sur une
   * session rouverte, l'historique est relu depuis IndexedDB et déchiffré avant qu'on
   * arrive : sans cette passe, un index neuf resterait vide jusqu'au message suivant, et
   * la recherche ne trouverait rien de ce que l'utilisateur a sous les yeux.
   *
   * Le moteur remplace un document déjà connu par son identifiant (REQ-SRC-10) :
   * réindexer ce qui l'est déjà est donc sans effet, ce qui rend cette passe sûre à
   * chaque ouverture. Les événements non déchiffrés sont ignorés ici et rattrapés par
   * l'écouteur au moment où leur clé arrive.
   *
   * ponytail: la timeline vive de chaque salon, pas l'historique entier du store. C'est
   * ce que l'écran affiche, et la remontée d'historique (REQ-COR-13) fait entrer le reste
   * au fil du défilement. Élargir le jour où « chercher sans avoir remonté » devient un
   * besoin établi.
   */
  const amorcer = (): void => {
    const rooms = session.client.getRooms?.() ?? [];
    const connus: IndexableEvent[] = [];
    for (const room of rooms) {
      for (const event of room.getLiveTimeline().getEvents()) {
        const entry = indexable(event);
        if (entry) connus.push(entry);
      }
    }
    if (connus.length > 0) void index(connus);
  };
  amorcer();

  /**
   * REQ-SRC-10 — une suppression retire le document. Pas de tampon ici : une redaction
   * est une action utilisateur isolée, pas une rafale de sync, et la faire attendre
   * laisserait le texte trouvable pendant la fenêtre d'accumulation.
   *
   * ponytail: un retrait qui échoue n'est pas retenté — le document reste trouvable
   * jusqu'au prochain `wipe()`. Brancher une reprise le jour où le shard UI (spec 11)
   * expose un canal d'erreur ; ce package n'en a aucun aujourd'hui.
   */
  const onRedaction = (event: MatrixEvent): void => {
    const target = event.getAssociatedId();
    if (target) void call<void>("remove", [[target]]);
  };
  session.client.on(RoomEvent.Redaction, onRedaction);

  /** Ce qui n'est pas encore parti au worker. Le wipe doit l'oublier autant que dispose. */
  const resetBuffer = (): void => {
    if (timer) clearTimeout(timer);
    timer = undefined;
    buffer = [];
  };

  /**
   * REQ-SRC-08 — l'index est du contenu déchiffré : la déconnexion l'efface. Le tampon
   * se vide **avant** que le wipe parte, sinon son timer se déclenche après coup,
   * réindexe ce qu'il retenait, et le `persist()` du moteur réécrit du clair sur disque
   * une fois l'utilisateur déconnecté.
   */
  const wipe = async (): Promise<void> => {
    resetBuffer();
    await call<void>("wipe", []);
  };
  session.registerWipe("search", wipe);

  return {
    index,
    search: (query, filters) => call<SearchHit[]>("search", [query, filters]),
    stats: () => call<SearchStats>("stats", []),
    wipe,

    dispose() {
      resetBuffer();
      session.client.off(MatrixEventEvent.Decrypted, onDecrypted);
      session.client.off(RoomEvent.Redaction, onRedaction);
      pending.clear();
      worker.terminate();
    },
  };
}
