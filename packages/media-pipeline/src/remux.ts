import type { Bytes } from "./attachments";
import { ecrireOggOpus } from "./ogg";
import { lireWebmOpus } from "./webm";

/** Le conteneur que Chrome et Edge produisent pour un vocal. */
export const WEBM_OPUS_MIME = "audio/webm";

/**
 * REQ-MED-07, chemin Chrome/Edge — **remuxage**, pas transcodage.
 *
 * Le flux Opus produit par `MediaRecorder` est déjà celui qu'on veut envoyer : seul son
 * conteneur diffère. On change l'emballage, on ne touche pas à un échantillon — aucune
 * perte de qualité, aucun encodeur, et le coût est celui d'une recopie d'octets.
 *
 * Lève si le WebM ne porte pas d'`OpusHead` : sans lui, le nombre de canaux et le délai de
 * préchargement sont inconnus, et un flux Ogg construit sur des valeurs devinées se lit de
 * travers plutôt que pas du tout — le pire des deux.
 */
export function remuxWebmOpusVersOgg(webm: Bytes): Bytes {
  const { opusHead, paquets } = lireWebmOpus(webm);

  // `length` et non l'existence : un `CodecPrivate` **vide** est un en-tête absent, et le
  // laisser passer produirait un Ogg dont la première page ne décrit rien — illisible
  // partout, sans que rien n'ait échoué. Le test l'a trouvé.
  if (!opusHead?.length) throw new Error("WebM sans OpusHead : remuxage impossible");
  if (paquets.length === 0) throw new Error("WebM sans paquet audio : rien à remuxer");

  return ecrireOggOpus(paquets, opusHead);
}
