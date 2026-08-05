"use client";

import type { EncryptedFile } from "@tacita/media-pipeline";
import { useEffect, useState } from "react";

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

  if (!visuel.url) return <Skeleton width={240} height={180} />;

  return (
    <Button
      label={
        media.msgtype === "m.video"
          ? `Vidéo ${media.nom}${media.dureeMs ? `, ${dureeLisible(media.dureeMs)}` : ""}`
          : `Image ${media.nom}`
      }
      variant="ghost"
      onClick={onOuvrir}
    >
      <img
        src={visuel.url}
        alt={media.nom}
        style={{
          maxWidth: 240,
          maxHeight: 240,
          borderRadius: "var(--radius-container)",
          display: "block",
        }}
      />
      {media.msgtype === "m.video" && media.dureeMs !== undefined && (
        <Text type="supporting" color="secondary" hasTabularNumbers>
          {dureeLisible(media.dureeMs)}
        </Text>
      )}
    </Button>
  );
}
