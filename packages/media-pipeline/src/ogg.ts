import type { Bytes } from "./attachments";

/**
 * Muxeur Ogg pour flux Opus — **octets → octets, aucun DOM** (spec 08, § Méthode, E-10).
 *
 * Écrit à la main et sans dépendance : un muxeur n'encode rien, il empaquette. Le format
 * Ogg tient en une en-tête de 27 octets et une table de segmentation ; l'importer coûterait
 * plus cher à auditer qu'à écrire.
 */

/** Ogg impose sa propre CRC32 : polynôme 0x04c11db7, sans réflexion, init 0, sans xor final. */
const TABLE_CRC = Int32Array.from({ length: 256 }, (_unused, octet) => {
  let reste = octet << 24;
  for (let bit = 0; bit < 8; bit++) {
    reste = (reste & 0x80000000) !== 0 ? (reste << 1) ^ 0x04c11db7 : reste << 1;
  }
  return reste;
});

export function crc32Ogg(donnees: Bytes): number {
  let crc = 0;
  for (const octet of donnees) {
    crc = ((crc << 8) ^ TABLE_CRC[((crc >>> 24) ^ octet) & 0xff]!) | 0;
  }
  return crc >>> 0;
}

/**
 * Durée d'un paquet Opus, en échantillons à 48 kHz, lue dans son octet TOC (RFC 6716
 * § 3.1). C'est ce qui alimente la position granulaire d'Ogg — s'en remettre à « 20 ms,
 * c'est toujours ce que produit MediaRecorder » donnerait une durée fausse le jour où ce
 * n'est plus vrai, et un vocal qui se termine trop tôt à la lecture.
 */
export function echantillonsOpus(paquet: Bytes): number {
  const toc = paquet[0];
  if (toc === undefined) return 0;

  const config = toc >> 3;
  const tailles =
    config < 12
      ? [480, 960, 1920, 2880][config % 4]! // SILK : 10, 20, 40, 60 ms
      : config < 16
        ? [480, 960][(config - 12) % 2]! // Hybride : 10, 20 ms
        : [120, 240, 480, 960][(config - 16) % 4]!; // CELT : 2.5, 5, 10, 20 ms

  const code = toc & 0x03;
  const trames = code === 0 ? 1 : code < 3 ? 2 : ((paquet[1] ?? 1) & 0x3f || 1);
  return tailles * trames;
}

const OGG_S = [0x4f, 0x67, 0x67, 0x53]; // « OggS »
const MAX_SEGMENTS = 255;

/** Une page Ogg complète, CRC posée. */
function page(
  paquets: Bytes[],
  granule: number,
  serie: number,
  sequence: number,
  drapeaux: number,
): Bytes {
  // Table de segmentation : chaque paquet devient des tranches de 255 octets, et une
  // dernière tranche plus courte **obligatoire** — c'est elle qui marque la fin du paquet.
  // Un paquet de longueur multiple de 255 exige donc un segment 0 de terminaison.
  const lacing: number[] = [];
  for (const paquet of paquets) {
    let reste = paquet.length;
    while (reste >= 255) {
      lacing.push(255);
      reste -= 255;
    }
    lacing.push(reste);
  }

  const corps = paquets.reduce((total, paquet) => total + paquet.length, 0);
  const sortie = new Uint8Array(27 + lacing.length + corps);
  const vue = new DataView(sortie.buffer);

  sortie.set(OGG_S, 0);
  sortie[4] = 0; // version
  sortie[5] = drapeaux;
  // La position granulaire est un entier 64 bits ; `BigInt` évite de perdre les vocaux
  // de plus de 12 heures, mais surtout d'écrire deux moitiés à la main.
  vue.setBigUint64(6, BigInt(granule), true);
  vue.setUint32(14, serie, true);
  vue.setUint32(18, sequence, true);
  vue.setUint32(22, 0, true); // CRC calculée sur la page entière, ce champ à zéro
  sortie[26] = lacing.length;
  sortie.set(lacing, 27);

  let position = 27 + lacing.length;
  for (const paquet of paquets) {
    sortie.set(paquet, position);
    position += paquet.length;
  }

  vue.setUint32(22, crc32Ogg(sortie), true);
  return sortie;
}

/** En-tête de commentaires minimal : Opus l'exige, son contenu est libre. */
function opusTags(): Bytes {
  const signature = new TextEncoder().encode("OpusTags");
  const vendeur = new TextEncoder().encode("tacita");
  const sortie = new Uint8Array(signature.length + 4 + vendeur.length + 4);
  const vue = new DataView(sortie.buffer);

  sortie.set(signature, 0);
  vue.setUint32(signature.length, vendeur.length, true);
  sortie.set(vendeur, signature.length + 4);
  vue.setUint32(signature.length + 4 + vendeur.length, 0, true); // zéro commentaire
  return sortie;
}

/**
 * Empaquette des paquets Opus en flux Ogg complet.
 *
 * `opusHead` vient tel quel du conteneur d'origine : il porte le nombre de canaux, le
 * délai de préchargement et le gain, que rien ici ne saurait recalculer.
 *
 * ponytail: pages remplies à 50 paquets, pas à la limite de 255 — une page perdue coûte
 * alors une seconde d'audio, pas cinq. Passer à un remplissage par octets le jour où la
 * taille des vocaux pèse, ce qu'un débit Opus de 24 kb/s rend improbable.
 */
export function ecrireOggOpus(paquets: Bytes[], opusHead: Bytes, serie = 1): Bytes {
  const PAR_PAGE = 50;
  const pages: Bytes[] = [
    page([opusHead], 0, serie, 0, 0x02), // BOS
    page([opusTags()], 0, serie, 1, 0x00),
  ];

  let granule = 0;
  let sequence = 2;

  for (let debut = 0; debut < paquets.length; debut += PAR_PAGE) {
    const lot = paquets.slice(debut, debut + PAR_PAGE);
    if (lot.length > MAX_SEGMENTS) throw new Error("lot de paquets trop grand pour une page");

    // La granule d'une page est celle du **dernier échantillon qu'elle achève**.
    for (const paquet of lot) granule += echantillonsOpus(paquet);
    const dernier = debut + PAR_PAGE >= paquets.length;
    pages.push(page(lot, granule, serie, sequence++, dernier ? 0x04 : 0x00));
  }

  const total = pages.reduce((somme, p) => somme + p.length, 0);
  const flux = new Uint8Array(total);
  let position = 0;
  for (const p of pages) {
    flux.set(p, position);
    position += p.length;
  }
  return flux;
}
