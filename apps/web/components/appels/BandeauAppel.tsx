"use client";

import { activeCall } from "@tacita/calls";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { routeAppel } from "../../lib/routes";
import { Banner, Button } from "../foundation/primitives";
import { useSession } from "../onboarding/SessionProvider";

/**
 * REQ-UI-19 / REQ-CAL-03 — « Appel en cours — rejoindre ».
 *
 * Persistant tant que l'appel l'est, absent sinon : comme le bandeau de connexion et la
 * bannière de demandes (M-A, M-C), il n'a pas de version vide. Un bandeau permanent
 * cesse d'être lu le jour où il a quelque chose à dire.
 *
 * L'état vient entièrement du paquet 10 — le shard ne lit aucun événement d'état.
 */
export function BandeauAppel({ roomId }: { roomId: string }) {
  const { etat } = useSession();
  const router = useRouter();
  const session = etat.phase === "prete" ? etat.session : null;

  const [participants, setParticipants] = useState(0);

  useEffect(() => {
    if (!session) return;
    const appel = activeCall(session, roomId);
    const lire = () =>
      setParticipants(appel.current().status === "active" ? appel.current().participants.length : 0);

    lire();
    const desabonner = appel.subscribe(lire);
    return () => {
      desabonner();
      appel.stop();
    };
  }, [session, roomId]);

  if (participants === 0) return null;

  return (
    <Banner
      status="info"
      title="Appel en cours"
      description={
        participants === 1 ? "Une personne y participe." : `${participants} personnes y participent.`
      }
      endContent={
        <Button
          label="Rejoindre"
          variant="secondary"
          onClick={() => router.push(routeAppel(roomId))}
        />
      }
    />
  );
}
