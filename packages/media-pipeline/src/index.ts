import type { Session } from "@tacita/client-core";

import {
  decryptAttachment,
  encryptAttachment,
  type Bytes,
  type CryptoEnvironment,
  type EncryptedFile,
} from "./attachments";
import {
  detectProfile,
  PROFILES,
  THUMBNAIL,
  type ImageTargets,
  type NetworkInformation,
  type VideoTargets,
} from "./profiles";

export { decryptAttachment, encryptAttachment, MediaIntegrityError } from "./attachments";
export type { Bytes, EncryptedFile, FileKeys } from "./attachments";
export { detectProfile, PROFILES, THUMBNAIL } from "./profiles";
export type { ImageTargets, NetworkProfile, VideoTargets } from "./profiles";

/** Forme d'onde MSC1767 : entiers 0–1024. */
export const WAVEFORM_BUCKETS = 60;
const WAVEFORM_SCALE = 1024;

/** D-03 — format de sortie unique des vocaux. Tout le reste passe par le transcodeur. */
export const VOICE_MIME_TYPE = "audio/ogg";

export interface Raster {
  blob: Blob;
  width: number;
  height: number;
}

/**
 * Toutes les APIs navigateur du pipeline, injectées : le package reste sans DOM et
 * testable, et l'app (spec 11) décide où elles tournent — les opérations lourdes
 * (transcodage, compression vidéo) en Web Worker, jamais sur le thread principal.
 */
export interface MediaEnvironment extends CryptoEnvironment {
  /** Canvas/OffscreenCanvas. Sert aussi aux vignettes : même code, cibles différentes. */
  resizeImage(blob: Blob, targets: ImageTargets): Promise<Raster>;
  /** WebCodecs, repli ffmpeg.wasm. */
  transcodeVideo(blob: Blob, targets: VideoTargets): Promise<Raster & { durationMs: number }>;
  /** Une image extraite de la vidéo, source de la vignette (REQ-MED-03). */
  extractPoster(blob: Blob): Promise<Blob>;
  /** REQ-MED-07 — encodeur Opus WASM. */
  transcodeAudio(blob: Blob): Promise<Blob>;
  /** AudioContext.decodeAudioData, ramené au mono. */
  decodeAudio(blob: Blob): Promise<{ samples: Float32Array; durationMs: number }>;
  /** REQ-MED-05 — File System Access API, absente de Firefox et Safari. */
  saveViaFilePicker?(blob: Blob, filename: string): Promise<void>;
  /** REQ-MED-05 — repli : téléchargement classique. */
  saveViaDownload(blob: Blob, filename: string): Promise<void>;
  /** D-04 — `navigator.connection`, absente sur Safari. */
  connection?: NetworkInformation;
}

export interface AttachmentContent {
  msgtype: "m.image" | "m.video" | "m.audio" | "m.file";
  body: string;
  info: Record<string, unknown>;
  /** REQ-MED-01 — clés du blob principal. */
  file: EncryptedFile;
  "org.matrix.msc1767.audio"?: { duration: number; waveform: number[] };
  "org.matrix.msc3245.voice"?: Record<string, never>;
}

type Kind = "image" | "video" | "audio" | "file";

const kindOf = (mimeType: string): Kind => {
  const [type] = mimeType.split("/");
  return type === "image" || type === "video" || type === "audio" ? type : "file";
};

/**
 * REQ-MED-01/02 — **le** chemin d'upload. Photos, vidéos, vocaux, ZIP, PDF, bureautique :
 * tout passe ici, aucun canal parallèle. Le nom du fichier n'est pas envoyé au serveur,
 * il ne vit que dans l'événement chiffré.
 */
async function encryptAndUpload(
  session: Session,
  env: MediaEnvironment,
  blob: Blob,
): Promise<EncryptedFile> {
  const { ciphertext, keys } = await encryptAttachment(new Uint8Array(await blob.arrayBuffer()), env);
  const { content_uri } = await session.client.uploadContent(new Blob([ciphertext]), {
    includeFilename: false,
    type: "application/octet-stream",
  });
  return { ...keys, url: content_uri };
}

/** REQ-MED-03 — vignette chiffrée séparément : deux blobs opaques, deux jeux de clés. */
async function thumbnailOf(
  session: Session,
  env: MediaEnvironment,
  source: Blob,
): Promise<{ thumbnail_file: EncryptedFile; thumbnail_info: Record<string, unknown> }> {
  const raster = await env.resizeImage(source, THUMBNAIL);
  return {
    thumbnail_file: await encryptAndUpload(session, env, raster.blob),
    thumbnail_info: {
      mimetype: THUMBNAIL.mimeType,
      w: raster.width,
      h: raster.height,
      size: raster.blob.size,
    },
  };
}

