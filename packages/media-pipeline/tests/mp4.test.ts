import { describe, expect, it } from "vitest";

import { ecrireMp4, TIMESCALE_US, type Bytes, type EchantillonVideo } from "../src";

/**
 * Le MP4 produit est relu par un lecteur de boîtes écrit **selon ISO/IEC 14496-12**, pas
 * selon le muxeur : taille sur quatre octets, type sur quatre octets, charge utile. Si le
 * muxeur se trompe de longueur, la lecture déraille — c'est la propriété qu'on veut.
 *
 * Limite assumée : ceci prouve la structure, pas qu'un lecteur vidéo réel décode le
 * fichier. Cette seconde porte demande un navigateur (interdit n°12) et des échantillons
 * H.264 véritables ; elle s'ouvrira avec le spike E-10, sur appareil.
 */

const octets = (...valeurs: number[]): Bytes => new Uint8Array(valeurs);

const DESCRIPTION = octets(0x01, 0x64, 0x00, 0x1f, 0xff, 0xe1);

/** Une cadence **exacte** : 1/30 s ne tombe pas juste en microsecondes, et un horodatage
 *  arrondi produirait des durées alternées — une jitter du test, pas du muxeur. */
const PAS_US = 33_000;

function echantillon(rang: number, cle = false, longueur = 6): EchantillonVideo {
  return {
    donnees: octets(...Array.from({ length: longueur }, (_unused, octet) => (rang * 16 + octet) & 0xff)),
    timestampUs: rang * PAS_US,
    cle,
  };
}

interface Boite {
  type: string;
  debut: number;
  contenu: Bytes;
  enfants: Boite[];
}

/** Les boîtes qui en contiennent d'autres ; les autres sont des feuilles de données. */
const CONTENEURS = new Set(["moov", "trak", "mdia", "minf", "stbl", "dinf"]);

function lireBoites(donnees: Bytes, debut = 0, fin = donnees.length): Boite[] {
  const boites: Boite[] = [];
  let position = debut;

  while (position + 8 <= fin) {
    const vue = new DataView(donnees.buffer, donnees.byteOffset + position);
    const taille = vue.getUint32(0);
    const type = String.fromCharCode(...donnees.subarray(position + 4, position + 8));
    expect(taille).toBeGreaterThanOrEqual(8);

    const contenu = donnees.subarray(position + 8, position + taille);
    boites.push({
      type,
      debut: position,
      contenu,
      enfants: CONTENEURS.has(type) ? lireBoites(donnees, position + 8, position + taille) : [],
    });
    position += taille;
  }

  // Aucune boîte ne doit dépasser ni laisser d'octets orphelins.
  expect(position).toBe(fin);
  return boites;
}

const trouver = (boites: Boite[], chemin: string[]): Boite => {
  let courante = boites.find((boite) => boite.type === chemin[0]);
  for (const type of chemin.slice(1)) courante = courante?.enfants.find((b) => b.type === type);
  expect(courante, chemin.join(" > ")).toBeDefined();
  return courante!;
};

const u32De = (contenu: Bytes, rang: number) =>
  new DataView(contenu.buffer, contenu.byteOffset).getUint32(rang);

