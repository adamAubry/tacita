import type { MediaEnvironment, Raster } from "@tacita/media-pipeline";

/**
 * L'implémentation navigateur du `MediaEnvironment` que le pipeline (spec 08) attend
 * injecté. Le paquet reste sans DOM ; c'est ici que les APIs du navigateur entrent.
 */

/**
 * Ce que le navigateur ne sait pas faire seul. **Lever avec un type nommé, jamais rendre
 * un blob approximatif** : un vocal qui n'est pas de l'Ogg/Opus est illisible par les
 * clients Matrix standards (D-03), et une vidéo non transcodée partirait au format brut
 * de l'appareil, à des dizaines de mégaoctets.
 *
 * L'UI ne propose pas ces deux chemins tant que le transcodage n'existe pas : c'est la
 * seule façon honnête de ne pas afficher une fonction qui échouerait (interdit n°13).
 * Escalade au PM en cours, voir `specs/ui/ESCALATIONS.md` § E-10.
 */
export class TranscodageIndisponible extends Error {
  constructor(quoi: "video" | "audio") {
    super(`transcodage ${quoi} indisponible dans le shard : voir ESCALATIONS E-10`);
    this.name = "TranscodageIndisponible";
  }
}

/** Redimensionne en respectant le ratio, sans jamais agrandir. */
function cible(largeur: number, hauteur: number, maxEdge: number) {
  const facteur = Math.min(1, maxEdge / Math.max(largeur, hauteur));
  return { width: Math.round(largeur * facteur), height: Math.round(hauteur * facteur) };
}

async function dessiner(source: ImageBitmap, maxEdge: number, mimeType: string, quality: number) {
  const { width, height } = cible(source.width, source.height, maxEdge);
  const canvas = new OffscreenCanvas(width, height);
  const contexte = canvas.getContext("2d");
  if (!contexte) throw new Error("contexte 2d indisponible : compression impossible");

  contexte.drawImage(source, 0, 0, width, height);
  source.close();
  return { blob: await canvas.convertToBlob({ type: mimeType, quality }), width, height };
}

/**
 * La partie du `MediaEnvironment` que le navigateur couvre nativement : compression
 * d'image, poster de vidéo, décodage audio, sauvegarde locale, profil réseau.
 *
 * `OffscreenCanvas` plutôt que `<canvas>` : le redimensionnement d'une photo de 12 Mpx
 * bloque le thread principal une demi-seconde, et cet objet est transférable dans un
 * worker le jour où on l'y déplace (contrainte spec 08).
 */
export function environnementMedia(): MediaEnvironment {
  return {
    subtle: globalThis.crypto.subtle,
    getRandomValues: (bytes) => {
      globalThis.crypto.getRandomValues(bytes);
    },

    async resizeImage(blob, targets): Promise<Raster> {
      return dessiner(await createImageBitmap(blob), targets.maxEdge, targets.mimeType, targets.quality);
    },

    /**
     * Une image de la vidéo, prise après le tout début : la première frame d'une vidéo
     * de téléphone est très souvent noire, et une vignette noire n'aide personne.
     */
    async extractPoster(blob) {
      const video = document.createElement("video");
      video.muted = true;
      video.src = URL.createObjectURL(blob);

      try {
        await new Promise<void>((resolve, reject) => {
          video.onloadeddata = () => resolve();
          video.onerror = () => reject(new Error("vidéo illisible : aucune vignette"));
        });
        video.currentTime = Math.min(0.1, video.duration || 0);
        await new Promise<void>((resolve) => {
          video.onseeked = () => resolve();
        });

        const canvas = new OffscreenCanvas(video.videoWidth, video.videoHeight);
        canvas.getContext("2d")?.drawImage(video, 0, 0);
        return await canvas.convertToBlob({ type: "image/jpeg", quality: 0.7 });
      } finally {
        URL.revokeObjectURL(video.src);
      }
    },

    async decodeAudio(blob) {
      // `AudioContext` et non `OfflineAudioContext` : le second exige de connaître la
      // durée avant de décoder, ce qu'on cherche justement à apprendre.
      const contexte = new AudioContext();
      try {
        const audio = await contexte.decodeAudioData(await blob.arrayBuffer());
        return { samples: audio.getChannelData(0), durationMs: Math.round(audio.duration * 1000) };
      } finally {
        void contexte.close();
      }
    },

    transcodeVideo() {
      return Promise.reject(new TranscodageIndisponible("video"));
    },

    transcodeAudio() {
      return Promise.reject(new TranscodageIndisponible("audio"));
    },

    /**
     * REQ-MED-05 — l'original non compressé, sur l'appareil. `showSaveFilePicker` est
     * absent de Firefox et Safari ; `saveOriginal` retombe alors sur le téléchargement.
     */
    saveViaFilePicker:
      "showSaveFilePicker" in globalThis
        ? async (blob, filename) => {
            const picker = (
              globalThis as unknown as {
                showSaveFilePicker(options: { suggestedName: string }): Promise<{
                  createWritable(): Promise<{ write(data: Blob): Promise<void>; close(): Promise<void> }>;
                }>;
              }
            ).showSaveFilePicker;
            const handle = await picker({ suggestedName: filename });
            const flux = await handle.createWritable();
            await flux.write(blob);
            await flux.close();
          }
        : undefined,

    async saveViaDownload(blob, filename) {
      const url = URL.createObjectURL(blob);
      const lien = document.createElement("a");
      lien.href = url;
      lien.download = filename;
      lien.click();
      // Révoquer immédiatement annulerait le téléchargement dans Safari : l'URL doit
      // survivre au tour de boucle où le clic est traité.
      setTimeout(() => URL.revokeObjectURL(url), 0);
    },

    // D-04 — absente de Safari ; le pipeline retombe alors sur « bon réseau », et ne
    // dégrade pas ce qu'il ne mesure pas.
    connection: (navigator as Navigator & { connection?: { effectiveType?: string; saveData?: boolean } })
      .connection,
  };
}
