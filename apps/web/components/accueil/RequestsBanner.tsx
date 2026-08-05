"use client";

import { useRef, type PointerEvent } from "react";

import { ClickableCard, Text } from "../foundation/primitives";
import { SEUIL_GLISSEMENT } from "./ConversationPreview";

export interface RequestsBannerProps {
  /** Nombre de demandes actives. Zéro ⇒ rien n'est rendu. */
  demandes: number;
  onOuvrir: () => void;
  onIgnorer: () => void;
}

/**
 * REQ-UIX-10 — bannière « Nouvelles demandes » (composant 5).
 *
 * **Elle n'existe pas quand il n'y a rien.** Pas de version vide, pas de « 0 demande » :
 * une bannière permanente cesse d'être lue le jour où elle a quelque chose à dire — même
 * raison que le bandeau de connexion (M-A).
 *
 * Le glissement vers la droite l'écarte ; elle revient à la prochaine demande. Écarter
 * n'est pas refuser : les demandes restent dans l'écran dédié (M-G). C'est pour ça que
 * la carte reste cliquable et que rien n'est supprimé côté serveur.
 */
export function RequestsBanner({ demandes, onOuvrir, onIgnorer }: RequestsBannerProps) {
  const depart = useRef<number | null>(null);

  if (demandes <= 0) return null;

  const terminer = (evenement: PointerEvent) => {
    const origine = depart.current;
    depart.current = null;
    if (origine !== null && evenement.clientX - origine >= SEUIL_GLISSEMENT) onIgnorer();
  };

  return (
    <ClickableCard
      label={`Nouvelles demandes (${demandes})`}
      padding={3}
      onClick={onOuvrir}
      onPointerDown={(evenement) => {
        depart.current = evenement.clientX;
      }}
      onPointerUp={terminer}
      onPointerCancel={() => {
        depart.current = null;
      }}
      style={{ touchAction: "pan-y" }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "var(--spacing-3)" }}>
        <Text type="body" weight="bold">
          Nouvelles demandes
        </Text>
        <Text type="supporting" color="secondary" hasTabularNumbers>
          {demandes}
        </Text>
      </div>
    </ClickableCard>
  );
}