describe("REQ-MED-04 — muxeur MP4 : les échantillons encodés deviennent un fichier lisible", () => {
  const echantillons = [echantillon(0, true), echantillon(1), echantillon(2), echantillon(3, true)];
  const fichier = ecrireMp4({ largeur: 640, hauteur: 480, description: DESCRIPTION, echantillons });
  const boites = lireBoites(fichier);

  it("le fichier s'ouvre sur ftyp et ne contient que ftyp, mdat et moov", () => {
    expect(boites.map((boite) => boite.type)).toEqual(["ftyp", "mdat", "moov"]);
    expect(String.fromCharCode(...boites[0]!.contenu.subarray(0, 4))).toBe("isom");
  });

  it("mdat porte les échantillons concaténés, octet pour octet", () => {
    const attendu = echantillons.flatMap((e) => [...e.donnees]);
    expect([...trouver(boites, ["mdat"]).contenu]).toEqual(attendu);
  });

  it("stco pointe exactement le premier octet de mdat", () => {
    const mdat = trouver(boites, ["mdat"]);
    const stco = trouver(boites, ["moov", "trak", "mdia", "minf", "stbl", "stco"]);

    // Le décalage est celui de la charge utile, en-tête de huit octets comprise dans le
    // calcul : se tromper d'un `mdat` de longueur décale toute la piste.
    expect(u32De(stco.contenu, 8)).toBe(mdat.debut + 8);
  });

  it("stsz rend la taille de chaque échantillon, dans l'ordre", () => {
    const stsz = trouver(boites, ["moov", "trak", "mdia", "minf", "stbl", "stsz"]);
    expect(u32De(stsz.contenu, 8)).toBe(echantillons.length);

    const tailles = echantillons.map((_unused, rang) => u32De(stsz.contenu, 12 + rang * 4));
    expect(tailles).toEqual(echantillons.map((e) => e.donnees.length));
  });

  it("stts compresse une cadence fixe en une seule série", () => {
    const stts = trouver(boites, ["moov", "trak", "mdia", "minf", "stbl", "stts"]);
    expect(u32De(stts.contenu, 4)).toBe(1);
    expect(u32De(stts.contenu, 8)).toBe(echantillons.length);
    expect(u32De(stts.contenu, 12)).toBe(PAS_US);
  });

  it("la dernière image dure autant que la précédente, jamais zéro", () => {
    // Sans cette reprise, la dernière image serait tronquée : visible sur une vidéo
    // courte, où elle représente une part du plan. `mvhd` : version+drapeaux, création,
    // modification, échelle de temps, **puis** la durée — d'où l'octet 16.
    const mvhd = trouver(boites, ["moov", "mvhd"]);
    expect(u32De(mvhd.contenu, 12)).toBe(TIMESCALE_US);
    expect(u32De(mvhd.contenu, 16)).toBe(echantillons.length * PAS_US);
  });

  it("stss ne liste que les images clés", () => {
    const stss = trouver(boites, ["moov", "trak", "mdia", "minf", "stbl", "stss"]);
    expect(u32De(stss.contenu, 4)).toBe(2);
    // Rangs 1-based : la première et la quatrième.
    expect([u32De(stss.contenu, 8), u32De(stss.contenu, 12)]).toEqual([1, 4]);
  });

  it("tout-clé : stss disparaît au lieu de répéter la liste des échantillons", () => {
    const toutesCles = [echantillon(0, true), echantillon(1, true)];
    const stbl = trouver(lireBoites(ecrireMp4({ largeur: 2, hauteur: 2, description: DESCRIPTION, echantillons: toutesCles })), [
      "moov",
      "trak",
      "mdia",
      "minf",
      "stbl",
    ]);
    expect(stbl.enfants.map((boite) => boite.type)).not.toContain("stss");
  });

  it("la description du codec est recopiée telle quelle dans avcC", () => {
    const stsd = trouver(boites, ["moov", "trak", "mdia", "minf", "stbl", "stsd"]);
    // `avc1` puis `avcC` vivent dans la charge utile de `stsd`, après son en-tête de
    // huit octets : le lecteur de boîtes s'y replonge.
    const avc1 = lireBoites(stsd.contenu, 8)[0]!;
    expect(avc1.type).toBe("avc1");

    const avcC = lireBoites(avc1.contenu, 78)[0]!;
    expect(avcC.type).toBe("avcC");
    expect([...avcC.contenu]).toEqual([...DESCRIPTION]);
  });

  it("les dimensions vivent dans avc1 et dans tkhd, en 16.16 pour la seconde", () => {
    const stsd = trouver(boites, ["moov", "trak", "mdia", "minf", "stbl", "stsd"]);
    const avc1 = lireBoites(stsd.contenu, 8)[0]!;
    const vue = new DataView(avc1.contenu.buffer, avc1.contenu.byteOffset);
    expect([vue.getUint16(24), vue.getUint16(26)]).toEqual([640, 480]);

    // `tkhd` v0 : 24 octets jusqu'à la durée, 8 de réservé, 8 de couche/volume, puis la
    // matrice de 36 — la largeur commence donc à l'octet 76, pas 72.
    const tkhd = trouver(boites, ["moov", "trak", "tkhd"]);
    expect(u32De(tkhd.contenu, 76) / 0x10000).toBe(640);
    expect(u32De(tkhd.contenu, 80) / 0x10000).toBe(480);
  });

  it("refuse de produire un fichier qu'aucun lecteur ne saurait ouvrir", () => {
    expect(() => ecrireMp4({ largeur: 2, hauteur: 2, description: DESCRIPTION, echantillons: [] })).toThrow(
      /sans échantillon/,
    );
    expect(() =>
      ecrireMp4({ largeur: 2, hauteur: 2, description: octets(), echantillons: [echantillon(0, true)] }),
    ).toThrow(/description/);
  });
});
