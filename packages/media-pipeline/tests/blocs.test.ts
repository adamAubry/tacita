import { describe, expect, it } from "vitest";

import {
  CHAMP_BLOCS,
  dechiffrerPlage,
  decryptAttachment,
  encryptAttachment,
  hachesParBloc,
  MediaIntegrityError,
  TAILLE_BLOC,
  type Bytes,
  type SourceChiffree,
} from "../src";

const env = {
  subtle: globalThis.crypto.subtle,
  getRandomValues: (cible: Uint8Array) => void globalThis.crypto.getRandomValues(cible),
};

/** Des blocs de 64 octets : la même mécanique que 1 MiB, en tenant dans un test. */
const BLOC = 64;

const clair = (taille: number): Bytes =>
  new Uint8Array(Array.from({ length: taille }, (_u, rang) => (rang * 7) & 0xff)) as Bytes;

const sourceDe = (ciphertext: Bytes): SourceChiffree => ({
  taille: ciphertext.length,
  tranche: async (debut, fin) => ciphertext.subarray(debut, fin) as Bytes,
});

describe("REQ-MED-08 (b) — hachage par blocs : chaque octet servi a été vérifié", () => {
  it("une plage se déchiffre à l'identique du fichier entier", async () => {
    const octets = clair(200);
    const { ciphertext, keys } = await encryptAttachment(octets, env);
    const haches = await hachesParBloc(ciphertext, env.subtle, BLOC);
    expect(haches).toHaveLength(Math.ceil(200 / BLOC));

    // Trois plages : à cheval sur deux blocs, alignée, et la queue du fichier.
    for (const [debut, fin] of [
      [0, 200],
      [50, 130],
      [64, 128],
      [190, 200],
    ] as const) {
      const plage = await dechiffrerPlage(sourceDe(ciphertext), keys, haches, env.subtle, debut, fin, BLOC);
      expect([...plage], `plage ${debut}-${fin}`).toEqual([...octets.subarray(debut, fin)]);
    }

    // Et le chemin d'un seul bloc reste la référence.
    expect([...(await decryptAttachment(ciphertext, keys, env.subtle))]).toEqual([...octets]);
  });

  it("ne lit que les blocs que la plage traverse", async () => {
    const { ciphertext, keys } = await encryptAttachment(clair(320), env);
    const haches = await hachesParBloc(ciphertext, env.subtle, BLOC);

    const lus: number[] = [];
    const espion: SourceChiffree = {
      taille: ciphertext.length,
      tranche: async (debut, fin) => {
        lus.push(debut);
        return ciphertext.subarray(debut, fin) as Bytes;
      },
    };

    await dechiffrerPlage(espion, keys, haches, env.subtle, 130, 140, BLOC);
    // Un seul bloc, le troisième : c'est tout l'intérêt — la première image d'une vidéo de
    // 60 Mo n'attend plus que 60 Mo soient déchiffrés.
    expect(lus).toEqual([128]);
  });

  /**
   * Le cœur de la REQ : un bloc corrompu **interrompt** et ne rend rien. Pas « rend les
   * octets déjà déchiffrés » — c'est ce que ferait un hash calculé au fil de l'eau et
   * invalidé à la fin, et c'est précisément la fausse solution que le plan rejette.
   */
  it("un bloc corrompu lève, et aucun octet de ce bloc n'est rendu", async () => {
    const { ciphertext, keys } = await encryptAttachment(clair(200), env);
    const haches = await hachesParBloc(ciphertext, env.subtle, BLOC);
    ciphertext[70] = (ciphertext[70] ?? 0) ^ 0xff;

    // Le bloc 0 reste bon : il se lit encore.
    await expect(
      dechiffrerPlage(sourceDe(ciphertext), keys, haches, env.subtle, 0, 32, BLOC),
    ).resolves.toBeDefined();
    // Le bloc 1 est celui qu'on a touché.
    await expect(
      dechiffrerPlage(sourceDe(ciphertext), keys, haches, env.subtle, 64, 128, BLOC),
    ).rejects.toBeInstanceOf(MediaIntegrityError);
    // Et une plage qui traverse le bloc corrompu échoue **avant** de rendre le bloc sain
    // qui la précède.
    await expect(
      dechiffrerPlage(sourceDe(ciphertext), keys, haches, env.subtle, 0, 200, BLOC),
    ).rejects.toBeInstanceOf(MediaIntegrityError);
  });

  it("une liste d'empreintes trop courte refuse au lieu de servir sans vérifier", async () => {
    const { ciphertext, keys } = await encryptAttachment(clair(200), env);
    const haches = await hachesParBloc(ciphertext, env.subtle, BLOC);

    await expect(
      dechiffrerPlage(sourceDe(ciphertext), keys, haches.slice(0, 1), env.subtle, 64, 128, BLOC),
    ).rejects.toBeInstanceOf(MediaIntegrityError);
  });

  it("le champ propriétaire est namespacé, et la taille de bloc alignée sur AES", () => {
    // Un client tiers ne le connaît pas, l'ignore, et retombe sur `hashes.sha256`.
    expect(CHAMP_BLOCS.startsWith("org.tacita.")).toBe(true);
    // Un bloc non multiple de 16 décalerait le compteur AES d'un cran.
    expect(TAILLE_BLOC % 16).toBe(0);
  });
});
