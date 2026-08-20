/** D-04 — deux profils, pas de troisième, pas de réglage utilisateur en V1. */
export type NetworkProfile = "good" | "constrained";

export interface ImageTargets {
  maxEdge: number;
  quality: number;
  mimeType: string;
}

export interface VideoTargets {
  height: number;
  bitrate: number;
  mimeType: string;
}

/**
 * D-04 — JPEG pour les images, MP4/H.264 pour les vidéos : lisible partout, et la vidéo
 * n'a pas la contrainte d'interopérabilité qui impose Opus aux vocaux (D-03).
 */
export const PROFILES: Record<NetworkProfile, { image: ImageTargets; video: VideoTargets }> = {
  good: {
    image: { maxEdge: 2048, quality: 0.8, mimeType: "image/jpeg" },
    video: { height: 720, bitrate: 2_500_000, mimeType: "video/mp4" },
  },
  constrained: {
    image: { maxEdge: 1280, quality: 0.7, mimeType: "image/jpeg" },
    video: { height: 480, bitrate: 1_000_000, mimeType: "video/mp4" },
  },
};

/**
 * Vignette : indépendante du profil réseau, elle est déjà minuscule.
 *
 * **512 px et WebP depuis le 20/08/2026.** 320 px était sous-dimensionné : une vignette
 * qui occupe 220 px CSS sur un écran à trois pixels physiques par point en demande 660 —
 * elle était floue sur tout téléphone récent. Le WebP à 0,75 reprend largement le poids
 * que la résolution ajoute, et reste sous celui du JPEG à 320.
 *
 * Le repli JPEG n'est pas une préférence, c'est une nécessité **vérifiée** : un canvas à
 * qui l'on demande un type qu'il ne sait pas encoder rend du PNG **sans le dire**, et un
 * PNG de photo pèse plusieurs fois le JPEG qu'il remplace. C'est `resizeImage` qui doit
 * relire le type obtenu, pas le supposer.
 */
export const THUMBNAIL: ImageTargets = { maxEdge: 512, quality: 0.75, mimeType: "image/webp" };

export interface NetworkInformation {
  effectiveType?: string;
  saveData?: boolean;
}

const CONSTRAINED = new Set(["slow-2g", "2g", "3g"]);

/**
 * REQ-MED-04 / D-04 — Network Information API. Absente sur Safari : le repli est
 * « bon réseau », choisi pour ne pas dégrader par défaut ce qu'on ne sait pas mesurer.
 */
export function detectProfile(connection?: NetworkInformation): NetworkProfile {
  if (!connection) return "good";
  if (connection.saveData) return "constrained";
  return connection.effectiveType && CONSTRAINED.has(connection.effectiveType)
    ? "constrained"
    : "good";
}

/**
 * REQ-MED-04 / D-04 — **l'échelle de repli du profil H.264**, du meilleur au plus sûr.
 *
 * High 4.0 d'abord : Baseline interdit CABAC et les images B, soit 15 à 25 % de débit
 * perdu à qualité perçue égale. La configuration retenue est la **première supportée**,
 * mesurée par `VideoEncoder.isConfigSupported` et jamais supposée — c'est le shard qui
 * mesure, ces chaînes ne sont que la liste et son ordre.
 */
export const CODECS_H264 = ["avc1.640028", "avc1.4d401f", "avc1.42001f"] as const;

/**
 * Marge au-dessus de la cible en deçà de laquelle un réencodage ne rendrait rien.
 * Réencoder une source à 3,1 Mbit/s pour viser 2,5 coûte une génération de perte et une
 * attente, pour un gain que personne ne voit.
 */
const MARGE_DEBIT = 1.3;

/**
 * REQ-MED-04 / E-18 — **le chemin rapide : une source déjà conforme se remuxe, elle ne
 * se réencode pas.**
 *
 * Ce que le prédicat exige, et pourquoi :
 * - **H.264**, parce que c'est ce que notre conteneur sait décrire (D-04) ;
 * - **hauteur sous le plafond**, parce qu'au-dessus il faut bien réduire ;
 * - **débit sous la cible et sa marge**, même raison ;
 * - **au plus deux pistes** : une vidéo, éventuellement du son. Au-delà — angles
 *   multiples, sous-titres, piste de timecode — la source n'est pas ordinaire, et la
 *   remuxer perdrait sans le dire ce que le conteneur ne sait pas porter.
 *
 * Le son d'une source à deux pistes **est** perdu, sur ce chemin comme sur celui du
 * réencodage : le muxeur n'écrit qu'une piste tant que REQ-MED-13 n'est pas livrée. Ce
 * n'est donc pas une régression du chemin rapide, c'est la lacune du muxeur — et elle est
 * la même des deux côtés.
 */
export function remuxable(
  source: { codec: string; hauteur: number; debitBps: number; pistes: number },
  cibles: VideoTargets,
): boolean {
  return (
    source.codec.startsWith("avc1") &&
    source.hauteur > 0 &&
    source.hauteur <= cibles.height &&
    source.debitBps > 0 &&
    source.debitBps <= cibles.bitrate * MARGE_DEBIT &&
    source.pistes <= 2
  );
}
