import {
  ecrireMp4,
  TIMESCALE_US,
  type Bytes,
  type EchantillonVideo,
  type Raster,
} from "@tacita/media-pipeline";

/**
 * REQ-MED-04, côté shard — **l'encodage vit ici, l'empaquetage dans le paquet** (E-10).
 *
 * Le navigateur décode (une balise `video` sait démuxer ce qu'un téléphone produit),
 * `WebCodecs` réencode aux cibles D-04, et `ecrireMp4` range le résultat. Aucun démuxeur à
 * écrire : c'est ce qui rend ce chemin tenable sans dépendance.
 */

/** Codec de sortie : H.264 baseline niveau 3.1, le plus largement décodé. */
const CODEC = "avc1.42001f";

/** Une image clé toutes les deux secondes : sans elles, aucun déplacement dans la vidéo. */
const INTERVALLE_CLE_US = 2 * TIMESCALE_US;

/**
 * Dimensions cibles : on réduit à la hauteur demandée, jamais on n'agrandit, et les deux
 * côtés sont **pairs** — H.264 encode par macroblocs et refuse une dimension impaire.
 */
export function dimensionsCibles(largeur: number, hauteur: number, hauteurCible: number) {
  const facteur = Math.min(1, hauteurCible / hauteur);
  const pair = (valeur: number) => Math.max(2, Math.round(valeur * facteur / 2) * 2);
  return { largeur: pair(largeur), hauteur: pair(hauteur) };
}

/**
 * Recopie les octets d'une description de codec — **une copie, jamais une vue** :
 * `WebCodecs` réutilise ses tampons, et garder une vue rendrait la description
 * silencieusement fausse au morceau suivant.
 */
function copier(source: AllowSharedBufferSource): Bytes {
  const vue = ArrayBuffer.isView(source)
    ? new Uint8Array(source.buffer as ArrayBuffer, source.byteOffset, source.byteLength)
    : new Uint8Array(source as ArrayBuffer);
  return new Uint8Array(vue);
}

/** `true` si ce navigateur sait encoder du H.264 à ces dimensions. Mesuré, jamais supposé. */
export async function videoTranscodable(hauteur: number): Promise<boolean> {
  if (typeof VideoEncoder === "undefined") return false;
  try {
    const { supported } = await VideoEncoder.isConfigSupported({
      codec: CODEC,
      width: Math.round((hauteur * 16) / 9 / 2) * 2,
      height: hauteur,
    });
    return supported === true;
  } catch {
    return false;
  }
}

/**
 * ponytail: la vidéo est relue **en temps réel** pour être décodée — une minute de vidéo
 * prend une minute. Le raccourci serait un démuxeur MP4 côté paquet, qui alimenterait
 * `VideoDecoder` directement ; c'est un second format binaire à écrire, pour un gain qui ne
 * se mesure que sur les longues vidéos. À reprendre si l'attente devient le reproche.
 */
export async function transcoderVideo(
  blob: Blob,
  cibles: { height: number; bitrate: number },
): Promise<Raster & { durationMs: number }> {
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.src = URL.createObjectURL(blob);

  try {
    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve();
      video.onerror = () => reject(new Error("vidéo illisible : transcodage impossible"));
    });

    const { largeur, hauteur } = dimensionsCibles(
      video.videoWidth,
      video.videoHeight,
      cibles.height,
    );

    const echantillons: EchantillonVideo[] = [];
    let description: Bytes | undefined;

    const encodeur = new VideoEncoder({
      output: (morceau, metadonnees) => {
        // La description n'arrive qu'avec le premier morceau, et une seule fois : sans
        // elle, `ecrireMp4` refuse — un MP4 sans paramètres de codec ne décode pas.
        const brute = metadonnees?.decoderConfig?.description;
        if (brute && !description) description = copier(brute);

        const donnees = new Uint8Array(morceau.byteLength);
        morceau.copyTo(donnees);
        echantillons.push({
          donnees,
          timestampUs: morceau.timestamp,
          cle: morceau.type === "key",
        });
      },
      error: () => {
        /* L'erreur remonte par `flush()` ; la journaliser ici citerait le média. */
      },
    });

    encodeur.configure({
      codec: CODEC,
      width: largeur,
      height: hauteur,
      bitrate: cibles.bitrate,
      // `avc: { format: "avc" }` produit des NAL préfixées de leur longueur — la forme
      // qu'attend un MP4. Le défaut (`annexb`) donnerait un flux illisible en conteneur.
      avc: { format: "avc" },
    });

    const canvas = new OffscreenCanvas(largeur, hauteur);
    const contexte = canvas.getContext("2d");
    if (!contexte) throw new Error("contexte 2d indisponible : transcodage impossible");

    let derniereCleUs = -INTERVALLE_CLE_US;

    await new Promise<void>((resolve, reject) => {
      const surImage = (_temps: number, metadonnees: { mediaTime: number }) => {
        const timestamp = Math.round(metadonnees.mediaTime * TIMESCALE_US);
        contexte.drawImage(video, 0, 0, largeur, hauteur);

        const cle = timestamp - derniereCleUs >= INTERVALLE_CLE_US;
        if (cle) derniereCleUs = timestamp;

        const image = new VideoFrame(canvas, { timestamp });
        encodeur.encode(image, { keyFrame: cle });
        image.close();

        if (!video.ended) video.requestVideoFrameCallback(surImage);
      };

      video.onended = () => resolve();
      video.onerror = () => reject(new Error("lecture interrompue : transcodage abandonné"));
      video.requestVideoFrameCallback(surImage);
      void video.play();
    });

    await encodeur.flush();
    encodeur.close();

    if (!description) throw new Error("aucun paramètre de codec produit : transcodage abandonné");

    return {
      blob: new Blob([ecrireMp4({ largeur, hauteur, description, echantillons }) as BlobPart], {
        type: "video/mp4",
      }),
      width: largeur,
      height: hauteur,
      durationMs: Math.round(video.duration * 1000),
    };
  } finally {
    URL.revokeObjectURL(video.src);
  }
}
