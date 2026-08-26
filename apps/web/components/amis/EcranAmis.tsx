"use client";

import { searchUsers, subscribeConversations } from "@tacita/messaging";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { contactsDeLaSession, type Demande } from "../../lib/contacts";
import { liensDeLaSession, partagerLien, urlDInvitation } from "../../lib/liens-invitation";
import { Placeholder } from "../foundation/Placeholder";
import { useSession } from "../onboarding/SessionProvider";
import { AjouterAmis } from "./AjouterAmis";
import { Demandes } from "./Demandes";
import { routeConversation } from "../../lib/routes";

/** Le câblage des layouts Add-friends et Friend request. */
export function EcranAmis({ variation }: { variation: "ajouter" | "demandes" }) {
  const { etat } = useSession();
  const router = useRouter();
  const session = etat.phase === "prete" ? etat.session : null;

  const [demandes, setDemandes] = useState<Demande[]>([]);
  const contacts = useMemo(() => (session ? contactsDeLaSession(session) : null), [session]);

  useEffect(() => {
    if (!session || !contacts) return;
    const rafraichir = () => setDemandes(contacts.demandes());
    rafraichir();
    return subscribeConversations(session, rafraichir);
  }, [session, contacts]);

  const chercher = useCallback(
    (terme: string) => (session ? searchUsers(session, terme) : Promise.resolve([])),
    [session],
  );

  // Un seul client du service de liens dans le dépôt : celui de M-H, qui sait aussi lister et
  // révoquer. M-G n'a besoin que d'émettre, mais pas d'une seconde implémentation.
  const onPartagerLien = useCallback(async () => {
    if (!session) return "annule" as const;
    const { token } = await liensDeLaSession(session).emettreAmi();
    return partagerLien(urlDInvitation(globalThis.location.origin, token));
  }, [session]);

  if (!session || !contacts) {
    return <Placeholder titre="Amis" explication="Chargement…" />;
  }

  return variation === "ajouter" ? (
    <AjouterAmis
      chercher={chercher}
      onPartagerLien={onPartagerLien}
      onOuvrirProfil={(userId) => router.push(`/profil/${encodeURIComponent(userId)}`)}
    />
  ) : (
    <Demandes
      demandes={demandes}
      onAccepter={contacts.accepter}
      onRefuser={contacts.refuser}
      onOuvrir={(roomId) => router.push(routeConversation(roomId))}
    />
  );
}
