import type { Bytes } from "./attachments";

/**
 * Muxeur MP4 (ISO BMFF) pour une piste vidéo unique — **octets → octets, aucun DOM**
 * (spec 08, § Méthode, E-10).
 *
 * Il n'encode rien : il reçoit des échantillons déjà encodés par `WebCodecs` côté shard,
 * et les range dans les boîtes qu'un lecteur attend. C'est le pendant vidéo du muxeur Ogg.
 *
 * **Une piste, pas de son.** REQ-MED-04 compresse une vidéo pour l'envoi ; l'audio d'une
 * vidéo de téléphone n'est pas dans le périmètre de D-04, et une seconde piste doublerait
 * les tables sans qu'aucune exigence ne la demande. À ajouter le jour où une REQ la
 * nomme, pas avant.
 */

/** Microsecondes : c'est l'unité de `WebCodecs`, et l'adopter supprime tout arrondi. */
export const TIMESCALE_US = 1_000_000;

export interface EchantillonVideo {
  /** Échantillon encodé, au format AVCC (NAL préfixées de leur longueur). */
  donnees: Bytes;
  /** Horodatage de présentation, en microsecondes, tel que `WebCodecs` le rend. */
  timestampUs: number;
  /** Image clé : elle seule permet de démarrer le décodage. */
  cle: boolean;
}

export interface Mp4Options {
  largeur: number;
  hauteur: number;
  /**
   * `AVCDecoderConfigurationRecord`, rendu par `VideoEncoder` dans
   * `metadata.decoderConfig.description`. Le muxeur le recopie sans le lire : ce sont les
   * paramètres du codec, et les deviner produirait une vidéo qui ne décode pas.
   */
  description: Bytes;
  echantillons: EchantillonVideo[];
}

const encodeur = new TextEncoder();

/** Une boîte ISO BMFF : taille (4), type (4), charge utile. */
function boite(type: string, ...morceaux: (Bytes | number[])[]): Bytes {
  const corps = morceaux.flatMap((morceau) => [...morceau]);
  const sortie = new Uint8Array(8 + corps.length);
  new DataView(sortie.buffer).setUint32(0, sortie.length);
  sortie.set(encodeur.encode(type), 4);
  sortie.set(corps, 8);
  return sortie;
}

const u32 = (valeur: number): number[] => [
  (valeur >>> 24) & 0xff,
  (valeur >>> 16) & 0xff,
  (valeur >>> 8) & 0xff,
  valeur & 0xff,
];

const u16 = (valeur: number): number[] => [(valeur >>> 8) & 0xff, valeur & 0xff];

/** Version 0 + trois octets de drapeaux, en tête de toute « full box ». */
const pleine = (drapeaux = 0): number[] => [
  0,
  (drapeaux >>> 16) & 0xff,
  (drapeaux >>> 8) & 0xff,
  drapeaux & 0xff,
];

/** Matrice unité 3×3 en 16.16 — aucune rotation, aucune mise à l'échelle. */
const MATRICE_UNITE = [
  ...u32(0x00010000), ...u32(0), ...u32(0),
  ...u32(0), ...u32(0x00010000), ...u32(0),
  ...u32(0), ...u32(0), ...u32(0x40000000),
];

/**
 * Durées par échantillon, dérivées des horodatages.
 *
 * Le dernier échantillon n'a pas de suivant qui donnerait sa durée : il reprend celle du
 * précédent. Lui mettre zéro tronquerait la dernière image à la lecture — le défaut se
 * voit sur une vidéo courte, où c'est une part visible du plan.
 */
function durees(echantillons: EchantillonVideo[]): number[] {
  const suite = echantillons.map((echantillon, rang) =>
    rang + 1 < echantillons.length
      ? Math.max(0, echantillons[rang + 1]!.timestampUs - echantillon.timestampUs)
      : 0,
  );
  const dernier = suite.length - 1;
  if (dernier >= 0) suite[dernier] = suite[dernier - 1] ?? TIMESCALE_US / 30;
  return suite;
}

/** `stts` — les durées, compressées en séries : une vidéo à cadence fixe tient en une. */
function stts(valeurs: number[]): Bytes {
  const series: [nombre: number, duree: number][] = [];
  for (const duree of valeurs) {
    const derniere = series.at(-1);
    if (derniere && derniere[1] === duree) derniere[0] += 1;
    else series.push([1, duree]);
  }
  return boite(
    "stts",
    pleine(),
    u32(series.length),
    series.flatMap(([nombre, duree]) => [...u32(nombre), ...u32(duree)]),
  );
}

/** `stss` — les images clés, en rangs 1-based. Omise si tout est clé. */
function stss(echantillons: EchantillonVideo[]): Bytes[] {
  const cles = echantillons.flatMap((echantillon, rang) => (echantillon.cle ? [rang + 1] : []));
  if (cles.length === echantillons.length) return [];
  return [boite("stss", pleine(), u32(cles.length), cles.flatMap(u32))];
}

