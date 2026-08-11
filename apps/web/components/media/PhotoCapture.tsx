"use client";

import { useEffect, useRef, useState } from "react";

import { Button, Text } from "../foundation/primitives";
import { Sheet } from "../foundation/Sheet";

/**
 * Deux causes distinctes, deux phrases : un refus se rattrape dans les réglages du
 * navigateur, une API absente ne se rattrape pas du tout. Les confondre enverrait
 * quelqu'un chercher une autorisation qui n'existe pas sur son appareil (interdit n°13).
 */
const REFUS = {
  refuse:
    "L'accès à la caméra a été refusé. Autorisez-le dans les réglages de votre navigateur, puis rouvrez cet écran.",
  indisponible:
    "Ce navigateur ne donne pas accès à la caméra. Vous pouvez joindre une photo déjà prise avec le bouton « + ».",
} as const;

/**
 * La boîte de l'aperçu, **partagée par le flux et par la photo prise** : la feuille garde
 * la même hauteur au déclenchement au lieu de sauter entre deux tailles intrinsèques.
 */
const APERCU = {
  width: "100%",
  maxHeight: "50dvh",
  objectFit: "cover",
  borderRadius: "var(--radius-container)",
  background: "var(--color-background-inverted)",
  display: "block",
} as const;

export interface PhotoCaptureProps {
  ouvert: boolean;
  onFermer: () => void;
  /**
   * REQ-UI-15 — deux gestes distincts sur la **même** prise : l'original non compressé
   * reste sur l'appareil, la version compressée part au correspondant.
   */
  onEnregistrer: (original: Blob, nom: string) => Promise<void> | void;
  onEnvoyer: (photo: File) => void;
}

/**
 * REQ-UI-15 — capture photo in-app.
 *
 * **La permission est demandée au moment de l'usage**, jamais à l'avance (DESIGN.md), et
 * un refus est expliqué et rattrapable : il n'y a pas d'écran mort.
 *
 * ponytail: photo seulement, pas de vidéo. La capture vidéo produirait du WebM ou du
 * MP4/AAC selon l'appareil, qu'il faudrait transcoder pour envoyer (spec 08, D-04) — et
 * ce transcodage n'existe pas dans le shard (ESCALATIONS § E-10). Le bouton n'existe donc
 * pas non plus.
 */
export function PhotoCapture({ ouvert, onFermer, onEnregistrer, onEnvoyer }: PhotoCaptureProps) {
  const video = useRef<HTMLVideoElement>(null);
  const [flux, setFlux] = useState<MediaStream>();
  const [refus, setRefus] = useState<keyof typeof REFUS>();
  const [prise, setPrise] = useState<{ blob: Blob; url: string; nom: string }>();

  useEffect(() => {
    if (!ouvert) {
      // **La prise ne survit pas à la fermeture.** Sans cette remise à zéro, la feuille
      // rouverte affichait la photo précédente à la place de la caméra : la photo restait
      // au premier plan d'un écran censé en prendre une nouvelle, et le seul moyen d'en
      // sortir était de recharger la page. `<dialog>` garde son contenu dans le DOM même
      // fermé, donc rien ne la retirait de lui-même.
      setPrise(undefined);
      setRefus(undefined);
      return;
    }

    let vivant = true;
    let ouvert_: MediaStream | undefined;

    // Hors contexte sécurisé — et sur les navigateurs qui ne l'implémentent pas —
    // `mediaDevices` est absent. L'optionnel court-circuitait toute la chaîne : aucun
    // flux, aucune erreur, et un bouton désactivé sans un mot d'explication. C'est
    // l'écran mort que ce composant dit ne pas avoir.
    if (!navigator.mediaDevices) {
      setRefus("indisponible");
      return;
    }

    void navigator.mediaDevices
      .getUserMedia({ video: { facingMode: "environment" } })
      .then((obtenu) => {
        if (!vivant) return obtenu.getTracks().forEach((piste) => piste.stop());
        ouvert_ = obtenu;
        setFlux(obtenu);
        if (video.current) video.current.srcObject = obtenu;
      })
      .catch(() => vivant && setRefus("refuse"));

    return () => {
      vivant = false;
      // La caméra s'éteint avec la feuille : une pastille d'enregistrement qui reste
      // allumée après la fermeture est une trahison de confiance, pas une fuite mémoire.
      ouvert_?.getTracks().forEach((piste) => piste.stop());
      setFlux(undefined);
    };
  }, [ouvert]);

  useEffect(() => () => {
    if (prise) URL.revokeObjectURL(prise.url);
  }, [prise]);

  const capturer = async () => {
    const element = video.current;
    if (!element) return;
    const canvas = document.createElement("canvas");
    canvas.width = element.videoWidth;
    canvas.height = element.videoHeight;
    canvas.getContext("2d")?.drawImage(element, 0, 0);

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 1));
    // Le nom est figé **avec la prise**, pas recalculé à chaque rendu : il portait
    // l'horodatage de l'instant du rendu, si bien que la copie enregistrée sur l'appareil
    // et celle envoyée au correspondant — la même photo — sortaient sous deux noms
    // différents dès qu'une seconde s'était écoulée entre les deux clics.
    const nom = `photo-${new Date().toISOString().slice(0, 19).replaceAll(":", "-")}.jpg`;
    if (blob) setPrise({ blob, url: URL.createObjectURL(blob), nom });
  };

  return (
    <Sheet ouvert={ouvert} onFermer={onFermer} nom="Prendre une photo">
      <div style={{ display: "grid", gap: "var(--spacing-3)", padding: "var(--spacing-3)" }}>
        {refus ? (
          <Text type="body">{REFUS[refus]}</Text>
        ) : prise ? (
          <>
            <img src={prise.url} alt="Photo prise" style={APERCU} />

            {/* REQ-UI-15 — les deux libellés sont **distincts et explicites** : ce qui
                reste sur l'appareil est l'original, ce qui part est compressé. Confondre
                les deux ferait croire que le correspondant reçoit la pleine qualité.

                L'envoi est la primaire : c'est ce qu'on vient faire dans une conversation.
                Les deux autres sont secondaire et fantôme, dans l'ordre où on y pense. */}
            <Button
              label="Envoyer (version compressée)"
              variant="primary"
              onClick={() => {
                onEnvoyer(new File([prise.blob], prise.nom, { type: "image/jpeg" }));
                onFermer();
              }}
            />
            <Button
              label="Enregistrer sur votre appareil (original)"
              variant="secondary"
              onClick={() => void onEnregistrer(prise.blob, prise.nom)}
            />
            <Button label="Reprendre" variant="ghost" onClick={() => setPrise(undefined)} />
          </>
        ) : (
          <>
            {/*
              Flux de la caméra : aucune piste de sous-titres à fournir, et l'aperçu est
              décrit par son `aria-label`.

              La taille est **imposée**. Un `<video>` prend la résolution de son flux comme
              taille intrinsèque : 1280 × 720 pour une caméra ordinaire, dans une feuille
              large de 390 px. L'aperçu débordait donc de la feuille sur trois côtés et
              emportait la mise en page avec lui. Il partage maintenant sa boîte avec la
              photo prise, ce qui évite en plus que la feuille saute au moment du
              déclenchement.
            */}
            <video ref={video} autoPlay playsInline muted aria-label="Aperçu de la caméra" style={APERCU} />
            <Button
              label="Prendre la photo"
              variant="primary"
              isDisabled={!flux}
              onClick={() => void capturer()}
            />
          </>
        )}
      </div>
    </Sheet>
  );
}
