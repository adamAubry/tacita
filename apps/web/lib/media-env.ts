import type { MediaEnvironment, Raster } from "@tacita/media-pipeline";

import type { DemandeTranscodage, ReponseTranscodage } from "./transcode-worker";

/**
 * L'implémentation navigateur du `MediaEnvironment` que le pipeline (spec 08) attend
 * injecté. Le paquet reste sans DOM ; c'est ici que les APIs du navigateur entrent.
 */

/**
 * Ce qui manque au shard pour produire les formats de sortie imposés. **Lever avec un type
 * nommé, jamais rendre un blob approximatif** : un vocal qui n'est pas de l'Ogg/Opus est
 * illisible par les clients Matrix standards (D-03), et une vidéo non transcodée partirait
 * au format brut de l'appareil, à des dizaines de mégaoctets.
 *
 * Ce qui manque est plus étroit qu'un codec : Firefox enregistre déjà en Ogg/Opus, Chrome
 * produit du flux Opus dans un conteneur WebM (il manque un remuxage), et WebCodecs encode
 * la vidéo (il manque un muxeur MP4). Seul Safari, qui rend du MP4/AAC, demande un vrai
 * encodeur. Le détail est dans ESCALATIONS § E-10 — c'est ce qui rend l'arbitrage ouvert
 * plutôt que joué d'avance.
 *
 * L'UI ne propose pas ces deux chemins tant qu'ils ne sont pas couverts : c'est la seule
 * façon honnête de ne pas afficher une fonction qui échouerait (interdit n°13).
 *
 * **Arbitré (E-10, 06/08/2026) : encodage dans le shard, empaquetage dans le paquet.** Le
 * remuxage WebM → Ogg et le muxeur MP4 vivent dans `@tacita/media-pipeline` ; la vidéo et
 * les vocaux Chrome/Edge/Firefox sont couverts.
 *
 * Reste `transcodeAudio`, appelé pour le seul chemin Safari/iOS (MP4/AAC → Opus). Il lève
 * tant que le spike E-10 n'a pas dit si `WebCodecs` encode l'Opus sur les iOS ciblés ;
 * selon sa réponse, l'implémentation sera un `AudioEncoder` ici, ou un encodeur WASM
 * **dans le paquet** — jamais une dépendance d'`apps/web`, REQ-UI-02 restant close.
 */
export class TranscodageIndisponible extends Error {
  constructor(quoi: "video" | "audio", detail?: string) {
    super(detail ?? `transcodage ${quoi} indisponible dans le shard : voir ESCALATIONS E-10`);
    this.name = "TranscodageIndisponible";
  }
}

/**
 * File System Access API — absente de Firefox et Safari, d'où la lecture conditionnelle.
 * Les types du DOM ne la déclarent pas encore ; c'est le seul cast du fichier.
 */
const choisirFichier = (
  globalThis as unknown as {
    showSaveFilePicker?: (options: { suggestedName: string }) => Promise<{
      createWritable(): Promise<{ write(data: Blob | Uint8Array): Promise<void>; close(): Promise<void> }>;
    }>;
  }
).showSaveFilePicker;

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

    // REQ-MED-04 — démuxage par le paquet, décodage et réencodage par `WebCodecs`,
    // empaquetage par le muxeur du paquet (E-10). Le shard n'écrit aucun format.
    //
    // **Dans un worker**, comme la spec 08 l'exige depuis l'origine : un transcodage tient
    // le processeur pendant des secondes, et sur le thread de rendu c'est la timeline qui
    // se fige. Un worker par transcodage, terminé aussitôt après — pas de pool à tenir
    // pour une opération que l'utilisateur déclenche une fois de temps en temps.
    transcodeVideo: (blob, cibles) =>
      new Promise((resoudre, rejeter) => {
        const worker = new Worker(new URL("./transcode-worker.ts", import.meta.url));
        worker.onmessage = ({ data }: MessageEvent<ReponseTranscodage>) => {
          worker.terminate();
          if (data.ok) resoudre({ blob: data.blob, width: data.width, height: data.height, durationMs: data.durationMs });
          else rejeter(new TranscodageIndisponible("video", data.message));
        };
        worker.onerror = () => {
          worker.terminate();
          rejeter(new TranscodageIndisponible("video"));
        };
        worker.postMessage({ blob, cibles } satisfies DemandeTranscodage);
      }),

    transcodeAudio() {
      return Promise.reject(new TranscodageIndisponible("audio"));
    },

    /**
     * REQ-MED-05 — l'original non compressé, sur l'appareil. `showSaveFilePicker` est
     * absent de Firefox et Safari ; `saveOriginal` retombe alors sur le téléchargement.
     */
    saveViaFilePicker: choisirFichier
      ? async (blob, filename) => {
          const flux = await (await choisirFichier({ suggestedName: filename })).createWritable();
          await flux.write(blob);
          await flux.close();
        }
      : undefined,

    /**
     * REQ-MED-15 — le **flux** de la même API, pour écrire un gros média tranche par
     * tranche. Même absence que `saveViaFilePicker` sur Firefox et Safari : le pipeline
     * retombe alors sur le chemin tout-ou-rien, borné par `SEUILS.dur`.
     */
    ouvrirEcriture: choisirFichier
      ? async (filename) => {
          const flux = await (await choisirFichier({ suggestedName: filename })).createWritable();
          return {
            // `write` du FileSystemWritableFileStream accepte les deux ; le type du
            // paquet ne promet que ce que les deux appelants passent réellement.
            write: (donnees) => flux.write(donnees as Blob),
            close: () => flux.close(),
          };
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