/**
 * Écrit un MP4 progressif : `ftyp`, `mdat`, `moov`.
 *
 * ponytail: `moov` **après** les données, pas de « faststart ». Le déplacer en tête
 * demanderait de recalculer tous les décalages de chunk une fois sa taille connue, pour un
 * gain qui n'existe qu'en lecture progressive depuis un serveur. Ici le fichier est
 * déchiffré en entier avant d'être lu, depuis un blob local : il n'y a rien à progresser.
 * À reprendre le jour où un média se lirait en flux — ce que le chiffrement interdit.
 */
export function ecrireMp4({ largeur, hauteur, description, echantillons }: Mp4Options): Bytes {
  if (echantillons.length === 0) throw new Error("MP4 sans échantillon : rien à muxer");
  if (description.length === 0) throw new Error("MP4 sans description de codec : illisible");

  const tailles = echantillons.map((echantillon) => echantillon.donnees.length);
  const dureesParEchantillon = durees(echantillons);
  const dureeTotale = dureesParEchantillon.reduce((somme, duree) => somme + duree, 0);

  const ftyp = boite("ftyp", encodeur.encode("isom"), u32(512), encodeur.encode("isomiso2avc1mp41"));

  const donnees = new Uint8Array(tailles.reduce((somme, taille) => somme + taille, 0));
  let position = 0;
  for (const echantillon of echantillons) {
    donnees.set(echantillon.donnees, position);
    position += echantillon.donnees.length;
  }
  const mdat = boite("mdat", donnees);

  // Le décalage du premier chunk est connu d'avance parce que `mdat` précède `moov` :
  // c'est précisément ce que le choix « pas de faststart » achète.
  const decalageChunk = ftyp.length + 8;

  const avcC = boite("avcC", description);
  const avc1 = boite(
    "avc1",
    [0, 0, 0, 0, 0, 0], // réservé
    u16(1), // index de référence de données
    u16(0), u16(0), u32(0), u32(0), u32(0), // pré-défini / réservé
    u16(largeur),
    u16(hauteur),
    u32(0x00480000), // 72 dpi horizontaux
    u32(0x00480000),
    u32(0),
    u16(1), // une image par échantillon
    Array.from({ length: 32 }, () => 0), // nom du compresseur, laissé vide
    u16(0x0018), // profondeur
    [0xff, 0xff], // pré-défini = −1
    avcC,
  );

  const stbl = boite(
    "stbl",
    boite("stsd", pleine(), u32(1), avc1),
    stts(dureesParEchantillon),
    ...stss(echantillons),
    // Un seul chunk contient tous les échantillons : la table de correspondance tient
    // donc en une entrée, et `stco` en un décalage.
    boite("stsc", pleine(), u32(1), u32(1), u32(echantillons.length), u32(1)),
    boite("stsz", pleine(), u32(0), u32(tailles.length), tailles.flatMap(u32)),
    boite("stco", pleine(), u32(1), u32(decalageChunk)),
  );

  const minf = boite(
    "minf",
    boite("vmhd", pleine(1), u16(0), u16(0), u16(0), u16(0)),
    boite("dinf", boite("dref", pleine(), u32(1), boite("url ", pleine(1)))),
    stbl,
  );

  const mdia = boite(
    "mdia",
    boite("mdhd", pleine(), u32(0), u32(0), u32(TIMESCALE_US), u32(dureeTotale), u16(0x55c4), u16(0)),
    boite("hdlr", pleine(), u32(0), encodeur.encode("vide"), u32(0), u32(0), u32(0), encodeur.encode("VideoHandler\0")),
    minf,
  );

  const trak = boite(
    "trak",
    boite(
      "tkhd",
      pleine(3), // activée, et présente dans le film
      u32(0), u32(0),
      u32(1), // identifiant de piste
      u32(0),
      u32(dureeTotale),
      u32(0), u32(0),
      u16(0), u16(0),
      u16(0), // volume : nul pour une piste vidéo
      u16(0),
      MATRICE_UNITE,
      u32(largeur * 0x10000),
      u32(hauteur * 0x10000),
    ),
    mdia,
  );

  const moov = boite(
    "moov",
    boite(
      "mvhd",
      pleine(),
      u32(0), u32(0),
      u32(TIMESCALE_US),
      u32(dureeTotale),
      u32(0x00010000), // vitesse normale
      u16(0x0100), // volume plein
      u16(0),
      u32(0), u32(0),
      MATRICE_UNITE,
      u32(0), u32(0), u32(0), u32(0), u32(0), u32(0),
      u32(2), // prochain identifiant de piste
    ),
    trak,
  );

  const total = ftyp.length + mdat.length + moov.length;
  const fichier = new Uint8Array(total);
  fichier.set(ftyp, 0);
  fichier.set(mdat, ftyp.length);
  fichier.set(moov, ftyp.length + mdat.length);
  return fichier;
}
