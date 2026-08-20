import { describe, expect, it } from "vitest";

import { ecrireMp4, lireMp4, rotationDeMatrice, type Bytes, type EchantillonVideo } from "../src";

/**
 * **Le muxeur écrit, la bibliothèque relit.** Ce fichier est le seul endroit du dépôt où
 * une implémentation indépendante juge notre conteneur : mp4box n'a pas été écrit ici, ne
 * partage aucune ligne avec `mp4.ts`, et ne peut donc pas confirmer une erreur par
 * construction (règle 3). Le muxeur avait jusqu'ici pour seul juge un lecteur de boîtes
 * écrit dans le même dépôt.
 *
 * Aucune globale navigateur n'est nécessaire : c'est ce qui rendait cette dépendance
 * admissible (E-17), et ce test en est la preuve permanente.
 */

const DESCRIPTION = new Uint8Array([
  1, 0x64, 0x00, 0x1f, 0xff, 0xe1, 0x00, 0x04, 0x67, 0x64, 0x00, 0x1f, 0x01, 0x00, 0x04, 0x68,
  0xee, 0x3c, 0x80,
]) as Bytes;

const PAS_US = 33_333;

const echantillons = (nombre = 30): EchantillonVideo[] =>
  Array.from({ length: nombre }, (_u, rang) => ({
    donnees: new Uint8Array(Array.from({ length: 24 }, (_v, o) => (rang * 16 + o) & 0xff)) as Bytes,
    timestampUs: rang * PAS_US,
    cle: rang % 15 === 0,
  }));

describe("REQ-MED-04 — démuxage : ce qu'une bibliothèque indépendante lit de notre conteneur", () => {
  it("relit les dimensions, le codec, la durée et tous les échantillons", async () => {
    const fichier = ecrireMp4({ largeur: 640, hauteur: 360, description: DESCRIPTION, echantillons: echantillons() });
    const source = await lireMp4(fichier);

    expect(source.largeur).toBe(640);
    expect(source.hauteur).toBe(360);
    expect(source.codec).toBe("avc1.64001f");
    expect(source.echantillons).toHaveLength(30);
    expect(source.dureeMs).toBe(1000);
    expect(source.pistes).toBe(1);
    expect(source.audio).toBe(false);
    // Le débit est **mesuré** sur les échantillons, pas lu dans un en-tête : 30 × 24 o
    // sur une seconde.
    expect(source.debitBps).toBe(30 * 24 * 8);
  });

  it("les octets et les horodatages traversent l'aller-retour intacts", async () => {
    const origine = echantillons(10);
    const source = await lireMp4(
      ecrireMp4({ largeur: 320, hauteur: 240, description: DESCRIPTION, echantillons: origine }),
    );

    expect(source.echantillons.map((e) => e.timestampUs)).toEqual(origine.map((e) => e.timestampUs));
    expect(source.echantillons.map((e) => e.cle)).toEqual(origine.map((e) => e.cle));
    expect([...source.echantillons[0]!.donnees]).toEqual([...origine[0]!.donnees]);
    expect([...source.echantillons[9]!.donnees]).toEqual([...origine[9]!.donnees]);
    // `avcC` ressort tel quel : le muxeur ne le lit pas, le démuxeur non plus.
    expect([...source.description]).toEqual([...DESCRIPTION]);
  });

  /** REQ-MED-14 — l'aller-retour de la rotation, le seul garde-fou sans navigateur. */
  it.each([0, 90, 180, 270] as const)("la rotation %s survit à l'écriture puis à la relecture", async (rotation) => {
    const fichier = ecrireMp4({
      largeur: 640,
      hauteur: 360,
      description: DESCRIPTION,
      echantillons: echantillons(4),
      rotation,
    });
    expect((await lireMp4(fichier)).rotation).toBe(rotation);
  });

  it("une matrice qui n'est pas une rotation reconnue ne tourne rien", () => {
    // Mise à l'échelle, cisaillement, matrice vide : le défaut est « comme codé », jamais
    // une rotation devinée.
    expect(rotationDeMatrice(undefined)).toBe(0);
    expect(rotationDeMatrice([0x20000, 0, 0, 0, 0x20000, 0, 0, 0, 0x40000000])).toBe(0);
    expect(rotationDeMatrice(new Int32Array([0, 0x8000, 0, -0x8000, 0, 0, 0, 0, 0x40000000]))).toBe(0);
  });

  it("des octets qui ne sont pas un MP4 lèvent, sans rendre une source vide", async () => {
    await expect(lireMp4(new Uint8Array(64) as Bytes)).rejects.toThrow();
  });
});

