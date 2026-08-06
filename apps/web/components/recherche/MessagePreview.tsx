"use client";

import { dateApercu } from "../../lib/dates";
import { ClickableCard, Text } from "../foundation/primitives";
import { HighlightedText } from "./HighlightedText";

export interface MessagePreviewProps {
  /** Nom de la conversation, pas de l'auteur : c'est ce que le wireframe met en tête. */
  conversation: string;
  extrait: string;
  horodatage: number;
  /** Le terme cherché, pour le surlignage. Vide dans l'onglet Mentions. */
  terme: string;
  onOuvrir: () => void;
  maintenant?: number;
}

/**
 * REQ-UIX-20 — Message preview (composant 19) : nom de conversation en haut à gauche,
 * date en haut à droite, extrait tronqué en bas.
 *
 * Ce n'est pas une carte de conversation : pas d'avatar, pas de badge, pas d'épingle. Un
 * résultat de recherche désigne **un message**, et lui donner l'apparence d'une
 * conversation ferait croire qu'on l'ouvre à la fin de l'historique.
 */
export function MessagePreview({
  conversation,
  extrait,
  horodatage,
  terme,
  onOuvrir,
  maintenant,
}: MessagePreviewProps) {
  return (
    <ClickableCard label={`${conversation} — ${extrait}`} padding={3} onClick={onOuvrir}>
      <div style={{ display: "grid", gap: "var(--spacing-1)" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: "var(--spacing-2)" }}>
          <Text type="body" weight="bold" maxLines={1}>
            {conversation}
          </Text>
          <div style={{ flex: 1 }} />
          <Text type="supporting" color="secondary" hasTabularNumbers>
            {dateApercu(horodatage, maintenant)}
          </Text>
        </div>

        <Text type="supporting" color="secondary" maxLines={2}>
          <HighlightedText texte={extrait} terme={terme} />
        </Text>
      </div>
    </ClickableCard>
  );
}
