"use client";

import { useEffect, useRef, useState } from "react";

import { Button, Text } from "../foundation/primitives";
import { Sheet } from "../foundation/Sheet";

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
  const [refus, setRefus] = useState(false);
  const [prise, setPrise] = useState<{ blob: Blob; url: string }>();

  useEffect(() => {
    if (!ouvert) return;
    let vivant = true;
    let ouvert_: MediaStream | undefined;

    void navigator.mediaDevices
      ?.getUserMedia({ video: { facingMode: "environment" } })
      .then((obtenu) => {
        if (!vivant) return obtenu.getTracks().forEach((piste) => piste.stop());
        ouvert_ = obtenu;
        setFlux(obtenu);
        if (video.current) video.current.srcObject = obtenu;
      })
      .catch(() => vivant && setRefus(true));

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
    if (blob) setPrise({ blob, url: URL.createObjectURL(blob) });
  };

  const nom = `photo-${new Date().toISOString().slice(0, 19).replaceAll(":", "-")}.jpg`;

  return (
    <Sheet ouvert={ouvert} onFermer={onFermer} sortie="form">
      <div style={{ display: "grid", gap: "var(--spacing-3)", padding: "var(--spacing-3)" }}>
        {refus ? (
          <Text type="body">
            L'accès à la caméra a été refusé. Autorisez-le dans les réglages de votre
            navigateur, puis rouvrez cet écran.
          </Text>
        ) : prise ? (
          <>
            <img src={prise.url} alt="Photo prise" style={{ maxWidth: "100%", borderRadius: "var(--radius-container)" }} />

            {/* REQ-UI-15 — les deux libellés sont **distincts et explicites** : ce qui
                reste sur l'appareil est l'original, ce qui part est compressé. Confondre
                les deux ferait croire que le correspondant reçoit la pleine qualité. */}
            <Button
              label="Enregistrer sur votre appareil (original)"
              onClick={() => void onEnregistrer(prise.blob, nom)}
            />
            <Button
              label="Envoyer (version compressée)"
              onClick={() => {
                onEnvoyer(new File([prise.blob], nom, { type: "image/jpeg" }));
                onFermer();
              }}
            />
            <Button label="Reprendre" variant="ghost" onClick={() => setPrise(undefined)} />
          </>
        ) : (
          <>
            {/* Flux de la caméra de l'appareil : aucune piste de sous-titres à fournir,
                et l'aperçu est décrit par son `aria-label`. */}
            <video ref={video} autoPlay playsInline aria-label="Aperçu de la caméra" />
            <Button label="Prendre la photo" isDisabled={!flux} onClick={() => void capturer()} />
          </>
        )}
      </div>
    </Sheet>
  );
}
