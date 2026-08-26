"use client";

import type { EncryptedFile } from "@tacita/media-pipeline";
import { useEffect, useState } from "react";

import { IconeImage, IconeVideo } from "../foundation/icons";
import { Button, Skeleton, Text } from "../foundation/primitives";
import { VoicePlayer } from "./VoicePlayer";
import { dureeLisible, tailleLisible, type Media, type Telecharger } from "./media";

/**
 * Déchiffre une pièce jointe et rend une URL d'objet, révoquée au démontage.
 *
 * Un `URL.createObjectURL` non révoqué garde le blob **déchiffré** en mémoire pour la
 * durée du document : sur une timeline de photos, c'est l'historique en clair qui
 * s'accumule. La révocation n'est pas une politesse de performance.
 */
function useBlob(fichier: EncryptedFile | undefined, telecharger: Telecharger, mimeType?: string) {
  const [url, setUrl] = useState<string>();
  const [erreur, setErreur] = useState(false);

  /*
   * **La dépendance est l'URL du blob, pas l'objet qui la porte.**
   *
   * `mediaDe()` reconstruit un objet `Media` — et donc un `EncryptedFile` — à chaque appel,
   * et ses appelants l'appellent à chaque rendu : le mémo de `Conversation` se recalcule à
   * chaque tour de `/sync`, la galerie appelle `mediaDe` directement dans son rendu. Le
   * contenu est identique, l'identité non ; un effet qui dépend de l'objet se relançait
   * donc à chaque événement de la conversation — frappe, accusé, déchiffrement d'un
   * message voisin.
   *
   * Ce que ça coûtait : chaque vignette de la timeline re-téléchargée et re-déchiffrée en
   * boucle, et surtout, dans le viewer, la vidéo entière re-déchiffrée pendant qu'on la
   * regarde — sa source changeait sous elle et la lecture repartait de zéro. C'est le
   * « on déchiffre 2 secondes par 2 secondes » des retours d'usage : le chiffrement n'y
   * était pour rien, la boucle de rendu pour tout.
   *
   * Un `mxc://` désigne un blob immuable : deux `EncryptedFile` de même URL portent les
   * mêmes octets et les mêmes clés. C'est l'identité qui compte ici, et la seule stable.
   */
  const cle = fichier?.url;

  useEffect(() => {
    if (!fichier) return;
    let objet: string | undefined;
    let vivant = true;

    void telecharger(fichier, mimeType)
      .then((blob) => {
        if (!vivant) return;
        objet = URL.createObjectURL(blob);
        setUrl(objet);
      })
      .catch(() => vivant && setErreur(true));

    return () => {
      vivant = false;
      if (objet) URL.revokeObjectURL(objet);
    };
    // `fichier` est volontairement absent : `cle` **est** son identité (voir ci-dessus).
  }, [cle, telecharger, mimeType]);

  return { url, erreur };
}

/**
 * La géométrie de la tuile. Deux nombres et pas un style : le squelette et l'image les
 * lisent tous les deux, et c'est ce partage qui fait que la timeline ne saute pas.
 */
const LARGEUR_TUILE = 240;
const HAUTEUR_TUILE_MAX = 320;

interface MediaMessageProps {
  media: Media;
  telecharger: Telecharger;
  /** Ouvre le viewer plein écran. Absent sur audio et fichier. */
  onOuvrir?: () => void;
  /**
   * sauvegarde sur l'appareil, déléguée au pipeline par le câblage.
   *
   * Elle n'existait **que** dans le viewer plein écran, qui ne s'ouvre que sur une image
   * ou une vidéo : un PDF, un ZIP ou un document reçu s'affichait en tuile, sans une
   * seule façon d'en sortir les octets. Le fichier était là, déchiffrable, et
   * inatteignable — signalé tel quel par les utilisateurs.
   */
  onSauvegarder?: () => void;
  /**
   * la tuile **remplit sa cellule, en carré**, pour la grille de la galerie.
   *
   * Deux contextes, deux géométries : dans la timeline une photo garde le cadrage de son
   * auteur, parce qu'elle *est* le message ; dans une galerie elle devient une planche
   * contact, où le carré régulier est ce qui rend la grille lisible d'un coup d'œil. C'est
   * la même règle que celle d'Instagram, et pour la même raison — trois cadrages
   * différents par ligne donnent une grille en dents de scie qu'on ne balaie plus.
   */
  carre?: boolean;
}

