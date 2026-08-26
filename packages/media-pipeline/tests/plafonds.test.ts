import { describe, expect, it } from "vitest";

import {
  decryptAttachment,
  decryptAttachmentByChunks,
  encryptAttachment,
  MediaIntegrityError,
  SEUILS,
  verdictTaille,
  type Bytes,
} from "../src";

const Mio = 1024 * 1024;
const seuils = { inline: 10, dur: 100 };

describe("la décision de taille est une fonction pure, sans UI ni réseau", () => {
  it.each([
    [undefined, true, "inline"],
    [undefined, false, "inline"],
    [10, false, "inline"],
    [11, false, "telechargement"],
    [100, false, "telechargement"],
    [101, false, "refus"],
    // Avec un flux, le clair ne coexiste jamais avec lui-même : `dur` ne s'applique plus.
    [101, true, "telechargement"],
    [10 * Mio, true, "telechargement"],
  ])("taille %s, flux %s → %s", (taille, flux, attendu) => {
    expect(verdictTaille(taille, { flux, seuils })).toBe(attendu);
  });

  it("le mobile est plus bas des deux côtés, et `dur` reste au-dessus de `inline`", () => {
    expect(SEUILS.mobile.inline).toBeLessThan(SEUILS.bureau.inline);
    expect(SEUILS.mobile.dur).toBeLessThan(SEUILS.bureau.dur);
    for (const jeu of Object.values(SEUILS)) expect(jeu.dur).toBeGreaterThan(jeu.inline);
  });
});

describe("déchiffrement par tranches, vérification globale d'abord", () => {
  const env = { subtle: globalThis.crypto.subtle, getRandomValues: (b: Uint8Array) => globalThis.crypto.getRandomValues(b) };

  /** Assez long pour couvrir plusieurs tranches **et** une dernière tranche partielle. */
  const clair = new Uint8Array(Array.from({ length: 4096 + 37 }, (_u, i) => (i * 31) & 0xff)) as Bytes;

  const joindre = (morceaux: Uint8Array[]): Uint8Array => {
    const total = new Uint8Array(morceaux.reduce((n, m) => n + m.length, 0));
    let offset = 0;
    for (const morceau of morceaux) {
      total.set(morceau, offset);
      offset += morceau.length;
    }
    return total;
  };

  it("les tranches recollées donnent exactement le clair, quelle que soit la découpe", async () => {
    const { ciphertext, keys } = await encryptAttachment(clair, env);

    // 1024 tombe juste sur un bloc AES ; 1000 non, et c'est le cas qui décale un compteur
    // mal calculé — le pas est arrondi au multiple de 16 inférieur.
    for (const taille of [16, 1000, 1024, 65_536]) {
      const morceaux: Uint8Array[] = [];
      for await (const tranche of decryptAttachmentByChunks(ciphertext, keys, env.subtle, taille)) {
        morceaux.push(tranche);
      }
      expect(joindre(morceaux), `tranches de ${taille}`).toEqual(clair);
    }

    // Et le même résultat que le chemin d'un seul bloc, qui reste la référence.
    expect(await decryptAttachment(ciphertext, keys, env.subtle)).toEqual(clair);
  });

  it("un chiffré corrompu lève **avant** la première tranche, pas pendant", async () => {
    const { ciphertext, keys } = await encryptAttachment(clair, env);
    // `noUncheckedIndexedAccess` : l'octet est là, le compilateur ne le sait pas.
    ciphertext[2048] = (ciphertext[2048] ?? 0) ^ 0xff;

    const iterateur = decryptAttachmentByChunks(ciphertext, keys, env.subtle, 1024);
    // Le premier `next()` porte la vérification : aucun octet en clair n'a existé.
    await expect(iterateur.next()).rejects.toBeInstanceOf(MediaIntegrityError);
  });
});
