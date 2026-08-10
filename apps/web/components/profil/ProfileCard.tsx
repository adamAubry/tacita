"use client";

import { useRouter } from "next/navigation";
import type { ReactNode } from "react";

import { ConversationAvatar } from "../foundation/ConversationAvatar";
import { useImageMxc } from "../foundation/useImageMxc";
import { Badge, Button, Icon, Text } from "../foundation/primitives";

export interface ProfileCardProps {
  nom: string;
  /** L'identifiant Matrix, affiché sous le nom sur son propre profil (REQ-UIX-24). */
  userId?: string;
  /** REQ-UI-20 — le `mxc://` de la photo. Absent → initiales. */
  avatarUrl?: string;
  /** REQ-UIX-41 — le `mxc://` de la bannière. Absent → l'aplat d'accent doux. */
  bannerUrl?: string;
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

/** Hauteur de la bannière, et de combien l'avatar y remonte. Grille de 4 pt. */
const HAUTEUR_BANNIERE = 176;
const REMONTEE_AVATAR = 48;

/**
 * REQ-UIX-23 / REQ-UIX-41 — composant 21, la « profile card ».
 *
 * Trois couches, dans cet ordre de profondeur :
 *
 * 1. **la bannière**, fond de la carte, qui se dissout par le bas dans le fond de page ;
 * 2. **le bandeau d'actions**, qui *flotte* par-dessus elle — il ne pousse rien, il ne
 *    prend pas de place, et on voit la bannière au travers ;
 * 3. **l'avatar**, remonté sur la bannière et fondu lui aussi.
 *
 * Le fondu est un `mask-image` et non un calque posé par-dessus : un calque devrait
 * connaître la couleur du fond, donc la coder en dur, et casserait au changement de
 * thème. `black` et non `#000` : dans un masque, seule l'**alpha** compte — la couleur
 * n'est jamais rendue. Un littéral hexadécimal ici ferait croire à une couleur en dur, ce
 * que DESIGN.md interdit, et le garde-fou de `theme.test.ts` le refuse désormais.
 */
export function ProfileCard({
  nom,
  userId,
  avatarUrl,
  bannerUrl,
  actions,
  statut,
}: ProfileCardProps) {
  const router = useRouter();
  const banniere = useImageMxc(bannerUrl);
  const fonduAvatar = "linear-gradient(to bottom, black 55%, transparent 100%)";
  // La bannière s'éteint plus tard que l'avatar : elle est large, et un fondu qui
  // commencerait au même endroit mangerait toute la couleur.
  const fonduBanniere = "linear-gradient(to bottom, black 60%, transparent 100%)";

  return (
    <header style={{ position: "relative", display: "grid", justifyItems: "center" }}>
      {/* La bannière est décorative : le nom et l'identifiant, juste dessous, disent qui
          on regarde. Une description alternative n'ajouterait rien et se lirait à chaque
          visite. */}
      <div
        aria-hidden
        style={{
          justifySelf: "stretch",
          height: HAUTEUR_BANNIERE,
          background: banniere
            ? `url(${JSON.stringify(banniere)}) center / cover no-repeat`
            : "var(--color-accent-muted)",
          maskImage: fonduBanniere,
          WebkitMaskImage: fonduBanniere,
        }}
      />

      {/* Le bandeau flotte : `position: absolute`, donc hors du flux — il se pose sur la
          bannière au lieu de la repousser. Le verre est la seule exception de DESIGN.md
          au « pas de glass » : sans lui, ces boutons passent sur une photo arbitraire où
          rien ne garantit le contraste. */}
      <div
        style={{
          position: "absolute",
          insetInline: 0,
          top: 0,
          zIndex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "var(--spacing-2)",
          padding: "var(--spacing-3)",
          paddingTop: "calc(var(--spacing-3) + env(safe-area-inset-top, 0px))",
          background: "var(--tacita-verre)",
          backdropFilter: "blur(12px)",
          WebkitBackdropFilter: "blur(12px)",
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
          // Marge négative : l'avatar suit la bannière dans le flux, et **remonte**
          // dessus. Superposer par `position: absolute` obligerait à réserver la place à
          // la main sous lui, et le nom se décalerait au premier changement de taille.
          marginTop: -REMONTEE_AVATAR,
          padding: "0 0 var(--spacing-4)",
          maskImage: fonduAvatar,
          WebkitMaskImage: fonduAvatar,
        }}
      >
        <ConversationAvatar nom={nom} mxc={avatarUrl} direct taille={96} />
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
