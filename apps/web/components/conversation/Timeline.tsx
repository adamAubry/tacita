"use client";

import type { ReactionTally } from "@tacita/messaging";
import type { ReceiptStatus } from "@tacita/receipts";
import { Fragment, useState } from "react";

import { Skeleton } from "../foundation/primitives";
import { DateSeparator } from "./DateSeparator";
import { MessageObject } from "./MessageObject";
import { nouveauJour, shouldShowHeader, type MessageAffiche } from "./message";

export interface TimelineProps {
  messages: MessageAffiche[];
  chargement?: boolean;
  /** REQ-UIX-13 — le starter est le premier élément de la timeline, pas un en-tête. */
  starter?: React.ReactNode;
  reactions?: (message: MessageAffiche) => ReactionTally[];
  /** REQ-UI-13 — l'état du dernier message envoyé, et de lui seul. */
  recu?: { statut: ReceiptStatus; indecidable: boolean };
  onRepondre: (message: MessageAffiche) => void;
  onHold: (message: MessageAffiche) => void;
  onReagir: (message: MessageAffiche, emoji: string) => void;
  onRenvoyer: (message: MessageAffiche) => void;
  onAbandonner: (message: MessageAffiche) => void;
}

/**
 * REQ-UI-06 — la timeline : l'ordre est **celui du paquet**, jamais retrié ici.
 *
 * Deux fonctions pures gouvernent le rendu, et elles sont testables sans DOM :
 * `nouveauJour` place les séparateurs, `shouldShowHeader` décide du regroupement Discord.
 * Le composant ne fait que les appliquer.
 *
 * ponytail: rendu intégral, sans fenêtrage — même arbitrage qu'en M-C, Astryx 0.2.0
 * n'expose aucune liste virtualisée. Le plafond est réel ici (une conversation ancienne
 * fait des milliers de messages) : à reprendre dès qu'un historique long rame, en
 * fenêtrant sur la timeline du paquet plutôt qu'en triant quoi que ce soit.
 */
export function Timeline({
  messages,
  chargement = false,
  starter,
  reactions,
  recu,
  onRepondre,
  onHold,
  onReagir,
  onRenvoyer,
  onAbandonner,
}: TimelineProps) {
  // REQ-UI-09 — l'état vit ici : le geste porte sur un message, la révélation porte sur
  // la colonne entière. C'est ce que fait Instagram, et c'est ce qu'on attend.
  const [heuresVisibles, setHeuresVisibles] = useState(false);

  if (chargement) {
    return (
      <div
        aria-label="Chargement des messages"
        aria-busy="true"
        style={{ display: "grid", gap: "var(--spacing-3)", padding: "var(--spacing-3)" }}
      >
        {[0, 1, 2, 3].map((rang) => (
          <Skeleton key={rang} height={40} />
        ))}
      </div>
    );
  }

  const dernierEnvoye = [...messages].reverse().find((message) => message.moi && message.eventId);

  return (
    <div role="log" aria-label="Messages" aria-live="polite" style={{ paddingBottom: "var(--spacing-3)" }}>
      {starter}

      {messages.map((message, rang) => {
        const precedent = messages[rang - 1];
        return (
          <Fragment key={message.cle}>
            {nouveauJour(precedent, message) && <DateSeparator horodatage={message.horodatage} />}
            <MessageObject
              message={message}
              entete={shouldShowHeader(precedent, message)}
              heureVisible={heuresVisibles}
              reactions={reactions?.(message)}
              recu={message.cle === dernierEnvoye?.cle ? recu : undefined}
              onRepondre={() => onRepondre(message)}
              onHold={() => onHold(message)}
              onRevelerHeures={() => setHeuresVisibles((visible) => !visible)}
              onReagir={(emoji) => onReagir(message, emoji)}
              onRenvoyer={message.envoi === "failed" ? () => onRenvoyer(message) : undefined}
              onAbandonner={message.envoi === "failed" ? () => onAbandonner(message) : undefined}
            />
          </Fragment>
        );
      })}
    </div>
  );
}
