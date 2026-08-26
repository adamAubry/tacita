"use client";

import { ClickableCard, Text } from "../foundation/primitives";
import { useGlissement } from "../../lib/gestes";

interface RequestsBannerProps {
  /** Nombre de demandes actives. Zéro ⇒ rien n'est rendu. */
  demandes: number;
  onOuvrir: () => void;
  onIgnorer: () => void;
}

/**
 * bannière « Nouvelles demandes » (composant 5).
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
  const geste = useGlissement({ onDroite: onIgnorer });

  if (demandes <= 0) return null;

  return (
    <ClickableCard label={`Nouvelles demandes (${demandes})`} padding={3} onClick={onOuvrir} {...geste}>
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
