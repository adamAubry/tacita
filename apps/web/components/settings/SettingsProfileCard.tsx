"use client";

import { ConversationAvatar } from "../foundation/ConversationAvatar";
import { ClickableCard, Icon, Text } from "../foundation/primitives";

export interface SettingsProfileCardProps {
  nom: string;
  /** L'identifiant Matrix, en mono (DESIGN.md) : c'est ce qu'on dicte à quelqu'un. */
  identifiant: string;
  onOuvrir: () => void;
}

/**
 * REQ-UIX-31 — composant 24 du wireframe : la carte de profil des réglages.
 *
 * « Carte **non fondue** », par opposition à la Profile card de M-G dont l'avatar se
 * dégrade vers le fond : ici la carte a ses bords, parce qu'elle est un point d'entrée
 * dans une liste d'options, pas un en-tête d'écran. Le chevron dit qu'elle mène ailleurs.
 */
export function SettingsProfileCard({ nom, identifiant, onOuvrir }: SettingsProfileCardProps) {
  return (
    <ClickableCard label={`Profil de ${nom}`} onClick={onOuvrir}>
      <div style={{ display: "flex", alignItems: "center", gap: "var(--spacing-3)" }}>
        <ConversationAvatar nom={nom} direct taille={48} />

        <div style={{ display: "grid", gap: "var(--spacing-1)", minWidth: 0, flex: 1 }}>
          <Text type="body" weight="bold" maxLines={1}>
            {nom}
          </Text>
          {/* DESIGN.md : les identifiants Matrix sont en mono — c'est ce qu'on dicte. */}
          <Text type="code" color="secondary" maxLines={1}>
            {identifiant}
          </Text>
        </div>

        <Icon icon="chevronRight" />
      </div>
    </ClickableCard>
  );
}