/** REQ-MED-06 — pics par tranche, normalisés sur l'échelle MSC1767. */
export function waveform(samples: Float32Array, buckets = WAVEFORM_BUCKETS): number[] {
  const width = Math.max(1, Math.ceil(samples.length / buckets));
  return Array.from({ length: buckets }, (_unused, bucket) => {
    let peak = 0;
    const end = Math.min((bucket + 1) * width, samples.length);
    for (let i = bucket * width; i < end; i++) peak = Math.max(peak, Math.abs(samples[i] ?? 0));
    return Math.round(peak * WAVEFORM_SCALE);
  });
}

/**
 * Chiffre, téléverse et rend un contenu d'événement prêt à `enqueue` (spec 07).
 * REQ-MED-04 — le profil réseau est détecté ici, une fois, et fixe les cibles D-04.
 */
export async function uploadAttachment(
  session: Session,
  env: MediaEnvironment,
  file: File,
): Promise<AttachmentContent> {
  const targets = PROFILES[detectProfile(env.connection)];
  const body = file.name;

  switch (kindOf(file.type)) {
    case "image": {
      // REQ-MED-04 — compression avant chiffrement : chiffrer d'abord rendrait le blob
      // incompressible.
      const raster = await env.resizeImage(file, targets.image);
      return {
        msgtype: "m.image",
        body,
        info: {
          mimetype: targets.image.mimeType,
          w: raster.width,
          h: raster.height,
          size: raster.blob.size,
          ...(await thumbnailOf(session, env, raster.blob)),
        },
        file: await encryptAndUpload(session, env, raster.blob),
      };
    }

    case "video": {
      const video = await env.transcodeVideo(file, targets.video);
      return {
        msgtype: "m.video",
        body,
        info: {
          mimetype: targets.video.mimeType,
          w: video.width,
          h: video.height,
          duration: video.durationMs,
          size: video.blob.size,
          ...(await thumbnailOf(session, env, await env.extractPoster(video.blob))),
        },
        file: await encryptAndUpload(session, env, video.blob),
      };
    }

    case "audio": {
      // REQ-MED-07 / D-03 — Safari iOS rend du MP4/AAC, Chrome du WebM/Opus : ni l'un ni
      // l'autre n'est de l'Ogg/Opus, et un vocal hors Ogg/Opus est illisible par les
      // clients Matrix standards. Un seul format sort d'ici.
      const ogg = file.type === VOICE_MIME_TYPE ? file : await env.transcodeAudio(file);
      const { samples, durationMs } = await env.decodeAudio(ogg);
      return {
        msgtype: "m.audio",
        body,
        info: { mimetype: VOICE_MIME_TYPE, duration: durationMs, size: ogg.size },
        file: await encryptAndUpload(session, env, ogg),
        "org.matrix.msc1767.audio": { duration: durationMs, waveform: waveform(samples) },
        "org.matrix.msc3245.voice": {},
      };
    }

    default:
      // REQ-MED-02 — ZIP, PDF, bureautique : pas de compression, mais exactement le même
      // chiffrement et le même upload que le reste.
      return {
        msgtype: "m.file",
        body,
        info: { mimetype: file.type || "application/octet-stream", size: file.size },
        file: await encryptAndUpload(session, env, file),
      };
  }
}

/**
 * REQ-MED-05 — sauvegarde locale de l'original **non compressé**, volontairement séparée
 * de l'envoi : le destinataire ne reçoit jamais que la version compressée.
 */
export async function saveOriginal(
  env: MediaEnvironment,
  original: Blob,
  filename: string,
): Promise<void> {
  // Appel via `env` : détacher la méthode lui ferait perdre son `this` si l'app
  // implémente `MediaEnvironment` avec une classe.
  await (env.saveViaFilePicker
    ? env.saveViaFilePicker(original, filename)
    : env.saveViaDownload(original, filename));
}

/**
 * REQ-MED-08/09 — récupération, vérification du hash, déchiffrement local.
 * Les endpoints média non authentifiés répondent 404 depuis Synapse v1.146
 * (infra/README.md, REQ-INF-12) : aucune URL publique n'est supposée, et aucune vignette
 * n'est demandée au serveur — il ne saurait pas redimensionner un blob opaque.
 */
export async function downloadAttachment(
  session: Session,
  env: MediaEnvironment,
  file: EncryptedFile,
): Promise<Bytes> {
  const url = session.client.mxcUrlToHttp(file.url, undefined, undefined, undefined, false, true, true);
  if (!url) throw new Error("URL mxc invalide : média non téléchargeable");

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${session.client.getAccessToken() ?? ""}` },
  });
  if (!response.ok) throw new Error(`téléchargement média refusé (HTTP ${response.status})`);

  return decryptAttachment(new Uint8Array(await response.arrayBuffer()), file, env.subtle);
}
