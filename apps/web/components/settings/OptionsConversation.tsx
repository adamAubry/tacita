"use client";

import { ClickableCard, Icon, Text } from "../foundation/primitives";

/**
 * REQ-UIX-34 — les options d'une conversation.
 *
 * **« Messages éphémères » n'existe pas** : E-03 l'a abandonné, pas reporté (D-09). Il
 * est donc absent du DOM, et surtout pas grisé — une option grisée est une promesse non
 * tenue affichée (interdit n°13). Ce commentaire est la seule trace qu'il en reste, et
 * c'est voulu : sans lui, quelqu'un le rajoutera en croyant à un oubli.
 */
export type OptionConversation = "theme" | "notifications" | "groupe" | "lien" | "membres";

export interface OptionsConversationProps {
  direct: boolean;
  /** REQ-UIX-36 — l'état courant se lit sous l'option, sans avoir à l'ouvrir. */
  niveauLibelle: string;
  onOuvrir: (option: OptionConversation) => void;
}

interface Carte {
  cle: OptionConversation;
  titre: string;
  detail: string;
}

/**
 * REQ-UIX-34 — composant 15 du wireframe : les Options, en `ClickableCard`.
 *
 * Deux jeux, une seule liste : les variations sont des props, jamais des copies (règle
 * du plan frontend). Ce qui change entre 1:1 et groupe est l'appartenance à la liste,
 * pas le rendu d'une carte.
 */
export function OptionsConversation({
  direct,
  niveauLibelle,
  onOuvrir,
}: OptionsConversationProps) {
  const cartes: Carte[] = direct
    ? [
        { cle: "theme", titre: "Thème de la conversation", detail: "Fond d'écran, sur cet appareil" },
        { cle: "notifications", titre: "Notifications", detail: niveauLibelle },
        {
          cle: "groupe",
          titre: "Créer un groupe avec cette personne",
          detail: "Elle sera déjà sélectionnée",
        },
      ]
    : [
        { cle: "theme", titre: "Thème de la conversation", detail: "Fond d'écran, sur cet appareil" },
        { cle: "lien", titre: "Lien d'invitation", detail: "Créer, voir l'expiration, révoquer" },
        { cle: "membres", titre: "Membres", detail: "Voir qui est là" },
        { cle: "notifications", titre: "Notifications", detail: niveauLibelle },
      ];

  return (
    <section
      aria-label="Options"
      style={{ display: "grid", gap: "var(--spacing-2)", padding: "var(--spacing-3)" }}
    >
      {cartes.map(({ cle, titre, detail }) => (
        <ClickableCard key={cle} label={titre} onClick={() => onOuvrir(cle)}>
          <div style={{ display: "flex", alignItems: "center", gap: "var(--spacing-3)" }}>
            <div style={{ display: "grid", gap: "var(--spacing-1)", flex: 1, minWidth: 0 }}>
              <Text type="body" weight="bold" maxLines={1}>
                {titre}
              </Text>
              <Text type="supporting" color="secondary" maxLines={1}>
                {detail}
              </Text>
            </div>
            <Icon icon="chevronRight" />
          </div>
        </ClickableCard>
      ))}
    </section>
  );
}
