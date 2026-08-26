"use client";

import { activeCall } from "@tacita/calls";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { identifiantCourt } from "../../lib/identifiants";
import { routeAppel } from "../../lib/routes";
import { Banner, Button } from "../foundation/primitives";
import { useSession } from "../onboarding/SessionProvider";

/**
 * Qui est dans l'appel, en une ligne. Un compte seul — « 2 personnes y participent » —
 * ne dit pas s'il vaut la peine de rejoindre : dans un groupe, la réponse dépend
 * entièrement de qui est là. Au-delà de trois, on retombe sur le compte, parce qu'une
 * énumération de six noms ne se lit plus.
 */
export function ligneParticipants(participants: readonly string[], nom: (id: string) => string): string {
  const noms = participants.map(nom);
  if (noms.length === 0) return "";
  if (noms.length === 1) return `${noms[0]} y participe.`;
  if (noms.length === 2) return `${noms[0]} et ${noms[1]} y participent.`;
  if (noms.length === 3) return `${noms[0]}, ${noms[1]} et ${noms[2]} y participent.`;
  return `${noms[0]}, ${noms[1]} et ${noms.length - 2} autres y participent.`;
}

/**
 * « Appel en cours — rejoindre ».
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

  const [participants, setParticipants] = useState<readonly string[]>([]);

  useEffect(() => {
    if (!session) return;
    const appel = activeCall(session, roomId);
    const lire = () => {
      const etat = appel.current();
      setParticipants(etat.status === "active" ? etat.participants : []);
    };

    lire();
    const desabonner = appel.subscribe(lire);
    return () => {
      desabonner();
      appel.stop();
    };
  }, [session, roomId]);

  if (participants.length === 0) return null;

  /**
   * Le nom d'affichage quand le salon le connaît, l'identifiant sans son domaine sinon.
   * `getUserId` ne rend jamais rien de lisible tel quel — et un bandeau qui annonce
   * « @a4f21:serveur y participe » n'aide personne à décider s'il rejoint.
   */
  const nomDe = (userId: string): string => {
    const membre = session?.client.getRoom(roomId)?.getMember(userId);
    return membre?.name ?? identifiantCourt(userId);
  };

  return (
    <Banner
      status="info"
      title="Appel en cours"
      description={ligneParticipants(participants, nomDe)}
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
