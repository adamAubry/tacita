import { readFileSync } from "node:fs";

import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it } from "vitest";

import {
  decryptAttachment,
  encryptAttachment,
  MediaIntegrityError,
  ouvrirCacheChiffre,
  type Bytes,
  type CacheChiffre,
} from "../src";

const octets = (taille: number, remplissage = 1): Bytes =>
  new Uint8Array(Array.from({ length: taille }, () => remplissage)) as Bytes;

let indexedDB: IDBFactory;
let cache: CacheChiffre;

beforeEach(async () => {
  indexedDB = new IDBFactory();
  cache = await ouvrirCacheChiffre(indexedDB, 1000);
});

describe("REQ-MED-16 — cache de ciphertext : ce qu'il garde, ce qu'il évince, ce qu'il oublie", () => {
  it("ce qui a été écrit se relit à l'identique", async () => {
    await cache.ecrire("mxc://tacita.test/a", octets(10, 7));
    expect([...(await cache.lire("mxc://tacita.test/a"))!]).toEqual([...octets(10, 7)]);
    expect(await cache.lire("mxc://tacita.test/inconnu")).toBeUndefined();
  });

  it("le cache survit à la fermeture : c'est ce qui évite le second téléchargement", async () => {
    await cache.ecrire("mxc://tacita.test/a", octets(10));
    cache.fermer();

    const rouvert = await ouvrirCacheChiffre(indexedDB, 1000);
    expect(await rouvert.lire("mxc://tacita.test/a")).toBeDefined();
  });

  it("l'éviction sort le moins récemment **lu**, pas le moins récemment écrit", async () => {
    await cache.ecrire("mxc://a", octets(400));
    await cache.ecrire("mxc://b", octets(400));
    // `a` est relu : c'est `b` qui devient le plus ancien, alors qu'il a été écrit après.
    await cache.lire("mxc://a");
    await cache.ecrire("mxc://c", octets(400));

    expect(await cache.lire("mxc://b")).toBeUndefined();
    expect(await cache.lire("mxc://a")).toBeDefined();
    expect(await cache.lire("mxc://c")).toBeDefined();
  });

  it("un blob plus gros que le budget n'entre pas, au lieu de tout évincer pour lui", async () => {
    await cache.ecrire("mxc://petit", octets(100));
    await cache.ecrire("mxc://enorme", octets(5000));

    expect(await cache.lire("mxc://enorme")).toBeUndefined();
    // Et il n'a rien emporté avec lui.
    expect(await cache.lire("mxc://petit")).toBeDefined();
  });

  it("réécrire la même URL ne s'évince pas soi-même", async () => {
    await cache.ecrire("mxc://a", octets(600));
    await cache.ecrire("mxc://a", octets(600, 2));
    expect([...(await cache.lire("mxc://a"))!]).toEqual([...octets(600, 2)]);
  });

  it("`vider` ne laisse rien — c'est ce que la déconnexion appelle", async () => {
    await cache.ecrire("mxc://a", octets(10));
    await cache.ecrire("mxc://b", octets(10));
    await cache.vider();

    expect(await cache.lire("mxc://a")).toBeUndefined();
    expect(await cache.lire("mxc://b")).toBeUndefined();
  });
});

describe("REQ-MED-16 / REQ-MED-08 — le cache ne voit que du chiffré, et ne dispense d'aucune vérification", () => {
  it("un chiffré empoisonné dans le cache échoue au hash, comme en transit", async () => {
    const { ciphertext, keys } = await encryptAttachment(octets(64, 3), {
      subtle: globalThis.crypto.subtle,
      getRandomValues: (cible) => void globalThis.crypto.getRandomValues(cible),
    });

    // Ce que le cache rendrait s'il avait été altéré sur le disque.
    const altere = new Uint8Array(ciphertext) as Bytes;
    altere[0] = (altere[0] ?? 0) ^ 0xff;

    await expect(decryptAttachment(altere, keys, globalThis.crypto.subtle)).rejects.toBeInstanceOf(
      MediaIntegrityError,
    );
    // Et l'original, lui, passe : le test ne prouve rien si les deux échouent.
    expect([...(await decryptAttachment(ciphertext, keys, globalThis.crypto.subtle))]).toEqual([
      ...octets(64, 3),
    ]);
  });

  it("le câblage inscrit le store au registre de wipe, et le pipeline lit le cache avant le réseau", () => {
    // Les deux moitiés de la jonction, lues à la source : sans l'inscription, un
    // demi-gigaoctet de chiffré survit à la déconnexion ; sans la lecture, le cache est
    // rempli et jamais interrogé (règle 7).
    const cablage = readFileSync(
      new URL("../../../apps/web/components/media/useMediaActions.ts", import.meta.url),
      "utf-8",
    );
    expect(cablage).toContain('session.registerWipe("media-cache", () => cache.vider())');

    const pipeline = readFileSync(new URL("../src/index.ts", import.meta.url), "utf-8");
    expect(pipeline).toContain("const enCache = await env.cache?.lire(url)");
  });
});
