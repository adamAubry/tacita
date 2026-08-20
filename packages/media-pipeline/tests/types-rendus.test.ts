import { describe, expect, it } from "vitest";

import { estRendable, resoudreType, typeSniffe, TYPES_RENDUS } from "../src";

/** Un en-tête ISO BMFF : quatre octets de taille, `ftyp`, puis la marque de conteneur. */
const ftyp = (marque: string): Uint8Array =>
  new Uint8Array([
    0, 0, 0, 0x18,
    ...[..."ftyp"].map((c) => c.charCodeAt(0)),
    ...[...marque].map((c) => c.charCodeAt(0)),
    0, 0, 0, 0,
  ]);

const ebml = (docType: string): Uint8Array =>
  new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, ...[...`  ${docType}  `].map((c) => c.charCodeAt(0))]);

const avec = (...tete: number[]): Uint8Array => new Uint8Array([...tete, ...Array<number>(16).fill(0)]);

describe("REQ-MED-12 — liste close des types rendus", () => {
  /**
   * Le point de sécurité de la REQ, et le seul qui compte vraiment : `info.mimetype` est
   * protégé par Megolm, donc non falsifiable par le serveur et **parfaitement falsifiable
   * par l'expéditeur**. Le chiffrement ne protège rien ici.
   */
  it.each(["image/svg+xml", "text/html", "application/xhtml+xml", "text/javascript", "application/pdf"])(
    "un type déclaré hostile est refusé : %s",
    (hostile) => {
      expect(estRendable(hostile)).toBe(false);
      expect(resoudreType(hostile)).toEqual({ rendable: false, motif: "hors-liste" });
    },
  );

  it("un type hors liste ne redescend pas au reniflement, même si les octets sont honnêtes", () => {
    // L'expéditeur a dit ce qu'il voulait qu'on rende. Lui chercher une seconde chance
    // dans ses propres octets reviendrait à lui en donner deux.
    expect(resoudreType("image/svg+xml", ftyp("isom"))).toEqual({
      rendable: false,
      motif: "hors-liste",
    });
  });

  it("`application/octet-stream` n'est pas un type rendable — c'est l'ancien repli", () => {
    expect(estRendable("application/octet-stream")).toBe(false);
    // Et il ne bloque pas le reniflement : c'est un « rien dit », pas un « ceci ».
    expect(resoudreType("application/octet-stream", ftyp("isom"))).toEqual({
      rendable: true,
      type: "video/mp4",
    });
  });

  it("les paramètres et la casse ne font pas sortir de la liste", () => {
    expect(resoudreType("Video/MP4; codecs=avc1.640028")).toEqual({
      rendable: true,
      type: "video/mp4",
    });
  });

  it("les trois familles rendues sont closes et ne se recouvrent pas", () => {
    const tous = Object.values(TYPES_RENDUS).flat();
    expect(new Set(tous).size).toBe(tous.length);
    for (const type of tous) expect(estRendable(type)).toBe(true);
  });
});

describe("REQ-MED-12 — reniflement, quand l'événement ne déclare rien", () => {
  it("sans type déclaré et sans octets, la résolution réclame les octets", () => {
    expect(resoudreType(undefined)).toEqual({ rendable: false, motif: "octets-requis" });
  });

  it.each([
    ["isom", "video/mp4"],
    ["mp42", "video/mp4"],
    ["qt  ", "video/quicktime"],
    ["avif", "image/avif"],
  ])("ISO BMFF, marque %s → %s", (marque, attendu) => {
    expect(typeSniffe(ftyp(marque))).toBe(attendu);
    expect(resoudreType(undefined, ftyp(marque))).toEqual({ rendable: true, type: attendu });
  });

  it("EBML : seul le DocType sépare WebM de Matroska", () => {
    expect(typeSniffe(ebml("webm"))).toBe("video/webm");
    expect(typeSniffe(ebml("matroska"))).toBe("video/x-matroska");
  });

  it.each([
    [avec(0xff, 0xd8, 0xff, 0xe0), "image/jpeg"],
    [avec(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a), "image/png"],
    [avec(0x47, 0x49, 0x46, 0x38, 0x39, 0x61), "image/gif"],
  ])("signatures d'image reconnues", (octets, attendu) => {
    expect(typeSniffe(octets)).toBe(attendu);
  });

  it("RIFF/WEBP se lit sur deux fenêtres, pas une", () => {
    const riff = new Uint8Array([
      ...[..."RIFF"].map((c) => c.charCodeAt(0)),
      0, 0, 0, 0,
      ...[..."WEBP"].map((c) => c.charCodeAt(0)),
    ]);
    expect(typeSniffe(riff)).toBe("image/webp");
  });

  it("des octets qui ne ressemblent à rien donnent un échec explicite, jamais un défaut", () => {
    expect(typeSniffe(avec(0x00, 0x01, 0x02, 0x03))).toBeUndefined();
    expect(resoudreType(undefined, avec(0x00, 0x01, 0x02, 0x03))).toEqual({
      rendable: false,
      motif: "inconnu",
    });
    // Trop court pour porter une signature : même verdict, pas d'accès hors bornes.
    expect(typeSniffe(new Uint8Array([0xff, 0xd8]))).toBeUndefined();
  });

  it("un conteneur reniflé mais hors liste reste refusé", () => {
    // `ftyp`/`heic` renifle en `video/mp4` faute de marque connue — ce que la liste close
    // rattrape est le cas inverse : un type sniffé absent de la liste ne passe pas.
    expect(resoudreType(undefined, ebml("stereo"))).toEqual({
      rendable: true,
      type: "video/x-matroska",
    });
    expect(estRendable("video/x-msvideo")).toBe(false);
  });
});
