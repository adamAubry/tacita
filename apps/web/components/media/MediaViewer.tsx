"use client";

import { useEffect, useState } from "react";

import { useGlissement } from "../../lib/gestes";
import { Button, Text } from "../foundation/primitives";
import type { Media, Telecharger } from "./media";

export interface MediaViewerProps {
  /** Les médias du salon, dans l'ordre de la timeline : la navigation les suit. */
  medias: Media[];
  /** Index d'ouverture. */
  depart: number;
  telecharger: Telecharger;
  onFermer: () => void;
  /** REQ-MED-05 — sauvegarde locale, déléguée au pipeline par le câblage. */
  onSauvegarder: (media: Media) => void;
}

const ZOOM_MAX = 3;

/**
 * REQ-UIX-16 — viewer plein écran : zoom, navigation entre les médias du salon,
 * sauvegarde, fermeture par geste vers le bas.
 *
 * Le média entier n'est déchiffré **qu'ici** : la timeline se contente des vignettes. Un
 * historique de photos ouvert en plein écran une par une, c'est une seule image en clair
 * en mémoire à la fois.
 */
export function MediaViewer({ medias, depart, telecharger, onFermer, onSauvegarder }: MediaViewerProps) {
  const [rang, setRang] = useState(depart);
  const [zoom, setZoom] = useState<number>(1);
  const [url, setUrl] = useState<string>();

  const media = medias[rang];

  useEffect(() => {
    if (!media) return;
    let objet: string | undefined;
    let vivant = true;

    void telecharger(media.fichier).then((blob) => {
      if (!vivant) return;
      objet = URL.createObjectURL(blob);
      setUrl(objet);
    });

    return () => {
      vivant = false;
      // Le blob en clair ne survit pas au média suivant.
      if (objet) URL.revokeObjectURL(objet);
      setUrl(undefined);
    };
  }, [media, telecharger]);

  // Fermeture par glissement **vers le bas** : le hook raisonne en horizontal, celui-ci
  // est vertical et local — deux axes, deux gestes, aucun partage à forcer.
  const [departY, setDepartY] = useState<number | null>(null);
  const horizontal = useGlissement({
    onGauche: () => setRang((r) => Math.min(r + 1, medias.length - 1)),
    onDroite: () => setRang((r) => Math.max(r - 1, 0)),
  });

  if (!media) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Média ${rang + 1} sur ${medias.length}`}
      onPointerDown={(evenement) => {
        setDepartY(evenement.clientY);
        horizontal.onPointerDown(evenement);
      }}
      onPointerUp={(evenement) => {
        if (departY !== null && evenement.clientY - departY > 96) onFermer();
        setDepartY(null);
        horizontal.onPointerUp(evenement);
      }}
      onPointerCancel={horizontal.onPointerCancel}
      style={{
        position: "fixed",
        inset: 0,
        display: "grid",
        gridTemplateRows: "auto 1fr auto",
        // Le viewer est le seul endroit sombre de l'app en thème clair : une photo se
        // regarde sur un fond neutre, pas sur du blanc.
        background: "var(--color-background-inverted)",
        touchAction: "none",
        zIndex: 10,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", padding: "var(--spacing-2)" }}>
        <Button label="Fermer" variant="ghost" onClick={onFermer} />
        <Button label="Sauvegarder" variant="ghost" onClick={() => onSauvegarder(media)} />
      </div>

      <div style={{ display: "grid", placeItems: "center", overflow: "auto" }}>
        {url ? (
          media.msgtype === "m.video" ? (
            // Pas de piste de sous-titres : une vidéo envoyée par un correspondant n'en
            // porte pas, et en inventer une serait pire que son absence.
            <video src={url} controls style={{ maxWidth: "100%", maxHeight: "100%" }} />
          ) : (
            <img
              src={url}
              alt={media.nom}
              // Tap = palier suivant, puis retour à 1. Un tableau et un `indexOf` pour
              // trois entiers consécutifs, c'était une addition déguisée.
              onClick={() => setZoom((niveau) => (niveau >= ZOOM_MAX ? 1 : niveau + 1))}
              style={{
                transform: `scale(${zoom})`,
                transformOrigin: "center",
                maxWidth: "100%",
                maxHeight: "100%",
              }}
            />
          )
        ) : (
          <Text type="supporting" color="secondary">
            Déchiffrement…
          </Text>
        )}
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "var(--spacing-2)" }}>
        <Button
          label="Précédent"
          variant="ghost"
          isDisabled={rang === 0}
          onClick={() => setRang((r) => Math.max(r - 1, 0))}
        />
        <Text type="supporting" color="secondary" hasTabularNumbers>
          {rang + 1} / {medias.length}
        </Text>
        <Button
          label="Suivant"
          variant="ghost"
          isDisabled={rang === medias.length - 1}
          onClick={() => setRang((r) => Math.min(r + 1, medias.length - 1))}
        />
      </div>
    </div>
  );
}
