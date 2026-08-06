"use client";

import type { ReactionTally } from "@tacita/messaging";
import type { ReceiptStatus } from "@tacita/receipts";
import { Fragment, useEffect, useRef, useState } from "react";

import { Skeleton } from "../foundation/primitives";
import { DateSeparator } from "./DateSeparator";
import { MessageObject } from "./MessageObject";
import type { Telecharger } from "../media/media";
import { nouveauJour, shouldShowHeader, type MessageAffiche } from "./message";

export interface TimelineProps {
  messages: MessageAffiche[];
  chargement?: boolean;
  /** REQ-UIX-13 — le starter est le premier élément de la timeline, pas un en-tête. */
  starter?: React.ReactNode;
  reactions?: (message: MessageAffiche) => ReactionTally[];
  /**
   * REQ-UI-13 — l'état du dernier message envoyé, et la clé de ce message.
   *
   * La clé vient du câblage, qui la calcule déjà pour interroger les accusés : la
   * recalculer ici donnait deux définitions de « dernier message envoyé » dans deux
   * fichiers, exactement le genre qui dérive.
   */
  recu?: { cle: string; statut: ReceiptStatus; indecidable: boolean };
  onRepondre: (message: MessageAffiche) => void;
  onHold: (message: MessageAffiche) => void;
  onReagir: (message: MessageAffiche, emoji: string) => void;
  onRenvoyer: (message: MessageAffiche) => void;
  onAbandonner: (message: MessageAffiche) => void;
  /** REQ-UI-14 — déchiffrement des pièces jointes (M-E), et ouverture du viewer. */
  telecharger?: Telecharger;
  onOuvrirMedia?: (message: MessageAffiche) => void;
  /**
   * REQ-UIX-20 (M-F) — l'identifiant du message sur lequel se positionner, tel qu'un
   * résultat de recherche l'a passé dans l'URL.
   *
   * Un identifiant absent de la timeline chargée **ne déclenche rien** : la contrainte
   * de M-F interdit d'aller le chercher au serveur, et une recherche silencieuse qui
   * échoue vaut mieux qu'un aller-retour réseau que l'utilisateur n'a pas demandé.
   */
  ancre?: string;
  /**
   * REQ-UIX-35 — l'URL d'objet du fond d'écran choisi pour ce salon (M-H), quand il y
   * en a un. La timeline pose alors le voile de lisibilité (`scrim`), qui est ce qui
   * autorise à laisser l'utilisateur choisir n'importe quelle image.
   */
  fondEcran?: string;
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
  telecharger,
  onOuvrirMedia,
  ancre,
  fondEcran,
}: TimelineProps) {
  // REQ-UI-09 — l'état vit ici : le geste porte sur un message, la révélation porte sur
  // la colonne entière. C'est ce que fait Instagram, et c'est ce qu'on attend.
  const [heuresVisibles, setHeuresVisibles] = useState(false);
  const cible = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // `messages.length` en dépendance : l'ancre arrive souvent avant la timeline, et
    // sans cela on tenterait de défiler vers un élément pas encore rendu.
    if (!ancre) return;
    // `scrollIntoView` manque à jsdom ; l'absence de défilement n'est pas une panne.
    cible.current?.scrollIntoView?.({ block: "center" });
  }, [ancre, messages.length]);

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

  return (
    <div
      role="log"
      aria-label="Messages"
      aria-live="polite"
      style={{
        paddingBottom: "var(--spacing-3)",
        // Le voile est **au-dessus** de l'image et sous le texte : c'est lui qui rend les
        // messages lisibles quel que soit le fond choisi (DESIGN.md, token `scrim`). Sans
        // lui, un fond clair effacerait le texte, et l'utilisateur n'aurait aucun moyen
        // de le savoir avant de l'avoir posé.
        backgroundImage: fondEcran
          ? `linear-gradient(var(--tacita-scrim), var(--tacita-scrim)), url(${fondEcran})`
          : undefined,
        backgroundSize: fondEcran ? "cover" : undefined,
        backgroundAttachment: fondEcran ? "local" : undefined,
      }}
    >
      {starter}

      {messages.map((message, rang) => {
        const precedent = messages[rang - 1];
        const vise = ancre !== undefined && message.eventId === ancre;
        return (
          <Fragment key={message.cle}>
            {nouveauJour(precedent, message) && <DateSeparator horodatage={message.horodatage} />}
            {/* Le conteneur n'existe que pour porter la cible du défilement : envelopper
                tous les messages ajouterait un niveau de DOM par message pour rien. */}
            {vise && <div ref={cible} data-ancre={message.eventId} aria-hidden="true" />}
            <MessageObject
              message={message}
              entete={shouldShowHeader(precedent, message)}
              heureVisible={heuresVisibles}
              reactions={reactions?.(message)}
              recu={message.cle === recu?.cle ? recu : undefined}
              onRepondre={() => onRepondre(message)}
              onHold={() => onHold(message)}
              onRevelerHeures={() => setHeuresVisibles((visible) => !visible)}
              onReagir={(emoji) => onReagir(message, emoji)}
              onRenvoyer={message.envoi === "failed" ? () => onRenvoyer(message) : undefined}
              onAbandonner={message.envoi === "failed" ? () => onAbandonner(message) : undefined}
              telecharger={telecharger}
              onOuvrirMedia={onOuvrirMedia ? () => onOuvrirMedia(message) : undefined}
            />
          </Fragment>
        );
      })}
    </div>
  );
}
