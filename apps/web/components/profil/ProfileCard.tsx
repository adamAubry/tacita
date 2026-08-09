"use client";

import { useRouter } from "next/navigation";
import type { ReactNode } from "react";

import { ConversationAvatar } from "../foundation/ConversationAvatar";
import { Badge, Button, Icon, Text } from "../foundation/primitives";

export interface ProfileCardProps {
  nom: string;
  /** L'identifiant Matrix, affiché sous le nom sur son propre profil (REQ-UIX-24). */
  userId?: string;
  /** Actions de droite : réglages pour soi, options relatives à la personne sinon. */
  actions?: ReactNode;
  /**
   * REQ-UIX-23 — le statut ami/non-ami, **avant** les options. Absent sur son propre
   * profil : la question ne s'y pose pas.
   */
  statut?: "ami" | "non-ami" | "bloque";
}

const LIBELLE_STATUT = {
  ami: "Ami",
  "non-ami": "Pas encore ami",
  bloque: "Bloqué",
} as const;

/**
 * REQ-UIX-23 — composant 21, la « profile card ».
 *
 * L'avatar est en grand et **fond vers le fond de page** : un dégradé vers la
 * transparence plutôt qu'un bord net. DESIGN.md tient au carré arrondi ; le dégradé ne
 * change pas la forme, il en dissout la base pour que le titre s'y pose sans ligne de
 * séparation.
 *
 * `mask-image` et non un calque posé par-dessus : un calque devrait connaître la couleur
 * du fond, donc la coder en dur, et casserait au changement de thème.
 */
export function ProfileCard({ nom, userId, actions, statut }: ProfileCardProps) {
  const router = useRouter();
  // `black` et non `#000` : dans un masque, seule l'**alpha** compte — la couleur n'est
  // jamais rendue. Un littéral hexadécimal ici ferait croire à une couleur en dur, ce
  // que DESIGN.md interdit, et le garde-fou de `theme.test.ts` le refuse désormais.
  const fondu = "linear-gradient(to bottom, black 55%, transparent 100%)";

  return (
    <header style={{ position: "relative", display: "grid", justifyItems: "center" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "var(--spacing-2)",
          width: "100%",
          padding: "var(--spacing-3)",
        }}
      >
        <Button
          label="Retour"
          variant="ghost"
          isIconOnly
          icon={<Icon icon="chevronLeft" />}
          onClick={() => router.back()}
        />

        <div style={{ display: "flex", alignItems: "center", gap: "var(--spacing-2)" }}>
          {statut && (
            <Badge
              label={LIBELLE_STATUT[statut]}
              // DESIGN.md : encre sur `accent-soft`, et le bloqué en `error` — c'est le
              // seul des trois statuts qui doive se remarquer sans être lu.
              style={{
                background:
                  statut === "bloque" ? "var(--color-error-muted)" : "var(--color-accent-muted)",
                color: "var(--color-text-primary)",
              }}
            />
          )}
          {actions}
        </div>
      </div>

      <div
        style={{
          padding: "var(--spacing-2) 0 var(--spacing-4)",
          maskImage: fondu,
          WebkitMaskImage: fondu,
        }}
      >
        <ConversationAvatar nom={nom} direct taille={48} />
      </div>

      <div style={{ display: "grid", justifyItems: "center", gap: "var(--spacing-1)" }}>
        {/* REQ-UIX-24 — nom et identifiant **juxtaposés avec des styles distincts** :
            l'un est choisi et change, l'autre est l'adresse et ne change jamais. Les
            rendre semblables laisserait croire qu'on peut éditer les deux. */}
        <Text type="display-3" weight="bold">
          {nom}
        </Text>
        {userId && (
          <Text type="supporting" color="secondary">
            {userId}
          </Text>
        )}
      </div>
    </header>
  );
}
