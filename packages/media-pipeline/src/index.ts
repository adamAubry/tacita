import type { Session } from "@tacita/client-core";

import {
  decryptAttachment,
  decryptAttachmentByChunks,
  encryptAttachment,
  type Bytes,
  type CryptoEnvironment,
  type EncryptedFile,
} from "./attachments";
import type { CacheChiffre } from "./cache";
import {
  detectProfile,
  PROFILES,
  THUMBNAIL,
  type ImageTargets,
  type NetworkInformation,
  type VideoTargets,
} from "./profiles";

import { remuxWebmOpusVersOgg, WEBM_OPUS_MIME } from "./remux";

export {
  decryptAttachment,
  decryptAttachmentByChunks,
  encryptAttachment,
  MediaIntegrityError,
  TAILLE_TRANCHE,
} from "./attachments";
export { SEUILS, verdictTaille } from "./plafonds";
export type { Seuils, Verdict } from "./plafonds";
export type { Bytes, EncryptedFile, FileKeys } from "./attachments";
export { ecrireMp4, TIMESCALE_US } from "./mp4";
export type { EchantillonVideo, Mp4Options, Rotation } from "./mp4";
export { lireMp4, rotationDeMatrice } from "./demux";
export type { SourceVideo } from "./demux";
export { crc32Ogg, echantillonsOpus, ecrireOggOpus } from "./ogg";
export { remuxWebmOpusVersOgg, WEBM_OPUS_MIME } from "./remux";
export { lireWebmOpus } from "./webm";
export type { WebmOpus } from "./webm";
export { CODECS_H264, detectProfile, PROFILES, remuxable, THUMBNAIL } from "./profiles";
export { BUDGET_DEFAUT, ouvrirCacheChiffre } from "./cache";
export type { CacheChiffre } from "./cache";
export { estRendable, resoudreType, TAILLE_SNIFF, typeSniffe, TYPES_RENDUS } from "./types-rendus";
export type { Resolution } from "./types-rendus";
export type { ImageTargets, NetworkProfile, VideoTargets } from "./profiles";

/** Forme d'onde MSC1767 : entiers 0–1024. */
export const WAVEFORM_BUCKETS = 60;
const WAVEFORM_SCALE = 1024;

/** D-03 — format de sortie unique des vocaux. Tout le reste passe par le transcodeur. */
export const VOICE_MIME_TYPE = "audio/ogg";

/** Ce qu'un flux d'écriture doit savoir faire, et rien de plus. */
export interface Ecrivain {
  write(donnees: Blob | Uint8Array): Promise<void>;
  close(): Promise<void>;
}

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
  /** WebCodecs, dans un Worker. `sansSon` remonte le cas de REQ-MED-13. */
  transcodeVideo(
    blob: Blob,
    targets: VideoTargets,
  ): Promise<Raster & { durationMs: number; sansSon?: boolean }>;
  /** Une image extraite de la vidéo, source de la vignette (REQ-MED-03). */
  extractPoster(blob: Blob): Promise<Blob>;
  /** REQ-MED-07 — encodeur Opus WASM. */
  transcodeAudio(blob: Blob): Promise<Blob>;
  /** AudioContext.decodeAudioData, ramené au mono. */
  decodeAudio(blob: Blob): Promise<{ samples: Float32Array; durationMs: number }>;
  /** REQ-MED-05 — File System Access API, absente de Firefox et Safari. */
  saveViaFilePicker?(blob: Blob, filename: string): Promise<void>;
  /**
   * REQ-MED-15 — le **flux** d'écriture de la même API, quand elle est là.
   *
   * `saveViaFilePicker` prend un Blob, donc le fichier entier en clair et en mémoire :
   * c'est précisément ce qu'on veut éviter sur 400 Mo. Celui-ci rend de quoi écrire
   * tranche par tranche. Absent ⇒ chemin tout-ou-rien, borné par `SEUILS.dur`.
   */
  ouvrirEcriture?(filename: string): Promise<Ecrivain>;
  /** REQ-MED-05 — repli : téléchargement classique. */
  saveViaDownload(blob: Blob, filename: string): Promise<void>;
  /** D-04 — `navigator.connection`, absente sur Safari. */
  connection?: NetworkInformation;
  /**
   * REQ-MED-16 — le cache de chiffré, quand le câblage en fournit un.
   *
   * Optionnel, et sans repli à écrire : son absence rend simplement chaque téléchargement
   * au réseau, ce qui était le comportement d'avant.
   */
  cache?: CacheChiffre;
  /**
   * REQ-MED-13 — ce que le pipeline a dû abandonner en route, et que l'UI doit dire.
   *
   * Un rappel plutôt qu'une valeur de retour : `uploadAttachment` rend un contenu
   * d'événement, et une vidéo partie sans son n'a rien à y écrire — c'est une information
   * pour **l'expéditeur**, pas pour le destinataire ni pour le serveur.
   */
  signaler?(avis: "video-sans-son"): void;
}

