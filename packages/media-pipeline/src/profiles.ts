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

/** Vignette : indépendante du profil réseau, elle est déjà minuscule. */
export const THUMBNAIL: ImageTargets = { maxEdge: 320, quality: 0.7, mimeType: "image/jpeg" };

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