describe("REQ-MED-04 — `ctts` : l'ordre de présentation survit aux images B", () => {
  /**
   * Prérequis bloquant du profil High. Sans la table, un lecteur affiche les images dans
   * l'ordre où elles sont rangées, et la vidéo saute en arrière à chaque groupe.
   *
   * L'ordre de décodage ci-dessous est celui d'un encodeur avec B-frames : I, P, B — la
   * P se décode avant la B qu'elle suit à l'écran.
   */
  it("un flux à images B se relit dans l'ordre de présentation", async () => {
    const ordreDecodage = [0, 66_666, 33_333, 166_666, 133_333, 100_000];
    const source = await lireMp4(
      ecrireMp4({
        largeur: 320,
        hauteur: 240,
        description: DESCRIPTION,
        echantillons: ordreDecodage.map((timestampUs, rang) => ({
          donnees: new Uint8Array([rang, rang, rang, rang]) as Bytes,
          timestampUs,
          cle: rang === 0,
        })),
      }),
    );

    // mp4box rend `cts` — la date de présentation, reconstruite depuis `stts` **et**
    // `ctts`. Qu'elle corresponde prouve que la table est là et qu'elle est juste : sans
    // `ctts`, on relirait les dates de décodage, c'est-à-dire la suite triée.
    expect(source.echantillons.map((e) => e.timestampUs)).toEqual(ordreDecodage);
  });

  it("sans image B, aucune table n'est écrite — et la relecture est la même", async () => {
    const droit = ecrireMp4({ largeur: 320, hauteur: 240, description: DESCRIPTION, echantillons: echantillons(6) });
    expect(new TextDecoder("latin1").decode(droit)).not.toContain("ctts");
    expect((await lireMp4(droit)).echantillons.map((e) => e.timestampUs)).toEqual(
      echantillons(6).map((e) => e.timestampUs),
    );
  });
});

describe("REQ-MED-04 — faststart : `moov` avant `mdat`", () => {
  const positionDe = (fichier: Bytes, type: string): number =>
    new TextDecoder("latin1").decode(fichier).indexOf(type);

  it("les boîtes sortent dans l'ordre ftyp, moov, mdat", () => {
    const fichier = ecrireMp4({
      largeur: 640,
      hauteur: 360,
      description: DESCRIPTION,
      echantillons: echantillons(12),
    });

    const ftyp = positionDe(fichier, "ftyp");
    const moov = positionDe(fichier, "moov");
    const mdat = positionDe(fichier, "mdat");
    expect(ftyp).toBeGreaterThanOrEqual(0);
    expect(moov).toBeGreaterThan(ftyp);
    expect(mdat).toBeGreaterThan(moov);
  });

  /**
   * Le vrai risque du faststart n'est pas l'ordre, c'est le **décalage** : `stco` pointe
   * vers `mdat`, qui a bougé. Un décalage faux ne casse pas la lecture des boîtes — il
   * fait lire des octets arbitraires comme des échantillons, et mp4box les rendrait
   * différents de ceux écrits.
   */
  it("les échantillons se relisent au bon endroit après le déplacement de `moov`", async () => {
    const origine = echantillons(12);
    const source = await lireMp4(
      ecrireMp4({ largeur: 640, hauteur: 360, description: DESCRIPTION, echantillons: origine }),
    );

    expect(source.echantillons).toHaveLength(12);
    for (const rang of [0, 5, 11]) {
      expect([...source.echantillons[rang]!.donnees], `échantillon ${rang}`).toEqual([
        ...origine[rang]!.donnees,
      ]);
    }
  });
});
