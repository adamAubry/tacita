import type { Session } from "@tacita/client-core";
import { uploadPublicProfileImage } from "@tacita/media-pipeline";
import { poserImagesParDefaut, TAILLE_IDENTITE } from "@tacita/messaging";

import { environnementMedia } from "./media-env";

/**
 * le câblage des images par défaut : le paquet dessine, le
 * shard trame, le pipeline téléverse.
 *
 * Ce découpage n'est pas un goût d'architecture. Le dessin est déterministe et sans DOM,
 * donc il appartient au paquet (et c'est là que DiceBear est installé : tient
 * la liste des dépendances du shard close, même jurisprudence qu'E-10 pour les codecs).
 * La trame, elle, a besoin d'un canvas, et le canvas n'entre que par ici — comme
 * `media-env` pour le reste du pipeline.
 */

/**
 * SVG → PNG, par le canvas.
 *
 * **Le détour par le PNG n'est pas décoratif** : le pipeline compresse toute image
 * publique en passant par `createImageBitmap`, que Firefox refuse encore sur un blob
 * `image/svg+xml`. Un SVG confié tel quel au pipeline aurait donc marché chez nous et
 * échoué chez un utilisateur — le pire des deux, parce que rien ne l'aurait dit. Une
 * balise `Image` sait décoder le SVG partout, et c'est tout ce qu'il fallait.
 *
 * Le PNG produit ici repasse ensuite par la compression normale du pipeline : c'est du
 * travail en double sur quelques kilo-octets, une fois dans la vie d'un compte, contre
 * un second chemin d'envoi que l'interdit n°11 refuse.
 */
async function tramer(svg: string): Promise<File> {
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  try {
    const image = new Image();
    image.src = url;
    // `decode()` et non `onload` : il rend une promesse et garantit que l'image est
    // décodée — `onload` peut précéder le décodage et donner un dessin vide.
    await image.decode();

    const canvas = new OffscreenCanvas(TAILLE_IDENTITE, TAILLE_IDENTITE);
    const contexte = canvas.getContext("2d");
    if (!contexte) throw new Error("contexte 2d indisponible : identité non tramée");

    contexte.drawImage(image, 0, 0, TAILLE_IDENTITE, TAILLE_IDENTITE);
    const blob = await canvas.convertToBlob({ type: "image/png" });
    return new File([blob], "identite.png", { type: "image/png" });
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * **le téléversement d'une image publique de profil, pour tout le shard.**
 *
 * Le chemin public du pipeline n'a que deux sites d'appel dans le dépôt, et un test
 * structurel du paquet média échoue s'il en apparaît un troisième. Ce fichier en est un ;
 * tout écran qui a besoin de poser une photo ou une bannière passe donc par ici plutôt
 * que d'en ouvrir un nouveau — l'étape d'identité du parcours d'accueil comme le
 * formulaire de profil.
 */
export const televerserImageProfil = (session: Session, fichier: File): Promise<string> =>
  uploadPublicProfileImage(session, environnementMedia(), fichier);

/**
 * appelée une fois, à la création du compte (parcours d'accueil, M-B).
 *
 * **le second des deux sites d'appel du chemin public**, et le test
 * structurel du paquet média les nomme tous les deux. Ces images sont publiques et non
 * chiffrées exactement comme la photo qu'elles remplacent : elles n'ajoutent aucune
 * exception, elles empruntent celle qui existe.
 */
export async function poserIdentiteParDefaut(session: Session): Promise<void> {
  await poserImagesParDefaut(session, async (svg) =>
    televerserImageProfil(session, await tramer(svg)),
  );
}
