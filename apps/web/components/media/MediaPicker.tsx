"use client";

import { useRef, useState } from "react";

import { IconePlus } from "../foundation/icons";
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

  /**
   * Les deux messages flottent **au-dessus** de la rangée du composer, jamais dedans.
   *
   * Dedans, « Envoi en cours… » et son bouton d'annulation prenaient la moitié d'un écran
   * de téléphone et écrasaient le champ de saisie le temps d'un téléversement — la barre
   * changeait de forme pendant qu'on écrit. Hors flux, la rangée garde la largeur du seul
   * bouton, et le message paraît là où l'indicateur de frappe paraît déjà.
   */
  const messageFlottant = {
    position: "absolute",
    bottom: "100%",
    insetInlineStart: 0,
    display: "flex",
    alignItems: "center",
    gap: "var(--spacing-2)",
    whiteSpace: "nowrap",
    paddingBottom: "var(--spacing-1)",
  } as const;

  return (
    <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
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

      {/* Une icône seule, comme le « + » de WhatsApp et de Discord : dans une barre où
          l'on écrit dix fois plus souvent qu'on ne joint, un libellé coûterait la largeur
          qui revient au texte. Le bouton **reste en place** pendant l'envoi — il tourne au
          lieu de disparaître : une rangée dont un élément s'efface se réorganise sous le
          doigt, et c'est le champ voisin qui bouge. */}
      <Button
        label="Joindre"
        variant="ghost"
        isIconOnly
        icon={IconePlus}
        isLoading={enCours}
        onClick={() => champ.current?.click()}
      />

      {enCours && (
        <div style={messageFlottant}>
          <Text type="supporting" color="secondary">
            Envoi en cours…
          </Text>
          {onAnnuler && <Button label="Annuler l'envoi" variant="ghost" onClick={onAnnuler} />}
        </div>
      )}

      {refus && (
        <div style={messageFlottant}>
          <Text type="supporting" color="secondary">
            {refus}
          </Text>
        </div>
      )}
    </div>
  );
}