/**
 * Audit des jonctions — **`type` et non `interface`, délibérément.** La spec 08 promet
 * que « le pipeline produit un contenu prêt à `enqueue` » (spec 07), or `enqueue` prend
 * un `Record<string, unknown>` : une `interface` n'a pas d'index signature implicite,
 * un alias de type si. En `interface`, la passation déclarée **ne compilait pas**, et
 * personne ne pouvait le voir — aucun paquet ne dépend des deux, il n'existait aucun
 * site de compilation. Le shard de la spec 11 l'aurait découvert au premier envoi de
 * photo. `packages/outbox/tests/jonction-media.test-d.ts` est ce site.
 */
export type AttachmentContent = {
  msgtype: "m.image" | "m.video" | "m.audio" | "m.file";
  body: string;
  info: Record<string, unknown>;
  /** REQ-MED-01 — clés du blob principal. */
  file: EncryptedFile;
  "org.matrix.msc1767.audio"?: { duration: number; waveform: number[] };
  "org.matrix.msc3245.voice"?: Record<string, never>;
};

/**
 * REQ-MED-17 — un blob chiffré qui attend son URL, et l'endroit du contenu où l'écrire.
 *
 * Le chemin plutôt qu'un nom de champ : la vignette vit deux niveaux plus bas que le
 * fichier principal, et une file d'envoi qui ne connaît rien aux médias doit pouvoir
 * poser l'URL sans savoir lequel des deux elle vient de téléverser.
 */
export interface Televersement {
  chemin: string[];
  ciphertext: Bytes;
}

