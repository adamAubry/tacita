"use client";

import type { Conversation } from "@tacita/messaging";

import { ConversationAvatar } from "../foundation/ConversationAvatar";
import { Placeholder } from "../foundation/Placeholder";
import { ClickableCard, Skeleton, Text } from "../foundation/primitives";
import { HighlightedText } from "./HighlightedText";
import { MessagePreview, type ResultatMessage } from "./MessagePreview";

interface SearchResultsProps {
  /** Conversations dont le **nom** correspond — jamais leur contenu. */
  conversations: Conversation[];
  messages: ResultatMessage[];
  terme: string;
  chargement?: boolean;
  /** rappelé dans l'état vide : « rien ici » n'est pas « rien nulle part ». */
  perimetre: string;
  /** « Mentions » au lieu de « Messages » sur l'onglet dédié. */
  titreMessages?: string;
  onOuvrirConversation: (roomId: string) => void;
  onOuvrirMessage: (resultat: ResultatMessage) => void;
  maintenant?: number;
}

/** Le nom d'une conversation, avec les occurrences marquées. Aucun badge, aucune épingle. */
function ConversationTrouvee({
  conversation,
  terme,
  onOuvrir,
}: {
  conversation: Conversation;
  terme: string;
  onOuvrir: (roomId: string) => void;
}) {
  return (
    <ClickableCard
      label={conversation.name}
      padding={3}
      onClick={() => onOuvrir(conversation.roomId)}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "var(--spacing-3)" }}>
        <ConversationAvatar nom={conversation.name} direct={conversation.direct} taille={36} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <Text type="body" weight="bold" maxLines={1}>
            <HighlightedText texte={conversation.name} terme={terme} />
          </Text>
        </div>
      </div>
    </ClickableCard>
  );
}

function Section({ titre, children }: { titre: string; children: React.ReactNode }) {
  const id = `section-${titre.toLowerCase()}`;
  return (
    <section aria-labelledby={id} style={{ display: "grid", gap: "var(--spacing-2)" }}>
      <Text id={id} type="supporting" weight="bold" color="secondary">
        {titre}
      </Text>
      <div role="list" style={{ display: "grid", gap: "var(--spacing-1)" }}>
        {children}
      </div>
    </section>
  );
}

/**
 * l'état résultats : deux sections titrées, « Conversations » puis
 * « Messages ». L'ordre n'est pas neutre — on cherche plus souvent un fil qu'une phrase,
 * et la section des conversations est courte, donc elle ne repousse pas l'autre.
 *
 * Les conversations sont filtrées **par nom** (contrainte de la spec), les messages
 * viennent de l'index local. Aucune des deux n'est retriée ici : l'ordre des messages
 * est celui du score rendu par le paquet, jamais `origin_server_ts` (interdit n°6).
 */
export function SearchResults({
  conversations,
  messages,
  terme,
  chargement = false,
  perimetre,
  titreMessages = "Messages",
  onOuvrirConversation,
  onOuvrirMessage,
  maintenant,
}: SearchResultsProps) {
  if (chargement) {
    return (
      // skeletons pendant la requête, à la géométrie des cartes finales :
      // zéro décalage à l'arrivée des résultats (DESIGN.md).
      <div
        aria-label="Recherche en cours"
        aria-busy="true"
        style={{ display: "grid", gap: "var(--spacing-2)", padding: "var(--spacing-3)" }}
      >
        {[0, 1, 2].map((rang) => (
          <Skeleton key={rang} height={56} />
        ))}
      </div>
    );
  }

  if (conversations.length === 0 && messages.length === 0) {
    return <Placeholder titre="Aucun résultat" explication={perimetre} />;
  }

  return (
    <div style={{ display: "grid", gap: "var(--spacing-4)", padding: "var(--spacing-3)" }}>
      {conversations.length > 0 && (
        <Section titre="Conversations">
          {conversations.map((conversation) => (
            <div role="listitem" key={conversation.roomId}>
              <ConversationTrouvee
                conversation={conversation}
                terme={terme}
                onOuvrir={onOuvrirConversation}
              />
            </div>
          ))}
        </Section>
      )}

      {messages.length > 0 && (
        <Section titre={titreMessages}>
          {messages.map((resultat) => (
            <div role="listitem" key={resultat.eventId}>
              <MessagePreview
                resultat={resultat}
                terme={terme}
                onOuvrir={onOuvrirMessage}
                maintenant={maintenant}
              />
            </div>
          ))}
        </Section>
      )}
    </div>
  );
}
