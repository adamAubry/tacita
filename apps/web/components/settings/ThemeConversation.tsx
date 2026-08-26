"use client";

import { useEffect, useState } from "react";

import { effacerFondEcran, ecrireFondEcran, lireFondEcran } from "../../lib/preferences";
import { Button, Text } from "../foundation/primitives";

interface ThemeConversationProps {
  roomId: string;
  indexedDB?: IDBFactory;
  /** Prévient la conversation qu'elle doit relire son fond. */
  onApplique?: () => void;
}

/**
 * le fond d'écran d'une conversation.
 *
 * **Aperçu avant application** : l'image choisie est montrée sous le voile de lisibilité
 * exact de la timeline (`--tacita-scrim`, DESIGN.md), avec du texte par-dessus. Sans lui,
 * on découvre après coup qu'un fond clair rend le blanc illisible — et c'est précisément
 * ce que le voile existe pour empêcher.
 *
 * L'image ne quitte **jamais** l'appareil : ni compression par le pipeline, ni upload,
 * ni account data. Le libellé le dit, parce qu'un réglage qu'on croit synchronisé et qui
 * ne l'est pas passe pour une panne au prochain téléphone (E-02, même raisonnement).
 *
 * ponytail: `<input type="file">` natif plutôt que le MediaPicker de M-E. Celui-ci
 * refuse la vidéo, annonce des envois et parle de pièces jointes — trois comportements
 * qui n'ont rien à faire ici. Le rung natif suffit.
 */
export function ThemeConversation({
  roomId,
  indexedDB = globalThis.indexedDB,
  onApplique,
}: ThemeConversationProps) {
  /** L'image posée sur cet appareil, et celle qu'on est en train de regarder. */
  const [actuel, setActuel] = useState<Blob | undefined>();
  const [candidat, setCandidat] = useState<Blob | undefined>();
  const [apercu, setApercu] = useState<string | undefined>();

  useEffect(() => {
    void lireFondEcran(indexedDB, roomId).then(setActuel).catch(() => {});
  }, [indexedDB, roomId]);

  // L'URL d'objet est **révoquée** au changement comme au démontage : une image de
  // plusieurs mégaoctets retenue par une URL oubliée ne se libère jamais.
  const image = candidat ?? actuel;
  useEffect(() => {
    if (!image) {
      setApercu(undefined);
      return;
    }
    const url = URL.createObjectURL(image);
    setApercu(url);
    return () => URL.revokeObjectURL(url);
  }, [image]);

  return (
    <div style={{ display: "grid", gap: "var(--spacing-3)", padding: "var(--spacing-3)" }}>
      <div
        aria-label="Aperçu du fond d'écran"
        style={{
          position: "relative",
          minHeight: 140,
          borderRadius: "var(--radius-container)",
          border: "1px solid var(--color-border)",
          overflow: "hidden",
          background: apercu ? `center / cover url(${apercu})` : "var(--color-background-body)",
        }}
      >
        {/* Le voile de lisibilité de M-D, à l'identique : l'aperçu ment s'il est plus
            clément que la timeline. */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: apercu ? "var(--tacita-scrim)" : undefined,
            padding: "var(--spacing-3)",
            display: "grid",
            alignContent: "center",
            gap: "var(--spacing-1)",
          }}
        >
          <Text type="body" weight="bold">
            Aperçu
          </Text>
          <Text type="body">Voici à quoi ressemble un message sur ce fond.</Text>
        </div>
      </div>

      <label style={{ display: "grid", gap: "var(--spacing-1)" }}>
        <Text type="label">Choisir une image</Text>
        <input
          type="file"
          accept="image/*"
          onChange={(evenement) => setCandidat(evenement.target.files?.[0] ?? undefined)}
        />
      </label>

      <div style={{ display: "flex", gap: "var(--spacing-2)" }}>
        <Button
          label="Appliquer"
          isDisabled={candidat === undefined}
          onClick={() => {
            if (!candidat) return;
            void ecrireFondEcran(indexedDB, roomId, candidat)
              .then(() => {
                setActuel(candidat);
                setCandidat(undefined);
                onApplique?.();
              })
              .catch(() => {});
          }}
        />
        <Button
          label="Réinitialiser"
          variant="secondary"
          isDisabled={actuel === undefined && candidat === undefined}
          onClick={() => {
            setCandidat(undefined);
            void effacerFondEcran(indexedDB, roomId)
              .then(() => {
                setActuel(undefined);
                onApplique?.();
              })
              .catch(() => {});
          }}
        />
      </div>

      <Text type="supporting" color="secondary">
        Le fond d'écran est enregistré sur cet appareil, et sur lui seul : il ne part pas
        au serveur et ne suivra pas sur un autre téléphone.
      </Text>
    </div>
  );
}
