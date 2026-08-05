import type { Bytes } from "./attachments";

/**
 * Lecteur WebM réduit à un seul usage : sortir les paquets Opus et l'`OpusHead` d'un
 * enregistrement `MediaRecorder`. **Octets → octets, aucun DOM** (spec 08, § Méthode).
 *
 * Ce n'est pas un démuxeur Matroska : il ne lit ni la vidéo, ni les pistes multiples, ni
 * les sous-titres, et n'en a pas besoin. Ce que MediaRecorder produit pour un vocal est
 * une piste audio unique, et tout le reste est ignoré par construction.
 */

const SEGMENT = 0x18538067;
const TRACKS = 0x1654ae6b;
const TRACK_ENTRY = 0xae;
const CLUSTER = 0x1f43b675;
const BLOCK_GROUP = 0xa0;
const CODEC_PRIVATE = 0x63a2;
const SIMPLE_BLOCK = 0xa3;
const BLOCK = 0xa1;

/** Les conteneurs dans lesquels il faut descendre ; tout le reste se saute par sa taille. */
const CONTENEURS = new Set([SEGMENT, TRACKS, TRACK_ENTRY, CLUSTER, BLOCK_GROUP]);

interface Vint {
  valeur: number;
  longueur: number;
  /** Taille « inconnue » d'EBML : tous les bits de valeur à 1 (flux en direct). */
  inconnue: boolean;
}

/**
 * Entier de longueur variable EBML. `marqueur` conservé pour un identifiant, retiré pour
 * une taille — c'est la seule différence entre les deux lectures.
 */
function vint(donnees: Bytes, position: number, garderMarqueur: boolean): Vint | undefined {
  const premier = donnees[position];
  if (premier === undefined || premier === 0) return undefined;

  let longueur = 1;
  while (longueur <= 8 && (premier & (0x80 >> (longueur - 1))) === 0) longueur++;
  if (longueur > 8 || position + longueur > donnees.length) return undefined;

  let valeur = garderMarqueur ? premier : premier & (0xff >> longueur);
  let inconnue = (premier & (0xff >> longueur)) === 0xff >> longueur;

  for (let rang = 1; rang < longueur; rang++) {
    const octet = donnees[position + rang]!;
    // `* 256` et non `<< 8` : au-delà de quatre octets, les décalages binaires de
    // JavaScript repassent en 32 bits signés et le résultat devient négatif.
    valeur = valeur * 256 + octet;
    inconnue &&= octet === 0xff;
  }

  return { valeur, longueur, inconnue };
}

export interface WebmOpus {
  /** `CodecPrivate` de la piste : c'est l'`OpusHead`, tel quel. */
  opusHead?: Bytes;
  paquets: Bytes[];
}

/**
 * Extrait les paquets Opus et l'`OpusHead`. Les blocs sont rendus **dans l'ordre du
 * fichier** : c'est celui de l'enregistrement, et rien ici ne le retrie.
 */
export function lireWebmOpus(donnees: Bytes): WebmOpus {
  const resultat: WebmOpus = { paquets: [] };
  let position = 0;

  while (position < donnees.length) {
    const identifiant = vint(donnees, position, true);
    if (!identifiant) break;
    const taille = vint(donnees, position + identifiant.longueur, false);
    if (!taille) break;

    const debut = position + identifiant.longueur + taille.longueur;

    // Un conteneur se traverse, il ne se saute pas — et `MediaRecorder` écrit Segment et
    // Cluster en taille **inconnue**, parce qu'il diffuse : sauter « leur taille » ferait
    // sortir du fichier. Les traverser rend le lecteur indifférent aux deux cas.
    if (CONTENEURS.has(identifiant.valeur) || taille.inconnue) {
      position = debut;
      continue;
    }

    const fin = Math.min(debut + taille.valeur, donnees.length);
    const contenu = donnees.subarray(debut, fin);

    if (identifiant.valeur === CODEC_PRIVATE) resultat.opusHead ??= contenu;
    else if (identifiant.valeur === SIMPLE_BLOCK || identifiant.valeur === BLOCK) {
      const paquet = trameDuBloc(contenu);
      if (paquet) resultat.paquets.push(paquet);
    }

    position = fin;
  }

  return resultat;
}

/**
 * Charge utile d'un bloc : numéro de piste (vint), horodatage relatif (2 octets), drapeaux
 * (1 octet), puis la trame.
 *
 * **Le lacing lève au lieu d'être deviné.** Un bloc lacé contient plusieurs trames dont les
 * longueurs sont encodées à part ; les traiter comme une seule produirait un paquet Opus
 * invalide, donc un vocal muet — l'échec bruyant vaut mieux. `MediaRecorder` ne lace pas
 * l'audio, et si cela change, on veut le savoir.
 */
function trameDuBloc(bloc: Bytes): Bytes | undefined {
  const piste = vint(bloc, 0, false);
  if (!piste) return undefined;

  const debutDrapeaux = piste.longueur + 2;
  const drapeaux = bloc[debutDrapeaux];
  if (drapeaux === undefined) return undefined;
  if ((drapeaux & 0x06) !== 0) throw new Error("bloc WebM lacé : remuxage refusé");

  const trame = bloc.subarray(debutDrapeaux + 1);
  return trame.length > 0 ? trame : undefined;
}
