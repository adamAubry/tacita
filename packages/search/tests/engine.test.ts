import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it } from "vitest";

import { packageCode } from "./session-mock";

// Import direct : le moteur ne dépend pas de matrix-js-sdk, ces tests non plus.
import {
  BATCH_SIZE,
  createEngine,
  MAX_EVENTS,
  type IndexableEvent,
  type SearchEngine,
} from "../src/engine";

const ROOM = "!salon:tacita.test";
const AUTRE = "!autre:tacita.test";

const event = (n: number, body: string, roomId = ROOM, tsOrigin = n): IndexableEvent => ({
  eventId: `$e${n}`,
  roomId,
  sender: "@luca:tacita.test",
  tsOrigin,
  body,
});

let indexedDB: IDBFactory;
let engine: SearchEngine;

beforeEach(async () => {
  indexedDB = new IDBFactory();
  engine = await createEngine({ indexedDB });
});

describe("REQ-SRC-01 — index Orama alimenté par les événements déchiffrés", () => {
  it("indexe un lot et le retrouve par mot-clé", async () => {
    await engine.index([event(1, "rendez-vous au parc"), event(2, "courses ce soir")]);
    const hits = await engine.search("parc");
    expect(hits.map((hit) => hit.eventId)).toEqual(["$e1"]);
    expect(hits[0]).toMatchObject({ roomId: ROOM, body: "rendez-vous au parc" });
  });
});

describe("REQ-SRC-02 — index persisté, rechargé sans réindexation", () => {
  it("une recherche donne le même résultat après rechargement du module", async () => {
    await engine.index([event(1, "rendez-vous au parc")]);
    engine.close();

    const rechargé = await createEngine({ indexedDB });
    expect((await rechargé.search("parc")).map((hit) => hit.eventId)).toEqual(["$e1"]);
    expect((await rechargé.stats()).size).toBe(1);
    rechargé.close();
  });

  it("un index neuf sans snapshot ne trouve rien plutôt que d'échouer", async () => {
    expect(await engine.search("parc")).toEqual([]);
    expect(await engine.stats()).toMatchObject({ size: 0, oldestTs: null, newestTs: null });
  });
});

describe("REQ-SRC-04 — recherche globale et par salon", () => {
  beforeEach(async () => {
    await engine.index([
      event(1, "réunion demain", ROOM),
      event(2, "réunion annulée", AUTRE),
      event(3, "déjeuner", ROOM),
    ]);
  });

  it("cherche dans tous les salons par défaut", async () => {
    const hits = await engine.search("réunion");
    expect(hits.map((hit) => hit.eventId).sort()).toEqual(["$e1", "$e2"]);
  });

  it("restreint à un salon quand il est fourni", async () => {
    const hits = await engine.search("réunion", AUTRE);
    expect(hits.map((hit) => hit.eventId)).toEqual(["$e2"]);
  });

  it("rend une liste vide quand rien ne correspond", async () => {
    expect(await engine.search("licorne")).toEqual([]);
  });
});

describe("REQ-SRC-05 — plafond D-01 et éviction des plus anciens", () => {
  it("le plafond par défaut est celui de la décision D-01", () => {
    expect(MAX_EVENTS).toBe(200_000);
  });

  it("au-delà du plafond, les plus anciens sortent et les récents restent", async () => {
    // Plafond abaissé : indexer 200 001 documents réels prendrait des minutes pour
    // vérifier la même branche.
    const petit = await createEngine({ indexedDB: new IDBFactory(), maxEvents: 5 });
    // Un mot distinct par événement : Orama fait de l'OR sur les tokens, un corps
    // partagé rendrait le test incapable de distinguer l'évincé du reste.
    const mots = ["alpha", "bravo", "charlie", "delta", "echo", "foxtrot"];
    await petit.index(mots.map((mot, n) => event(n, mot, ROOM, n)));

    expect(await petit.stats()).toMatchObject({ size: 5, max: 5, oldestTs: 1, newestTs: 5 });
    expect(await petit.search("alpha")).toEqual([]);
    expect((await petit.search("foxtrot")).map((hit) => hit.eventId)).toEqual(["$e5"]);
    petit.close();
  });

  it("stats expose taille, plafond et bornes temporelles couvertes", async () => {
    await engine.index([event(1, "un", ROOM, 1_000), event(2, "deux", ROOM, 5_000)]);
    expect(await engine.stats()).toEqual({
      size: 2,
      max: MAX_EVENTS,
      oldestTs: 1_000,
      newestTs: 5_000,
    });
  });

  it("évince par ordre d'indexation, pas par date d'origine : un rattrapage survit", async () => {
    const petit = await createEngine({ indexedDB: new IDBFactory(), maxEvents: 2 });

    // D'abord deux messages récents, puis un rattrapage d'historique ancien — c'est
    // l'ordre réel d'une pagination arrière.
    await petit.index([event(1, "alpha", ROOM, 9_000), event(2, "bravo", ROOM, 9_500)]);
    await petit.index([event(3, "charlie", ROOM, 1_000)]);

    // Évincer par `tsOrigin` sortirait « charlie », qu'on vient de télécharger : le
    // rattrapage s'auto-évincerait et ne servirait à rien.
    expect((await petit.search("charlie")).map((hit) => hit.eventId)).toEqual(["$e3"]);
    expect(await petit.search("alpha")).toEqual([]);
    expect((await petit.stats()).oldestTs).toBe(1_000);
    petit.close();
  });
});

