"use client";

import type { RechercheRecente } from "../../lib/recherches-recentes";
import { ConversationAvatar } from "../foundation/ConversationAvatar";
import { Placeholder } from "../foundation/Placeholder";
import { Button, Text } from "../foundation/primitives";

/**
 * Largeur d'une carte, et nombre au-delà duquel le scroller déborde. Le vrai débordement
 * dépend de la largeur de l'écran — ce seuil en est une approximation.
 *
 * ponytail: seuil par comptage, pas par mesure. Mesurer demanderait un
 * `ResizeObserver` et une lecture de layout que jsdom ne rend pas, pour décider… d'un
 * rembourrage. À remplacer par une mesure le jour où la carte change de largeur selon le
 * contenu, ce qu'elle ne fait pas.
 */
const LARGEUR_CARTE = 88;
export const VISIBLES_SANS_DEBORDEMENT = 4;

export interface RecentSearchesProps {
  recentes: RechercheRecente[];
  onOuvrir: (recente: RechercheRecente) => void;
  onPurger: () => void;
}

/**
 * REQ-UIX-19 — Recent searches (composant 17) : titre, scroller horizontal, et
 * « content peek » — le dernier élément reste partiellement visible quand ça déborde,
 * parce qu'un bord net laisse croire que la liste s'arrête là.
 */
export function RecentSearches({ recentes, onOuvrir, onPurger }: RecentSearchesProps) {
  if (recentes.length === 0) {
    return (
      <Placeholder
        titre="Aucune recherche récente"
        explication="Les conversations que vous ouvrez depuis une recherche apparaîtront ici."
      />
    );
  }

  const deborde = recentes.length > VISIBLES_SANS_DEBORDEMENT;

  return (
    <section aria-label="Recherches récentes" style={{ display: "grid", gap: "var(--spacing-2)" }}>
      <div style={{ display: "flex", alignItems: "center", padding: "0 var(--spacing-3)" }}>
        <Text type="body" weight="bold">
          Récemment consultées
        </Text>
        <div style={{ flex: 1 }} />
        <Button label="Effacer" variant="ghost" onClick={onPurger} />
      </div>

      <div
        // Le « peek » est le rembourrage de fin : il laisse dépasser la carte suivante au
        // lieu de la couper net au bord. Exposé en attribut pour être vérifiable.
        data-debordement={deborde ? "true" : "false"}
        style={{
          display: "flex",
          gap: "var(--spacing-2)",
          overflowX: "auto",
          paddingInline: "var(--spacing-3)",
          paddingInlineEnd: deborde ? `${LARGEUR_CARTE / 2}px` : "var(--spacing-3)",
          scrollSnapType: "x proximity",
        }}
      >
        {recentes.map((recente) => (
          <button
            key={recente.roomId}
            type="button"
            onClick={() => onOuvrir(recente)}
            style={{
              display: "grid",
              justifyItems: "center",
              gap: "var(--spacing-1)",
              flex: `0 0 ${LARGEUR_CARTE}px`,
              minHeight: 44,
              padding: 0,
              border: "none",
              background: "none",
              color: "var(--color-text-primary)",
              scrollSnapAlign: "start",
            }}
          >
            <ConversationAvatar nom={recente.nom} direct taille={48} />
            <Text type="supporting" color="secondary" maxLines={1}>
              {recente.nom}
            </Text>
          </button>
        ))}
      </div>
    </section>
  );
}
