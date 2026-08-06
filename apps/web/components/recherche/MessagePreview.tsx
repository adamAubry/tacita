"use client";

import { ClickableCard, Text } from "../foundation/primitives";
import { dateApercu } from "../../lib/dates";
import { HighlightedText } from "./HighlightedText";

export interface ResultatMessage {
  eventId: string;
  roomId: string;
  /** Le nom de la conversation, résolu par l'appelant — l'index n'en connaît aucun. */
  conversation: string;
  extrait: string;
  horodatage: number;
}

export interface MessagePreviewProps {
  resultat: ResultatMessage;
  /** Ce qui est surligné dans l'extrait (composant 18). */
  terme: string;
  onOuvrir: (resultat: ResultatMessage) => void;
  /** Injecté en test, pour que « aujourd'hui » ne dépende pas de l'heure du CI. */
  maintenant?: number;
}

/**
 * REQ-UIX-20 — composant 19, « message preview » : nom de conversation en haut à
 * gauche, date en haut à droite, extrait tronqué en bas.
 *
 * L'extrait est du **contenu déchiffré** : il vit dans le rendu et nulle part ailleurs
 * — aucun log, aucune télémétrie, aucun attribut de données qui le recopierait
 * (interdit n°8). L'étiquette accessible ne porte que le nom de la conversation.
 */
export function MessagePreview({ resultat, terme, onOuvrir, maintenant }: MessagePreviewProps) {
  return (
    <ClickableCard
      label={`Message dans ${resultat.conversation}`}
      padding={3}
      onClick={() => onOuvrir(resultat)}
    >
      <div style={{ display: "grid", gap: "var(--spacing-1)" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: "var(--spacing-2)" }}>
          {/* `minWidth: 0` : sans lui, un nom long pousse la date hors de la carte au
              lieu d'être tronqué (même motif que ConversationPreview). */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <Text type="supporting" weight="bold" maxLines={1}>
              {resultat.conversation}
            </Text>
          </div>
          {/* Chiffres tabulaires : la colonne de dates ne doit pas danser d'une ligne
              de résultat à l'autre (DESIGN.md). */}
          <Text type="supporting" color="secondary" hasTabularNumbers>
            {dateApercu(resultat.horodatage, maintenant)}
          </Text>
        </div>

        {/* `maxLines` est la troncature d'Astryx — la recoder serait recoder la
            primitive (DESIGN.md). Deux lignes : un extrait d'une seule ligne coupe
            souvent avant l'occurrence surlignée, qui est la raison d'être du résultat. */}
        <Text type="body" color="secondary" maxLines={2}>
          <HighlightedText texte={resultat.extrait} terme={terme} />
        </Text>
      </div>
    </ClickableCard>
  );
}
