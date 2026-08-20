/**
 * Le point d'entrée du worker de transcodage vidéo.
 *
 * **Spec 08 § Méthode : « les opérations lourdes tournent en Web Worker — jamais sur le
 * thread principal ».** La contrainte était écrite depuis l'origine et n'était pas tenue :
 * le transcodage décodait et réencodait sur le thread de rendu, qui portait aussi la
 * timeline. Une phrase de spec sans fichier pour la porter n'empêche rien.
 *
 * Le protocole tient en un aller-retour : un `Blob` et des cibles descendent, un résultat
 * ou un message d'échec remonte. Aucun état, aucune file — l'appelant crée un worker par
 * transcodage et le termine ensuite, ce qui rend l'annulation triviale et la fuite
 * impossible.
 */
import type { VideoTargets } from "@tacita/media-pipeline";

import { transcoderVideo } from "./transcode-video";

export interface DemandeTranscodage {
  blob: Blob;
  cibles: VideoTargets;
}

export type ReponseTranscodage =
  | { ok: true; blob: Blob; width: number; height: number; durationMs: number }
  | { ok: false; message: string };

declare const self: DedicatedWorkerGlobalScope;

self.onmessage = async ({ data }: MessageEvent<DemandeTranscodage>) => {
  try {
    const { blob, width, height, durationMs } = await transcoderVideo(data.blob, data.cibles);
    self.postMessage({ ok: true, blob, width, height, durationMs } satisfies ReponseTranscodage);
  } catch (cause) {
    // Le message ne cite jamais le média (REQ-MED-10) — seulement la nature de l'échec.
    self.postMessage({
      ok: false,
      message: cause instanceof Error ? cause.message : "transcodage vidéo impossible",
    } satisfies ReponseTranscodage);
  }
};