/**
 * le rendu d'une pièce jointe dans la timeline.
 *
 * **La vignette vient du blob déchiffré**, jamais de l'endpoint `thumbnail` du serveur
 * (interdit n°5) : il ne peut pas redimensionner ce qu'il ne déchiffre pas, et le
 * pipeline a chiffré une vignette séparée pour ça.
 *
 * Un média qu'on n'a pas encore déchiffré rend un Skeleton **de la même géométrie**, pour
 * que l'arrivée de l'image ne déplace pas la timeline (DESIGN.md).
 */
export function MediaMessage({
  media,
  telecharger,
  onOuvrir,
  onSauvegarder,
  carre = false,
}: MediaMessageProps) {
  // La vignette d'abord : c'est elle qui est petite. Le média entier n'est déchiffré
  // qu'à l'ouverture du viewer.
  // Le type vient de `thumbnail_info` : la vignette est en WebP depuis qu'elle a doublé
  // de côté, et en JPEG là où l'expéditeur ne savait pas l'encoder.
  const visuel = useBlob(media.vignette ?? undefined, telecharger, media.vignetteMime ?? "image/jpeg");
  // Le type du blob vient de l'événement : un `<audio>` dont la source est un blob
  // `application/octet-stream` ne sait pas ce qu'il lit (voir `Media.mime`).
  const audio = useBlob(
    media.msgtype === "m.audio" ? media.fichier : undefined,
    telecharger,
    media.mime,
  );

  if (media.msgtype === "m.audio") {
    return (
      <VoicePlayer
        source={audio.url}
        dureeMs={media.dureeMs ?? 0}
        ondes={media.ondes}
      />
    );
  }

  if (media.msgtype === "m.file") {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--spacing-3)",
          padding: "var(--spacing-3)",
          border: "1px solid var(--color-border)",
          borderRadius: "var(--radius-container)",
          background: "var(--color-background-surface)",
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <Text type="body" maxLines={1}>
            {media.nom}
          </Text>
          <Text type="supporting" color="secondary" hasTabularNumbers>
            {media.taille === undefined ? "Fichier" : tailleLisible(media.taille)}
          </Text>
        </div>

        {/* Le nom du fichier porte le bouton, et pas l'inverse : la tuile entière n'est
            pas cliquable parce qu'un téléchargement n'est pas une navigation — il écrit
            sur l'appareil, et ça se demande explicitement. */}
        {onSauvegarder && (
          <Button label="Télécharger" variant="secondary" onClick={onSauvegarder} />
        )}
      </div>
    );
  }

  if (visuel.erreur) {
    // Le hash a été refusé, ou le blob est illisible : le paquet ne fait aucun repli
    // « meilleur effort », et l'UI ne doit pas en inventer un.
    return (
      <Text type="supporting" color="secondary">
        Ce média n'a pas pu être déchiffré.
      </Text>
    );
  }

  // La boîte de la tuile, **calculée avant le déchiffrement** : le squelette et l'image
  // partagent ces deux nombres, donc l'arrivée de la vignette ne déplace rien (DESIGN.md,
  // « Skeleton de même géométrie »). Le repli 4:3 ne sert qu'aux événements d'un client
  // qui n'écrit pas `info.w`/`info.h` ; le plafond garde une photo en mode portrait de
  // prendre toute la hauteur de l'écran.
  const hauteur = Math.min(
    media.largeur && media.hauteur
      ? Math.round((LARGEUR_TUILE * media.hauteur) / media.largeur)
      : Math.round((LARGEUR_TUILE * 3) / 4),
    HAUTEUR_TUILE_MAX,
  );

  // En grille, la cellule commande : la tuile prend toute sa largeur et se contraint au
  // carré. En timeline, c'est la photo qui commande, et elle garde le cadrage de son
  // auteur. Le squelette lit la même boîte dans les deux cas.
  const boite = carre
    ? ({ width: "100%", aspectRatio: "1 / 1" } as const)
    : ({ width: LARGEUR_TUILE, height: hauteur, maxWidth: "100%" } as const);

  /*
   * **Attendre une vignette qui existe est un chargement ; attendre une vignette qui
   * n'existe pas est une boucle sans fin.** Les deux se ressemblaient : `useBlob` rendu
   * sans fichier sort de son effet sans rien faire, donc ni `url` ni `erreur` — et le
   * squelette scintillait indéfiniment.
   *
   * Le cas est apparu le 21/08/2026, quand `thumbnail_file` est devenu facultatif côté
   * pipeline pour qu'un poster impossible n'emporte plus l'envoi. Le paquet a changé son
   * contrat, ce rendu supposait l'ancien : la jonction n'avait pas de propriétaire
   * (règle 1). Il en a un maintenant, et c'est cette ligne.
   */
  if (media.vignette !== undefined && !visuel.url)
    return carre ? (
      <div style={boite}>
        <Skeleton width="100%" height="100%" />
      </div>
    ) : (
      <Skeleton width={LARGEUR_TUILE} height={hauteur} />
    );

  /*
   * Pas de vignette, et il n'y en aura pas : une tuile **terminale**, de la même
   * géométrie, qui garde l'ouverture du viewer. Le média entier est là et se lira très
   * bien — c'est seulement son aperçu qui manque, et le dire par une image fixe vaut
   * mieux que de le suggérer par une animation qui promet une suite.
   */
  const sansVignette = (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--color-background-surface)",
        border: "1px solid var(--color-border)",
        color: "var(--color-icon-secondary)",
      }}
    >
      {media.msgtype === "m.video" ? IconeVideo : IconeImage}
    </div>
  );

  /*
    Un `<button>` nu, et non le `Button` d'Astryx : celui-ci est un contrôle de formulaire
    à **hauteur fixe** (`--size-element-md`, 32 px) avec son rembourrage horizontal. Une
    vignette de 240 px y était placée en enfant — l'image débordait d'un cadre huit fois
    trop court, se posait par-dessus les messages voisins et l'alignement de toute la
    colonne partait avec elle. C'était le défaut visible de l'envoi de photo.

    Le motif est celui du zoom dans `MediaViewer` : un bouton transparent qui épouse son
    image, ce qui garde la cible clavier et l'étiquette accessible sans imposer la
    géométrie d'un bouton à une photo.
  */
  const tuile = (
    <button
        type="button"
        aria-label={
          media.msgtype === "m.video"
            ? `Vidéo ${media.nom}${media.dureeMs ? `, ${dureeLisible(media.dureeMs)}` : ""}`
            : `Image ${media.nom}`
        }
        onClick={onOuvrir}
        style={{
          ...boite,
          padding: 0,
          border: "none",
          background: "none",
          // En grille, pas d'arrondi : c'est le pavage régulier qui fait la planche
          // contact, et douze coins ronds par écran le dissolvent en confettis.
          borderRadius: carre ? 0 : "var(--radius-container)",
          overflow: "hidden",
          cursor: onOuvrir ? "pointer" : "default",
          display: "block",
        }}
      >
        {visuel.url === undefined ? sansVignette : (
        <img
          src={visuel.url}
          alt={media.nom}
          // En timeline, `cover` sur une boîte au ratio de l'original ne rogne rien — il
          // ne rogne que le repli 4:3, là où l'événement ne dit pas ses dimensions. En
          // grille, il rogne au carré, et c'est **le but** : une planche contact se lit
          // par son pavage, pas par le cadrage de chaque photo.
          style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
        />
        )}
      </button>
  );

  // En grille, la cellule ne porte que la tuile : une légende sous une case romprait
  // l'alignement des lignes, et la durée est déjà dans le nom accessible du bouton.
  if (carre) return tuile;

  return (
    // La marge verticale est celle de la timeline **seule** : une photo y est un bloc
    // entre deux lignes de texte, et sans elle son bord touche le nom au-dessus et l'heure
    // en dessous. La grille, elle, ne la veut surtout pas — sa cellule est un pavé.
    <div
      style={{
        display: "grid",
        gap: "var(--spacing-1)",
        justifyItems: "start",
        margin: "var(--spacing-2) 0",
      }}
    >
      {tuile}

      {media.msgtype === "m.video" && media.dureeMs !== undefined && (
        <Text type="supporting" color="secondary" hasTabularNumbers>
          {dureeLisible(media.dureeMs)}
        </Text>
      )}
    </div>
  );
}
