"use client";

import { IconeChevron } from "./icons";
import { ClickableCard, Text } from "./primitives";

interface OptionCardProps {
  titre: string;
  /**
   * La ligne d'état sous le titre. **Elle dit où on en est sans avoir à ouvrir** — le
   * niveau de notification, le thème courant, ce que la modal contient. Une carte qui
   * n'aurait qu'un titre serait un lien déguisé en carte.
   */
  detail: string;
  onClick: () => void;
}

/**
 * Composant 15 du wireframe : la carte d'option — titre, ligne d'état, chevron.
 *
 * **Un seul fichier pour les deux endroits qui en posent** : les options d'une
 * conversation et les réglages de l'application. DESIGN.md :
 * « un composant = un fichier nommé, réutilisé partout, variations par props » — les deux
 * listes avaient le même balisage à quinze lignes près, et deux copies dérivent.
 *
 * `ClickableCard` d'Astryx **est** la carte cliquable, avec sa sémantique clavier ;
 * on ne recode pas une primitive existante.
 */
export function OptionCard({ titre, detail, onClick }: OptionCardProps) {
  return (
    <ClickableCard label={titre} onClick={onClick}>
      <div style={{ display: "flex", alignItems: "center", gap: "var(--spacing-3)" }}>
        <div style={{ display: "grid", gap: "var(--spacing-1)", flex: 1, minWidth: 0 }}>
          <Text type="body" weight="bold" maxLines={1}>
            {titre}
          </Text>
          <Text type="supporting" color="secondary" maxLines={1}>
            {detail}
          </Text>
        </div>
        <span aria-hidden style={{ display: "flex", color: "var(--color-icon-secondary)" }}>{IconeChevron}</span>
      </div>
    </ClickableCard>
  );
}