describe("REQ-SRC-10 — l'index suit le cycle de vie des messages", () => {
  it("un événement retiré n'est plus trouvable", async () => {
    await engine.index([event(1, "secret"), event(2, "anodin")]);
    await engine.remove(["$e1"]);

    expect(await engine.search("secret")).toEqual([]);
    expect((await engine.search("anodin")).map((hit) => hit.eventId)).toEqual(["$e2"]);
    expect((await engine.stats()).size).toBe(1);
  });

  it("le retrait survit au rechargement : le texte ne revient pas", async () => {
    await engine.index([event(1, "secret")]);
    await engine.remove(["$e1"]);
    engine.close();

    const rechargé = await createEngine({ indexedDB });
    expect(await rechargé.search("secret")).toEqual([]);
    rechargé.close();
  });

  it("retirer un identifiant inconnu ne casse rien", async () => {
    await engine.index([event(1, "anodin")]);
    await expect(engine.remove(["$jamais-vu"])).resolves.toBeUndefined();
    expect((await engine.stats()).size).toBe(1);
  });

  it("réindexer un identifiant connu remplace le document au lieu d'en ajouter un", async () => {
    await engine.index([event(1, "version initiale")]);
    await engine.index([event(1, "version corrigée")]);

    expect((await engine.stats()).size).toBe(1);
    expect(await engine.search("initiale")).toEqual([]);
    expect((await engine.search("corrigée")).map((hit) => hit.eventId)).toEqual(["$e1"]);
  });

  it("un remplacement garde la date d'origine du message, pas celle de la correction", async () => {
    await engine.index([event(1, "version initiale", ROOM, 1_000)]);
    await engine.index([event(1, "version corrigée", ROOM, 9_000)]);

    // Les bornes affichées décrivent la période des messages couverts, pas celle de
    // leurs corrections.
    expect(await engine.stats()).toMatchObject({ oldestTs: 1_000, newestTs: 1_000 });
  });
});

describe("REQ-SRC-07 — la rotation Megolm n'est pas un événement pour l'index", () => {
  it("aucun code ne réagit à une rotation de session ni ne réindexe", () => {
    expect(packageCode()).not.toMatch(/megolm|RoomKey|sessionId|reindex|réindex/i);
  });

  it("seuls la purge et wipe retirent quelque chose de l'index", async () => {
    await engine.index([event(1, "toujours là")]);
    expect((await engine.stats()).size).toBe(1);
    await engine.wipe();
    expect((await engine.stats()).size).toBe(0);
  });
});

describe("REQ-SRC-08 — wipe détruit l'index et son snapshot", () => {
  it("après wipe, plus aucun résultat et le store est vide au rechargement", async () => {
    await engine.index([event(1, "rendez-vous au parc")]);
    await engine.wipe();
    expect(await engine.search("parc")).toEqual([]);

    engine.close();
    const rechargé = await createEngine({ indexedDB });
    expect(await rechargé.search("parc")).toEqual([]);
    expect((await rechargé.stats()).size).toBe(0);
    rechargé.close();
  });
});

describe("REQ-SRC-09 — indexation par lots avec rendu de la main", () => {
  it("rend la main entre chaque lot, une fois de moins que de lots", async () => {
    let yields = 0;
    const parLots = await createEngine({
      indexedDB: new IDBFactory(),
      yieldTo: async () => {
        yields++;
      },
    });

    await parLots.index(
      Array.from({ length: BATCH_SIZE * 3 }, (_, n) => event(n, `message ${n}`)),
    );

    expect(yields).toBe(2);
    expect((await parLots.stats()).size).toBe(BATCH_SIZE * 3);
    parLots.close();
  });

  it("un lot unique ne rend pas la main pour rien", async () => {
    let yields = 0;
    const petit = await createEngine({
      indexedDB: new IDBFactory(),
      yieldTo: async () => {
        yields++;
      },
    });
    await petit.index([event(1, "un")]);
    expect(yields).toBe(0);
    petit.close();
  });
});
