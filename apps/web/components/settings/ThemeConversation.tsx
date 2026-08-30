"use client";

import { useEffect, useRef, useState } from "react";

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
 * ne l'est pas passe pour une panne au prochain téléphone (même raisonnement).
 *
 * ponytail: on ne passe pas par le MediaPicker de M-E. Celui-ci refuse la vidéo, annonce
 * des envois et parle de pièces jointes — trois comportements qui n'ont rien à faire ici.
 * L'`<input type="file">` reste donc le mécanisme, mais **caché** : rendu nu, il posait le
 * bouton « Parcourir… » du navigateur et sa typographie système au milieu d'une feuille
 * entièrement composée en primitives (revue de conception E-13). Le motif —
 * input caché, `Button` qui le déclenche — est celui de `FormulaireIdentite`.
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
  const champ = useRef<HTMLInputElement>(null);

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

      {/*
        **L'input est caché, un `Button` le déclenche** (revue de conception E-13,
        30/08/2026). Il était nu : le bouton « Parcourir… » du navigateur et sa typographie
        système, au milieu d'une feuille entièrement composée en primitives Astryx. Le
        motif juste existait déjà deux fichiers plus loin, dans `FormulaireIdentite` — il
        est repris tel quel plutôt que réinventé.
      */}
      <input
        ref={champ}
        type="file"
        accept="image/*"
        aria-label="Choisir une image"
        hidden
        onChange={(evenement) => {
          const fichier = evenement.target.files?.[0];
          evenement.target.value = "";
          setCandidat(fichier ?? undefined);
        }}
      />
      <Button
        label={candidat ? "Image choisie — en changer" : "Choisir une image"}
        variant="secondary"
        onClick={() => champ.current?.click()}
      />

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
