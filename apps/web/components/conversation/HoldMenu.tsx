"use client";

import { REACTIONS_METADATA } from "@tacita/messaging";
import { useState } from "react";

import { ButtonsList, type Bouton } from "../foundation/ButtonsList";
import { Sheet } from "../foundation/Sheet";
import { Button, Text } from "../foundation/primitives";

/** Les six d'accès direct. Le reste passe par le picker — DESIGN.md : pas d'emoji décoratif. */
export const REACTIONS_RAPIDES = ["👍", "❤️", "😂", "😮", "😢", "🙏"] as const;

/** Un jeu élargi, sans dépendance : un picker complet est un paquet, pas un besoin. */
const REACTIONS_ETENDUES = [
  ...REACTIONS_RAPIDES,
  "🔥", "🎉", "👏", "🤔", "😅", "😍", "🙌", "💯", "✅", "👀", "🤝", "🫡",
] as const;

interface HoldMenuProps {
  ouvert: boolean;
  onFermer: () => void;
  /** Conditionnés aux droits exposés par le package. */
  modifiable: boolean;
  supprimable: boolean;
  epingle: boolean;
  onReagir: (emoji: string) => void;
  onRepondre: () => void;
  onCopier: () => void;
  onModifier: () => void;
  onSupprimer: () => void;
  onEpingler: () => void;
}

/**
 * Hold menu (composant 12) : les réactions en haut, les actions
 * ensuite.
 *
 * **Les items absents ne sont pas grisés, ils n'existent pas.** DESIGN.md interdit
 * l'option grisée sans explication, et « modifier » sur le message de quelqu'un d'autre
 * n'a pas d'explication à donner — elle n'a simplement pas lieu d'être.
 *
 * La mention sur le non-chiffrement des réactions est discrète mais présente,
 * et elle vient de `REACTIONS_METADATA` : la recopier ici la ferait mentir le jour où le
 * paquet changerait d'avis.
 */
export function HoldMenu({
  ouvert,
  onFermer,
  modifiable,
  supprimable,
  epingle,
  onReagir,
  onRepondre,
  onCopier,
  onModifier,
  onSupprimer,
  onEpingler,
}: HoldMenuProps) {
  const [pickerOuvert, setPickerOuvert] = useState(false);
  const emojis = pickerOuvert ? REACTIONS_ETENDUES : REACTIONS_RAPIDES;

  const fermer = () => {
    setPickerOuvert(false);
    onFermer();
  };

  const agir = (action: () => void) => () => {
    action();
    fermer();
  };

  const actions: Bouton[] = [
    { cle: "repondre", libelle: "Répondre", onClick: agir(onRepondre) },
    { cle: "copier", libelle: "Copier", onClick: agir(onCopier) },
    ...(modifiable ? [{ cle: "modifier", libelle: "Modifier", onClick: agir(onModifier) }] : []),
    {
      cle: "epingler",
      libelle: epingle ? "Retirer des épinglés" : "Épingler",
      onClick: agir(onEpingler),
    },
    ...(supprimable
      ? [
          {
            cle: "supprimer",
            libelle: "Supprimer",
            destructif: true,
            onClick: agir(onSupprimer),
          },
        ]
      : []),
  ];

  return (
    <Sheet ouvert={ouvert} onFermer={fermer} nom="Actions sur le message">
      <div style={{ display: "grid", gap: "var(--spacing-2)", padding: "var(--spacing-3)" }}>
        <div
          role="group"
          aria-label="Réactions"
          style={{ display: "flex", flexWrap: "wrap", gap: "var(--spacing-1)" }}
        >
          {emojis.map((emoji) => (
            <Button
              key={emoji}
              label={emoji}
              variant="ghost"
              onClick={agir(() => onReagir(emoji))}
            />
          ))}
          {!pickerOuvert && (
            <Button label="Plus de réactions" variant="ghost" onClick={() => setPickerOuvert(true)} />
          )}
        </div>

        {/* Une phrase sobre, non modale (DESIGN.md) : la limite se dit là où elle se
            produit, au moment de choisir la réaction. Le détail vient du paquet — le
            recopier ici le ferait mentir le jour où le paquet changerait d'avis. */}
        <span title={REACTIONS_METADATA.reason}>
          <Text type="supporting" color="secondary">
            Les réactions sont visibles du serveur, contrairement aux messages.
          </Text>
        </span>
      </div>

      <ButtonsList boutons={actions} />
    </Sheet>
  );
}
