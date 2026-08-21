"use client";

import {
  conversations as listerConversations,
  subscribeConversations,
  type Conversation,
} from "@tacita/messaging";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { contactsDeLaSession } from "../../lib/contacts";
import { CHAMP_CONVERSATION } from "../../lib/recherche";
import { useSession } from "../onboarding/SessionProvider";
import { useRecherche } from "./RechercheProvider";
import { Placeholder } from "../foundation/Placeholder";
import { Recherche } from "./Recherche";
import { routeConversation } from "../../lib/routes";

/**
 * Le câblage des deux onglets de recherche : session, worker d'index, conversations.
 * `Recherche` lui-même ne connaît ni `Session` ni `Worker` — c'est ce qui le rend
 * testable avec le paquet search mocké, comme l'objectif mesurable de M-F le demande.
 */
export function EcranRecherche({ variation }: { variation?: "search" | "mentions" }) {
  const { etat } = useSession();
  const router = useRouter();
  const session = etat.phase === "prete" ? etat.session : null;

  /**
   * REQ-UIX-33 — « Rechercher » depuis les informations d'une conversation (M-H) arrive
   * par `?salon=`. Le token est **modifiable**, contrairement à celui des mentions :
   * c'est un point de départ, et l'élargir à tout l'historique est un geste légitime.
   *
   * C'est un contrat d'URL, pas un import : M-H pousse l'adresse, cet écran la lit, et
   * ni l'un ni l'autre ne connaît le code de son vis-à-vis.
   */
  const salonInitial = useSearchParams()?.get("salon") ?? undefined;

  /**
   * L'index vient de la session (`RechercheProvider`), il n'est plus créé ici.
   *
   * Le créer à l'ouverture de l'onglet le branchait sur les déchiffrements **du seul
   * temps où l'onglet était affiché** : il n'avait par construction rien à trouver.
   * L'écran ne fait plus qu'interroger un index alimenté depuis l'ouverture de session.
   */
  const recherche = useRecherche();
  const [conversations, setConversations] = useState<Conversation[]>([]);

  useEffect(() => {
    if (!session) return;
    const rafraichir = () => setConversations(listerConversations(session));
    rafraichir();
    return subscribeConversations(session, rafraichir);
  }, [session]);

  const contacts = useMemo(
    () => (session ? contactsDeLaSession(session).lister() : []),
    // La liste des DM suit les conversations : la recalculer avec elles.
    [session, conversations],
  );

  if (!session || !recherche) {
    return (
      <Placeholder
        titre="Rechercher"
        explication="La recherche porte sur l'historique téléchargé sur cet appareil."
      />
    );
  }

  return (
    <Recherche
      recherche={recherche}
      conversations={conversations}
      contacts={contacts}
      moi={session.client.getUserId() ?? ""}
      variation={variation}
      tokensInitiaux={
        salonInitial
          ? [{ field: CHAMP_CONVERSATION, value: { type: "enum", value: salonInitial } }]
          : undefined
      }
      indexedDB={globalThis.indexedDB}
      onOuvrirConversation={(roomId) => router.push(routeConversation(roomId))}
      // REQ-UIX-20 — « positionnée sur le message ». L'ancre passe par l'URL : la
      // conversation sait s'y rendre seule, et le lien reste partageable et rejouable.
      onOuvrirMessage={({ roomId, eventId }) =>
        router.push(routeConversation(roomId, eventId))
      }
    />
  );
}
