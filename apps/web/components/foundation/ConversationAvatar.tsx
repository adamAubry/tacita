import type { CSSProperties } from "react";

import { Avatar } from "./primitives";

export interface ConversationAvatarProps {
  /**
   * Le nom **de la conversation**, pas d'un membre : en DM le SDK y met déjà le nom de
   * l'autre utilisateur, en groupe celui du groupe. C'est toute la règle d'avatar.
   */
  nom: string;
  /** DM ou groupe. Change ce qui est représenté, pas la forme. */
  direct: boolean;
  taille?: 24 | 36 | 40 | 48;
}

/**
 * **Le seul endroit de l'app qui rend un avatar** (DESIGN.md).
 *
 * La règle qu'il encapsule est celle tranchée par le design owner (ESCALATIONS,
 * décisions design) : en DM, l'avatar de conversation est celui de l'autre utilisateur ;
 * en groupe, celui du groupe — distinct des avatars des membres. Une seule ligne de code
 * en dépend, ici, pour qu'aucun écran n'en invente une variante.
 *
 * Forme : carré arrondi à 25 %, jamais un cercle. Astryx lit `--radius-full` pour ses
 * avatars ; on le redéfinit dans cette portée, ce qui reforme la primitive sans la
 * recoder — DESIGN.md interdit de recoder ce qu'Astryx livre.
 *
 * ponytail: initiales seulement, pas d'image. Les avatars sont des médias
 * authentifiés (spec 01) qu'une balise `img` ne sait pas aller chercher seule ; brancher
 * `src` sans ce chemin afficherait un carré cassé — une promesse non tenue (interdit
 * n°13). Ajouter la prop `src` quand M-E livre la récupération de média authentifié.
 */
export function ConversationAvatar({ nom, direct, taille = 40 }: ConversationAvatarProps) {
  return (
    <Avatar
      name={nom}
      size={taille}
      tooltip={false}
      alt={direct ? nom : `Groupe ${nom}`}
      style={{ "--radius-full": "var(--tacita-radius-avatar)" } as CSSProperties}
    />
  );
}
