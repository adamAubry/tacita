"use client";

import {
  conversations as listerConversations,
  subscribeConversations,
  type Conversation,
} from "@tacita/messaging";
import { createSearch, type Search } from "@tacita/search";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { contactsDeLaSession } from "../../lib/contacts";
import { useSession } from "../onboarding/SessionProvider";
import { Placeholder } from "../foundation/Placeholder";
import { Recherche } from "./Recherche";

/**
 * Le câblage des deux onglets de recherche : session, worker d'index, conversations.
 * `Recherche` lui-même ne connaît ni `Session` ni `Worker` — c'est ce qui le rend
 * testable avec le paquet search mocké, comme l'objectif mesurable de M-F le demande.
 */
export function EcranRecherche({ variation }: { variation?: "search" | "mentions" }) {
  const { etat } = useSession();
  const router = useRouter();
  const session = etat.phase === "prete" ? etat.session : null;

  const [recherche, setRecherche] = useState<Search | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);

  useEffect(() => {
    if (!session) return;
    /**
     * Le worker est construit ici et **fermé au démontage** : chacun porte une copie de
     * l'index en mémoire, et en laisser un par visite d'onglet les accumulerait.
     *
     * `new URL(..., import.meta.url)` est la forme que les bundlers reconnaissent pour
     * un worker ; le paquet ne connaît pas le nôtre et exige qu'on le lui fournisse.
     */
    const worker = new Worker(new URL("@tacita/search/worker", import.meta.url), {
      type: "module",
    });
    const instance = createSearch(session, worker);
    setRecherche(instance);
    return () => {
      instance.dispose();
      setRecherche(null);
    };
  }, [session]);

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
      indexedDB={globalThis.indexedDB}
      onOuvrirConversation={(roomId) => router.push(`/c/${encodeURIComponent(roomId)}`)}
      // REQ-UIX-20 — « positionnée sur le message ». L'ancre passe par l'URL : la
      // conversation sait s'y rendre seule, et le lien reste partageable et rejouable.
      onOuvrirMessage={({ roomId, eventId }) =>
        router.push(`/c/${encodeURIComponent(roomId)}?m=${encodeURIComponent(eventId)}`)
      }
    />
  );
}
