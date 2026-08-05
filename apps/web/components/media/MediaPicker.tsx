"use client";

import { useRef, useState } from "react";

import { Button, Text } from "../foundation/primitives";

const SANS_VIDEO = "image/*,application/pdf,application/zip,text/*";

/**
 * Ce que le pipeline sait produire. La vidéo n'y entre que si **ce navigateur-ci** sait
 * l'encoder : `WebCodecs` est large mais pas universel, et le mesurer coûte un appel
 * (`videoTranscodable`). Là où il ne sait pas, la vidéo n'est pas grisée — elle n'est pas
 * proposée du tout.
 */
export const typesAcceptes = (videoAutorisee: boolean) =>
  videoAutorisee ? `${SANS_VIDEO},video/*` : SANS_VIDEO;

export interface MediaPickerProps {
  onFichiers: (fichiers: File[]) => void;
  /** Envoi en cours : le pipeline n'expose pas de progression, seulement un état. */
  enCours?: boolean;
  onAnnuler?: () => void;
  /** Mesuré au montage par le câblage, jamais supposé. */
  videoAutorisee?: boolean;
}

/**
 * REQ-UI-14 — la sélection de pièces jointes.
 *
 * ponytail: état d'envoi binaire, pas de barre de progression. `uploadAttachment`
 * (spec 08) ne rapporte rien pendant la compression ni pendant le téléversement — une
 * barre serait une animation inventée, pas une mesure. Passer à une vraie barre le jour
 * où le paquet expose un rappel de progression.
 */
export function MediaPicker({
  onFichiers,
  enCours = false,
  onAnnuler,
  videoAutorisee = false,
}: MediaPickerProps) {
  const champ = useRef<HTMLInputElement>(null);
  const [refus, setRefus] = useState<string>();

  return (
    <div style={{ display: "flex", alignItems: "center", gap: "var(--spacing-2)" }}>
      <input
        ref={champ}
        type="file"
        multiple
        accept={typesAcceptes(videoAutorisee)}
        aria-label="Joindre des fichiers"
        hidden
        onChange={(evenement) => {
          const choisis = [...(evenement.target.files ?? [])];
          const estVideo = (fichier: File) => fichier.type.startsWith("video/");
          // Le champ n'accepte que ce que l'OS veut bien filtrer ; un glisser-déposer ou
          // un sélecteur permissif peuvent toujours livrer une vidéo là où ce navigateur
          // ne sait pas l'encoder. On le dit ici plutôt que d'échouer plus tard.
          const refuses = videoAutorisee ? [] : choisis.filter(estVideo);
          setRefus(
            refuses.length > 0
              ? "Ce navigateur ne sait pas encoder de vidéo : envoi impossible."
              : undefined,
          );

          const acceptes = choisis.filter((fichier) => !refuses.includes(fichier));
          if (acceptes.length > 0) onFichiers(acceptes);
          evenement.target.value = "";
        }}
      />

      {enCours ? (
        <>
          <Text type="supporting" color="secondary">
            Envoi en cours…
          </Text>
          {onAnnuler && <Button label="Annuler l'envoi" variant="ghost" onClick={onAnnuler} />}
        </>
      ) : (
        <Button label="Joindre" variant="ghost" onClick={() => champ.current?.click()} />
      )}

      {refus && (
        <Text type="supporting" color="secondary">
          {refus}
        </Text>
      )}
    </div>
  );
}
