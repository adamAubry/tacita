"use client";

import { useState } from "react";

import type { Demande } from "../../lib/contacts";
import { LayoutHeader } from "../foundation/LayoutHeader";
import { Placeholder } from "../foundation/Placeholder";
import { DemandesList } from "./FriendsList";

interface DemandesProps {
  demandes: Demande[];
  /** Rend le salon à ouvrir : accepter, c'est entrer dans la conversation. */
  onAccepter: (roomId: string) => Promise<string>;
  onRefuser: (roomId: string) => Promise<void>;
  onOuvrir: (roomId: string) => void;
}

/**
 * REQ-UIX-29 — Friend request.
 *
 * **Les deux réponses sont optimistes** : la ligne disparaît au clic, avant la
 * confirmation du serveur. Une demande sur laquelle on vient de statuer n'a plus rien à
 * faire à l'écran, et attendre l'aller-retour laisserait croire que le clic n'a pas pris.
 *
 * Un échec la fait réapparaître — ce qui est la bonne façon de le signaler ici : la
 * demande est de nouveau en attente, ce qui est exactement l'état réel.
 */
export function Demandes({ demandes, onAccepter, onRefuser, onOuvrir }: DemandesProps) {
  const [statuees, setStatuees] = useState<string[]>([]);

  const restantes = demandes.filter((demande) => !statuees.includes(demande.roomId));

  const repondre = (roomId: string, action: () => Promise<unknown>) => {
    setStatuees((precedentes) => [...precedentes, roomId]);
    void action().catch(() => {
      setStatuees((precedentes) => precedentes.filter((id) => id !== roomId));
    });
  };

  return (
    <>
      <LayoutHeader titre="Demandes" />

      {restantes.length === 0 ? (
        <Placeholder
          titre="Aucune demande"
          explication="Les invitations reçues apparaîtront ici."
        />
      ) : (
        <DemandesList
          demandes={restantes}
          onAccepter={({ roomId }) =>
            repondre(roomId, async () => onOuvrir(await onAccepter(roomId)))
          }
          onRefuser={({ roomId }) => repondre(roomId, () => onRefuser(roomId))}
        />
      )}
    </>
  );
}
