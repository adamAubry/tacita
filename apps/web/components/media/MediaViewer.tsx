"use client";

import { useEffect, useState, type CSSProperties } from "react";

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

  /*
   * **L'URL du blob, pas l'objet `Media`** — même raison que dans `useBlob` (voir le long
   * commentaire de `MediaMessage`), et c'est ici qu'elle coûtait le plus cher.
   *
   * `Conversation` reconstruit ses `Media` à chaque tour de `/sync` : tant que l'effet
   * dépendait de l'objet, une vidéo ouverte était **re-téléchargée et re-déchiffrée
   * pendant sa lecture**, toutes les quelques secondes, et le `<video>` repartait de zéro
   * à chaque fois puisque sa source changeait. C'est le « on déchiffre 2 secondes par
   * 2 secondes » des retours d'usage.
   */
  const cle = media?.fichier.url;

  useEffect(() => {
    if (!media) return;
    let objet: string | undefined;
    let vivant = true;

    // Le type vient de l'événement : sans lui, le blob est `application/octet-stream` et
    // le lecteur ne sait pas quel conteneur il ouvre (voir `Media.mime`).
    void telecharger(media.fichier, media.mime).then((blob) => {
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
    // `media` est volontairement absent : `cle` **est** son identité (voir ci-dessus).
  }, [cle, telecharger]);

  /*
   * `Escape` ferme, comme toute boîte de dialogue modale. Le viewer ne se fermait qu'au
   * glissement vers le bas et au bouton « Fermer » : sur un clavier, une modale plein
   * écran qu'aucune touche ne referme est un piège, et c'est la base de l'accessibilité,
   * pas un raffinement. Mesuré au navigateur le 08/08/2026 — `Escape` ne faisait rien.
   */
  useEffect(() => {
    const surTouche = (evenement: KeyboardEvent) => {
      if (evenement.key === "Escape") onFermer();
    };
    globalThis.addEventListener("keydown", surTouche);
    return () => globalThis.removeEventListener("keydown", surTouche);
  }, [onFermer]);

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
      style={
        {
          position: "fixed",
          inset: 0,
          display: "grid",
          gridTemplateRows: "auto 1fr auto",
          /*
           * Le viewer est le seul endroit sombre de l'app, dans les deux thèmes : une
           * photo se regarde sur un fond neutre, pas sur du blanc (DESIGN.md § Colors,
           * `viewer`).
           *
           * Ce fond était `--color-background-inverted`, le fond inversé d'Astryx — qui
           * **suit le thème** (donc blanc en sombre) et vaut exactement `text`, la couleur
           * d'encre que les boutons ghost d'Astryx posent dessus. Les quatre commandes du
           * viewer étaient de la couleur de leur propre fond : « Fermer » existait,
           * répondait au clic, et ne se voyait pas — d'où « on ne peut pas fermer une
           * photo » dans les retours d'usage.
           *
           * Les tokens d'encre sont donc redéfinis **dans la portée du viewer** : ses
           * enfants sont des composants Astryx, qui lisent ces variables et rien d'autre.
           * Les remapper ici les couvre tous, y compris ceux qu'on y ajoutera ; les
           * habiller un par un laisserait le prochain naître invisible.
           */
          background: "var(--tacita-viewer)",
          "--color-text-primary": "var(--tacita-sur-viewer)",
          "--color-icon-primary": "var(--tacita-sur-viewer)",
          "--color-text-secondary": "var(--tacita-sur-viewer-muet)",
          "--color-icon-secondary": "var(--tacita-sur-viewer-muet)",
          "--color-text-disabled": "var(--tacita-sur-viewer-muet)",
          "--color-icon-disabled": "var(--tacita-sur-viewer-muet)",
          touchAction: "none",
          zIndex: 10,
        } as CSSProperties
      }
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
            // WCAG 2.1.1 — le zoom est porté par un `<button>` et non par l'image :
            // une `<img onClick>` n'est ni focusable ni actionnable au clavier, et le
            // geste n'avait aucun équivalent visible (DESIGN.md : « chaque geste a un
            // équivalent »). Le bouton est transparent et épouse l'image ; c'est le même
            // tap, avec en plus une cible que le clavier et l'assistance atteignent.
            <button
              type="button"
              aria-label={`${media.nom} — agrandir (niveau ${zoom} sur ${ZOOM_MAX})`}
              // Tap = palier suivant, puis retour à 1. Un tableau et un `indexOf` pour
              // trois entiers consécutifs, c'était une addition déguisée.
              onClick={() => setZoom((niveau) => (niveau >= ZOOM_MAX ? 1 : niveau + 1))}
              style={{
                background: "none",
                border: "none",
                padding: 0,
                cursor: "zoom-in",
                maxWidth: "100%",
                maxHeight: "100%",
              }}
            >
              <img
                src={url}
                alt={media.nom}
                style={{
                  transform: `scale(${zoom})`,
                  transformOrigin: "center",
                  maxWidth: "100%",
                  maxHeight: "100%",
                  display: "block",
                }}
              />
            </button>
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
