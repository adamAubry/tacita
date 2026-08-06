"use client";

import type { Conversation } from "@tacita/messaging";
import { useState } from "react";

import { ButtonsList } from "../foundation/ButtonsList";
import { ConversationAvatar } from "../foundation/ConversationAvatar";
import { Sheet } from "../foundation/Sheet";
import { Badge, ClickableCard, Text } from "../foundation/primitives";
import { dateApercu } from "../../lib/dates";
import { useGlissement } from "../../lib/gestes";

export interface ConversationPreviewProps {
  conversation: Conversation;
  onOuvrir: (roomId: string) => void;
  onEpingler: (roomId: string, epingle: boolean) => void;
  /** Injecté en test, pour que « aujourd'hui » ne dépende pas de l'heure du CI. */
  maintenant?: number;
  /**
   * Variation « résultat de recherche » (M-F, REQ-UIX-20) : ni badge, ni geste d'épingle.
   * Une prop plutôt qu'une copie du composant — la règle du plan frontend.
   */
  simple?: boolean;
}

/**
 * REQ-UIX-08 — le badge. La mention **prime** sur le nombre : savoir qu'on vous a
 * nommé compte plus que savoir combien de messages ont passé. Au-delà de neuf, le
 * compte exact n'apporte plus rien — « 9+ » suffit et la largeur cesse de bouger.
 *
 * DESIGN.md : encre sur `accent-soft`, jamais de pastille rouge (PRODUCT.md — pas de
 * culpabilisation).
 */
function BadgeNonLus({ unread, mention }: { unread: number; mention: boolean }) {
  if (!mention && unread === 0) return null;

  return (
    <Badge
      className="tabulaire"
      aria-label={mention ? "Mention non lue" : `${unread} non lus`}
      label={mention ? "@" : unread > 9 ? "9+" : String(unread)}
      // Le `Badge` d'Astryx est la primitive ; seules ses deux couleurs sont reposées,
      // aucune variante ne donnant « encre sur accent-soft ».
      style={{
        background: "var(--color-accent-muted)",
        color: "var(--color-text-primary)",
      }}
    />
  );
}

/**
 * REQ-UI-05 — la carte « conversation preview » (composant 3) : avatar, nom, aperçu
 * tronqué, date localisée, badge.
 *
 * REQ-UIX-09 — un glissement vers la droite l'épingle. Le geste n'est pas le seul
 * chemin : l'appui long ouvre un hold menu qui porte la même action (DESIGN.md — chaque
 * geste a un équivalent visible). Sans lui, épingler serait invisible au clavier et à
 * qui ne connaît pas le geste.
 */
export function ConversationPreview({
  conversation,
  onOuvrir,
  onEpingler,
  maintenant,
  simple = false,
}: ConversationPreviewProps) {
  const [menuOuvert, setMenuOuvert] = useState(false);
  const geste = useGlissement(
    simple
      ? {}
      : {
          onDroite: () => onEpingler(conversation.roomId, !conversation.pinned),
          onAppuiLong: () => setMenuOuvert(true),
        },
  );

  return (
    <>
      <ClickableCard
        label={conversation.name}
        padding={3}
        onClick={() => onOuvrir(conversation.roomId)}
        {...geste}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "var(--spacing-3)" }}>
          <ConversationAvatar nom={conversation.name} direct={conversation.direct} />

          {/* `minWidth: 0` : sans lui, un aperçu long élargit la ligne au lieu d'être
              tronqué — la troncature d'un enfant de flex ne s'applique pas autrement. */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <Text type="body" weight="bold">
              {conversation.name}
            </Text>
            {/* `maxLines` est la troncature d'Astryx : une ligne, ellipse comprise.
                La recoder en CSS serait recoder la primitive (DESIGN.md). */}
            <Text type="supporting" color="secondary" maxLines={1}>
              {conversation.preview}
            </Text>
          </div>

          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "flex-end",
              gap: "var(--spacing-1)",
            }}
          >
            {/* Chiffres tabulaires : une heure qui change ne doit pas déplacer la
                colonne (DESIGN.md). */}
            <Text type="supporting" color="secondary" hasTabularNumbers>
              {conversation.timestamp === 0 ? "" : dateApercu(conversation.timestamp, maintenant)}
            </Text>
            {!simple && (
              <BadgeNonLus unread={conversation.unread} mention={conversation.mention} />
            )}
          </div>
        </div>
      </ClickableCard>

      <Sheet ouvert={menuOuvert} onFermer={() => setMenuOuvert(false)}>
        <ButtonsList
          boutons={[
            {
              cle: "epingler",
              libelle: conversation.pinned ? "Désépingler" : "Épingler",
              onClick: () => {
                setMenuOuvert(false);
                onEpingler(conversation.roomId, !conversation.pinned);
              },
            },
          ]}
        />
      </Sheet>
    </>
  );
}
