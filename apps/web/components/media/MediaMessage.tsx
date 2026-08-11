"use client";

import type { EncryptedFile } from "@tacita/media-pipeline";
import { useEffect, useState } from "react";

import { Skeleton, Text } from "../foundation/primitives";
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
  }, [fichier, telecharger, mimeType]);

  return { url, erreur };
}

/**
 * La géométrie de la tuile. Deux nombres et pas un style : le squelette et l'image les
 * lisent tous les deux, et c'est ce partage qui fait que la timeline ne saute pas.
 */
const LARGEUR_TUILE = 240;
const HAUTEUR_TUILE_MAX = 320;

export interface MediaMessageProps {
  media: Media;
  telecharger: Telecharger;
  /** Ouvre le viewer plein écran (REQ-UIX-16). Absent sur audio et fichier. */
  onOuvrir?: () => void;
}

/**
 * REQ-UI-14 — le rendu d'une pièce jointe dans la timeline.
 *
 * **La vignette vient du blob déchiffré**, jamais de l'endpoint `thumbnail` du serveur
 * (interdit n°5) : il ne peut pas redimensionner ce qu'il ne déchiffre pas, et le
 * pipeline a chiffré une vignette séparée pour ça (REQ-MED-03).
 *
 * Un média qu'on n'a pas encore déchiffré rend un Skeleton **de la même géométrie**, pour
 * que l'arrivée de l'image ne déplace pas la timeline (DESIGN.md).
 */
export function MediaMessage({ media, telecharger, onOuvrir }: MediaMessageProps) {
  // La vignette d'abord : c'est elle qui est petite. Le média entier n'est déchiffré
  // qu'à l'ouverture du viewer.
  const visuel = useBlob(media.vignette ?? undefined, telecharger, "image/jpeg");
  const audio = useBlob(media.msgtype === "m.audio" ? media.fichier : undefined, telecharger);

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

  if (!visuel.url) return <Skeleton width={LARGEUR_TUILE} height={hauteur} />;

  return (
    <div style={{ display: "grid", gap: "var(--spacing-1)", justifyItems: "start" }}>
      {/*
        Un `<button>` nu, et non le `Button` d'Astryx : celui-ci est un contrôle de
        formulaire à **hauteur fixe** (`--size-element-md`, 32 px) avec son rembourrage
        horizontal. Une vignette de 240 px y était placée en enfant — l'image débordait
        d'un cadre huit fois trop court, se posait par-dessus les messages voisins et
        l'alignement de toute la colonne partait avec elle. C'était le défaut visible de
        l'envoi de photo.

        Le motif est celui du zoom dans `MediaViewer` : un bouton transparent qui épouse
        son image, ce qui garde la cible clavier et l'étiquette accessible sans imposer la
        géométrie d'un bouton à une photo.
      */}
      <button
        type="button"
        aria-label={
          media.msgtype === "m.video"
            ? `Vidéo ${media.nom}${media.dureeMs ? `, ${dureeLisible(media.dureeMs)}` : ""}`
            : `Image ${media.nom}`
        }
        onClick={onOuvrir}
        style={{
          width: LARGEUR_TUILE,
          height: hauteur,
          maxWidth: "100%",
          padding: 0,
          border: "none",
          background: "none",
          borderRadius: "var(--radius-container)",
          overflow: "hidden",
          cursor: onOuvrir ? "pointer" : "default",
          display: "block",
        }}
      >
        <img
          src={visuel.url}
          alt={media.nom}
          // `cover` sur une boîte au ratio de l'original ne rogne rien ; il ne rogne que
          // le repli 4:3, là où l'événement ne dit pas ses dimensions.
          style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
        />
      </button>

      {media.msgtype === "m.video" && media.dureeMs !== undefined && (
        <Text type="supporting" color="secondary" hasTabularNumbers>
          {dureeLisible(media.dureeMs)}
        </Text>
      )}
    </div>
  );
}
