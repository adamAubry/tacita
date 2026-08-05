"use client";

import { useRef, useState } from "react";

import { Button, Text } from "../foundation/primitives";

/**
 * Ce que le pipeline sait produire **aujourd'hui** dans le shard. La vidéo en est
 * absente : son transcodage n'existe pas côté navigateur sans dépendance WASM, que la
 * liste close de REQ-UI-02 refuse (ESCALATIONS § E-10). Le sélecteur ne la propose donc
 * pas — plutôt que de l'accepter et d'échouer à l'envoi.
 */
export const TYPES_ACCEPTES = "image/*,application/pdf,application/zip,text/*";

export interface MediaPickerProps {
  onFichiers: (fichiers: File[]) => void;
  /** Envoi en cours : le pipeline n'expose pas de progression, seulement un état. */
  enCours?: boolean;
  onAnnuler?: () => void;
}

/**
 * REQ-UI-14 — la sélection de pièces jointes.
 *
 * ponytail: état d'envoi binaire, pas de barre de progression. `uploadAttachment`
 * (spec 08) ne rapporte rien pendant la compression ni pendant le téléversement — une
 * barre serait une animation inventée, pas une mesure. Passer à une vraie barre le jour
 * où le paquet expose un rappel de progression.
 */
export function MediaPicker({ onFichiers, enCours = false, onAnnuler }: MediaPickerProps) {
  const champ = useRef<HTMLInputElement>(null);
  const [refus, setRefus] = useState<string>();

  return (
    <div style={{ display: "flex", alignItems: "center", gap: "var(--spacing-2)" }}>
      <input
        ref={champ}
        type="file"
        multiple
        accept={TYPES_ACCEPTES}
        aria-label="Joindre des fichiers"
        hidden
        onChange={(evenement) => {
          const choisis = [...(evenement.target.files ?? [])];
          const videos = choisis.filter((fichier) => fichier.type.startsWith("video/"));
          // Le champ accepte ce que l'OS veut bien filtrer ; un glisser-déposer ou un
          // sélecteur permissif peuvent toujours livrer une vidéo. On le dit ici plutôt
          // que d'échouer plus tard, sans explication.
          setRefus(
            videos.length > 0 ? "L'envoi de vidéos n'est pas encore disponible." : undefined,
          );
          const acceptes = choisis.filter((fichier) => !fichier.type.startsWith("video/"));
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
