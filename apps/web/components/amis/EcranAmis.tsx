"use client";

import { searchUsers, subscribeConversations } from "@tacita/messaging";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { contactsDeLaSession, type Demande } from "../../lib/contacts";
import { creerLienAmi, partagerLien, urlDuLien } from "../../lib/invitations";
import { Placeholder } from "../foundation/Placeholder";
import { useSession } from "../onboarding/SessionProvider";
import { AjouterAmis } from "./AjouterAmis";
import { Demandes } from "./Demandes";

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

  const onPartagerLien = useCallback(async () => {
    if (!session) return "annule" as const;
    const jeton = session.client.getAccessToken();
    if (!jeton) return "annule" as const;

    const lien = await creerLienAmi(jeton);
    return partagerLien(urlDuLien(lien.token, globalThis.location.origin));
  }, [session]);

  if (!session || !contacts) {
    return <Placeholder titre="Amis" explication="Chargement…" />;
  }

  return variation === "ajouter" ? (
    <AjouterAmis
      chercher={chercher}
      onPartagerLien={onPartagerLien}
      onOuvrirProfil={(userId) => router.push(`/u/${encodeURIComponent(userId)}`)}
    />
  ) : (
    <Demandes
      demandes={demandes}
      onAccepter={contacts.accepter}
      onRefuser={contacts.refuser}
      onOuvrir={(roomId) => router.push(`/c/${encodeURIComponent(roomId)}`)}
    />
  );
}