/** Ce que le pipeline produit **sans toucher au réseau** : le contenu, et ce qu'il reste à faire. */
export interface PieceJointePreparee {
  contenu: AttachmentContent;
  televersements: Televersement[];
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
/**
 * REQ-MED-17 — un blob chiffré, **et rangé en attente de téléversement**.
 *
 * L'URL est vide à ce stade : c'est la file d'envoi qui la posera, au chemin indiqué,
 * quand elle aura réussi le téléversement (REQ-OBX-10). Séparer les deux est ce qui rend
 * une reprise possible sans rechiffrer.
 */
async function chiffrerEnAttente(
  env: MediaEnvironment,
  blob: Blob,
  chemin: string[],
  enAttente: Televersement[],
): Promise<EncryptedFile> {
  const { ciphertext, keys } = await encryptAttachment(new Uint8Array(await blob.arrayBuffer()), env);
  enAttente.push({ chemin: [...chemin, "url"], ciphertext });
  return { ...keys, url: "" };
}

/**
 * REQ-MED-17 — **l'étape de téléversement, exposée à part, idempotente, sans retry propre.**
 *
 * Rejouée avec le même chiffré, elle ne rechiffre rien et ne régénère rien : ni clé, ni
 * IV, ni empreinte. C'est ce qui permet à la file d'envoi (spec 07, REQ-OBX-10) de
 * reprendre un téléversement interrompu sans repasser par la compression.
 *
 * **Le pipeline ne retente jamais de lui-même** : une erreur remonte telle quelle, et
 * c'est la file qui décide du backoff, parce que c'est elle qui sait ce qui attend
 * derrière.
 *
 * **Limite de l'idempotence, à ne pas surestimer : elle est côté application, pas côté
 * serveur.** L'API media de Matrix n'offre aucune clé d'idempotence ; un téléversement
 * réussi dont la réponse se perd laisse un blob orphelin, et le rejeu en crée un second.
 * Acceptable — un blob opaque de plus, que jamais aucun événement ne référence — mais
 * écrit, sinon « idempotent » se lit comme une propriété de bout en bout.
 */
export async function uploadCiphertext(session: Session, ciphertext: Bytes): Promise<string> {
  const { content_uri } = await session.client.uploadContent(new Blob([ciphertext as BlobPart]), {
    includeFilename: false,
    type: "application/octet-stream",
  });
  return content_uri;
}

/** REQ-MED-03 — vignette chiffrée séparément : deux blobs opaques, deux jeux de clés. */
async function thumbnailOf(
  env: MediaEnvironment,
  source: Blob,
  enAttente: Televersement[],
): Promise<{ thumbnail_file: EncryptedFile; thumbnail_info: Record<string, unknown> }> {
  const raster = await env.resizeImage(source, THUMBNAIL);
  return {
    thumbnail_file: await chiffrerEnAttente(env, raster.blob, ["info", "thumbnail_file"], enAttente),
    thumbnail_info: {
      // **Le type obtenu, pas le type demandé.** Un canvas qui ne sait pas encoder le
      // format demandé rend du PNG en silence ; écrire ici la cible ferait mentir
      // l'événement sur ses propres octets, et le destinataire lirait un type faux.
      mimetype: raster.blob.type || THUMBNAIL.mimeType,
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
 * REQ-MED-07 — l'aiguillage des trois chemins d'entrée vers l'unique format de sortie.
 *
 * L'ordre compte : le moins cher d'abord. Un vocal Firefox ne coûte rien, un vocal Chrome
 * coûte une recopie d'octets, et seul Safari paie un encodage — que `transcodeAudio` porte,
 * dans le `MediaEnvironment` injecté.
 */
async function versOggOpus(env: MediaEnvironment, file: File): Promise<Blob> {
  if (file.type.startsWith(VOICE_MIME_TYPE)) return file;

  if (file.type.startsWith(WEBM_OPUS_MIME)) {
    const ogg = remuxWebmOpusVersOgg(new Uint8Array(await file.arrayBuffer()));
    return new Blob([ogg as BlobPart], { type: VOICE_MIME_TYPE });
  }

  return env.transcodeAudio(file);
}

/**
 * Chiffre, téléverse et rend un contenu d'événement prêt à `enqueue` (spec 07).
 * REQ-MED-04 — le profil réseau est détecté ici, une fois, et fixe les cibles D-04.
 */
export async function prepareAttachment(
  env: MediaEnvironment,
  file: File,
): Promise<PieceJointePreparee> {
  const enAttente: Televersement[] = [];
  const contenu = await construireContenu(env, file, enAttente);
  return { contenu, televersements: enAttente };
}

/**
 * REQ-MED-01/02 — le contenu d'événement, **sans réseau** : tout est compressé, chiffré,
 * et ce qui reste à téléverser est rangé dans `enAttente`.
 */
async function construireContenu(
  env: MediaEnvironment,
  file: File,
  enAttente: Televersement[],
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
          ...(await thumbnailOf(env, raster.blob, enAttente)),
        },
        file: await chiffrerEnAttente(env, raster.blob, ["file"], enAttente),
      };
    }

    case "video": {
      const video = await env.transcodeVideo(file, targets.video);
      // REQ-MED-13 — la vidéo part quand même, et l'UI le dit. Ne pas l'envoyer serait
      // pire ; l'envoyer en silence serait malhonnête (interdit n°13).
      if (video.sansSon) env.signaler?.("video-sans-son");
      return {
        msgtype: "m.video",
        body,
        info: {
          mimetype: targets.video.mimeType,
          w: video.width,
          h: video.height,
          duration: video.durationMs,
          size: video.blob.size,
          ...(await thumbnailOf(env, await env.extractPoster(video.blob), enAttente)),
        },
        file: await chiffrerEnAttente(env, video.blob, ["file"], enAttente),
      };
    }

    case "audio": {
      // REQ-MED-07 / D-03 — un seul format sort d'ici, quel que soit ce qui entre. Trois
      // chemins, trois coûts (E-10) : Firefox rend déjà de l'Ogg/Opus, Chrome rend le même
      // flux Opus dans un conteneur WebM — un remuxage suffit, sans encodeur ni perte —,
      // et Safari rend du MP4/AAC, seul cas qui demande un vrai encodage.
      const ogg = await versOggOpus(env, file);
      const { samples, durationMs } = await env.decodeAudio(ogg);
      return {
        msgtype: "m.audio",
        body,
        info: { mimetype: VOICE_MIME_TYPE, duration: durationMs, size: ogg.size },
        file: await chiffrerEnAttente(env, ogg, ["file"], enAttente),
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
        file: await chiffrerEnAttente(env, file, ["file"], enAttente),
      };
  }
}

/**
 * REQ-MED-01/02 — **le** chemin d'upload, version « tout de suite » : prépare puis
 * téléverse dans la foulée.
 *
 * Conservé pour les appelants qui n'ont pas de file derrière eux — et parce que c'est lui
 * qui porte la promesse de l'interdit n°11 : un seul pipeline, quel que soit le type.
 * `Conversation` passe désormais par `prepareAttachment`, la file possédant la reprise
 * (REQ-OBX-10).
 */
export async function uploadAttachment(
  session: Session,
  env: MediaEnvironment,
  file: File,
): Promise<AttachmentContent> {
  const { contenu, televersements } = await prepareAttachment(env, file);
  for (const televersement of televersements) {
    poserUrl(contenu, televersement.chemin, await uploadCiphertext(session, televersement.ciphertext));
  }
  return contenu;
}

/** Écrit une URL au bout d'un chemin. Le chemin existe : c'est le pipeline qui l'a créé. */
export function poserUrl(contenu: Record<string, unknown>, chemin: string[], url: string): void {
  let noeud: Record<string, unknown> = contenu;
  for (const cle of chemin.slice(0, -1)) noeud = noeud[cle] as Record<string, unknown>;
  noeud[chemin.at(-1)!] = url;
}

/**
 * REQ-MED-11 — **le seul chemin de ce paquet qui téléverse en clair, et il le dit dans
 * son nom.**
 *
 * Un avatar Matrix est un `mxc://` nu : tout client doit pouvoir l'afficher sans clé.
 * Chiffré, il n'est un avatar nulle part — un carré cassé chez tous les correspondants.
 * Le chiffrer serait donc une non-feature, pas une garantie (E-12, voie A) : le seul
 * choix honnête est de le poser en clair et de le **dire**, comme les réactions et les
 * épingles (REQ-MSG-05/08).
 *
 * Ce qui reste commun avec le reste du pipeline, et pourquoi l'interdit n°11 tient : même
 * compression, mêmes cibles D-04, même module. Ce qui diffère tient en une ligne — pas de
 * `encryptAttachment`, et un `mxc://` rendu au lieu d'un `EncryptedFile`.
 *
 * **Un seul appelant dans tout le dépôt** (le formulaire de profil, M-G). Ce n'est pas
 * une consigne de revue : un test structurel balaie les sources et échoue au second. La
 * phrase « tout ce qui sort du pipeline est chiffré, sauf l'unique chemin nommé public »
 * ne vaut que tant que « unique » est vérifié par une machine.
 */
export async function uploadPublicProfileImage(
  session: Session,
  env: MediaEnvironment,
  file: File,
): Promise<string> {
  // La même compression que les images de message : une photo de profil de 8 Mo est un
  // problème pour tout le monde, chiffrée ou non.
  const { blob } = await env.resizeImage(file, PROFILES[detectProfile(env.connection)].image);
  const { content_uri } = await session.client.uploadContent(blob, {
    // En clair et assumé : aucun `encryptAttachment` sur ce chemin. Le nom du fichier
    // n'est pas joint — il vient de l'appareil et n'apprend rien d'utile au serveur.
    includeFilename: false,
    type: blob.type,
  });
  return content_uri;
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
  return decryptAttachment(await chiffreDe(session, env, file.url), file, env.subtle);
}

/**
 * REQ-MED-16 — le chiffré, du cache s'il y est, du réseau sinon — et alors mis en cache.
 *
 * Le cache est interrogé **avant** le réseau et rempli après, et il ne voit que du
 * chiffré : ce qui en sort repart vers `decryptAttachment` exactement comme ce qui vient
 * du réseau, avec la même vérification d'intégrité (REQ-MED-08). Un cache empoisonné
 * échoue donc au hash, comme un blob corrompu en transit.
 */
async function chiffreDe(session: Session, env: MediaEnvironment, url: string): Promise<Bytes> {
  const enCache = await env.cache?.lire(url).catch(() => undefined);
  if (enCache) return enCache;

  const octets = new Uint8Array(await (await recupererMedia(session, url)).arrayBuffer()) as Bytes;
  // L'écriture n'est pas attendue : un cache indisponible ou plein ne doit pas retarder
  // l'affichage, et encore moins le faire échouer.
  void env.cache?.ecrire(url, octets).catch(() => {});
  return octets;
}

/**
 * REQ-MED-15 — **le téléchargement d'un média, sans jamais tenir son clair en entier.**
 *
 * Le chiffré descend et se vérifie d'un bloc (REQ-MED-08, mécanisme (a) : rien n'est
 * déchiffré avant que l'empreinte du tout soit bonne), puis le clair sort par tranches,
 * chacune écrite et relâchée. Le pic passe d'environ trois fois la taille du fichier à
 * « le chiffré, plus une tranche ».
 *
 * **Le clair va directement à la destination choisie par l'utilisateur** : aucun staging
 * OPFS, aucun fichier temporaire dans notre origine. Et rien n'est écrit avant la
 * vérification — un chiffré corrompu lève avant le premier `write`.
 *
 * Lève si l'environnement n'expose pas de flux : c'est à l'appelant de le savoir avant
 * (`verdictTaille` prend `flux` en entrée), pas de le découvrir ici.
 */
export async function downloadAttachmentToFile(
  session: Session,
  env: MediaEnvironment,
  file: EncryptedFile,
  filename: string,
): Promise<void> {
  if (!env.ouvrirEcriture) throw new Error("aucun flux d'écriture : téléchargement par tranches impossible");

  const ciphertext = await chiffreDe(session, env, file.url);

  // Le fichier n'est ouvert **qu'après** la première tranche : `decryptAttachmentByChunks`
  // vérifie l'empreinte avant de rendre quoi que ce soit, et un fichier vide créé puis
  // abandonné sur une erreur d'intégrité serait un déchet visible pour l'utilisateur.
  let ecrivain: Ecrivain | undefined;
  try {
    for await (const tranche of decryptAttachmentByChunks(ciphertext, file, env.subtle)) {
      ecrivain ??= await env.ouvrirEcriture(filename);
      await ecrivain.write(tranche);
    }
  } finally {
    await ecrivain?.close();
  }
}

/**
 * REQ-MED-11 — **le pendant en lecture du chemin public.** Un `mxc://` non chiffré (photo
 * de profil, bannière) rendu en `Blob`, prêt pour un `URL.createObjectURL`.
 *
 * Pourquoi une fonction et pas un `<img src>` : depuis Synapse v1.146 les endpoints média
 * anonymes répondent 404 (REQ-INF-12), et une balise `img` ne sait pas porter d'en-tête
 * `Authorization`. Sans ce chemin, une photo de profil correctement téléversée et
 * correctement posée sur le compte reste invisible — c'était le cas.
 *
 * Aucune vignette n'est demandée au serveur : elle le pourrait ici (le média est en
 * clair), mais ce serait un second chemin de rendu à tenir pour un avatar déjà compressé
 * par `uploadPublicProfileImage`.
 */
export async function downloadPublicImage(session: Session, mxcUrl: string): Promise<Blob> {
  return (await recupererMedia(session, mxcUrl)).blob();
}

/**
 * Les endpoints média non authentifiés répondent 404 depuis Synapse v1.146
 * (infra/README.md, REQ-INF-12) : aucune URL publique n'est supposée, et aucune vignette
 * n'est demandée au serveur — il ne saurait pas redimensionner un blob opaque.
 */
async function recupererMedia(session: Session, mxcUrl: string): Promise<Response> {
  const url = session.client.mxcUrlToHttp(mxcUrl, undefined, undefined, undefined, false, true, true);
  if (!url) throw new Error("URL mxc invalide : média non téléchargeable");

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${session.client.getAccessToken() ?? ""}` },
  });
  if (!response.ok) throw new Error(`téléchargement média refusé (HTTP ${response.status})`);

  return response;
}
