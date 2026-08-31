"use client";

import { activeCall } from "@tacita/calls";
import type { Session } from "@tacita/client-core";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { Banner, Button } from "../foundation/primitives";
import { cheminAppel } from "./BoutonsAppel";

/**
 * REQ-UI-19 / REQ-CAL-03 — « Appel en cours — rejoindre », dans les salons concernés.
 *
 * L'état vient entièrement du paquet 10, qui le dérive des événements d'état MatrixRTC :
 * le shard ne compte pas les participants et n'invente pas de sonnerie (YAGNI, spec 10).
 *
 * Persistant, donc non dismissable : un appel en cours qu'on a chassé d'un geste reste
 * en cours, et le bandeau serait alors un mensonge par omission.
 */
export function BandeauAppel({ session, roomId }: { session: Session; roomId: string }) {
  const router = useRouter();
  const [actif, setActif] = useState(false);

  useEffect(() => {
    const appel = activeCall(session, roomId);
    setActif(appel.current().status === "active");
    const desabonner = appel.subscribe((etat) => setActif(etat.status === "active"));

    return () => {
      desabonner();
      appel.stop();
    };
  }, [session, roomId]);

  if (!actif) return null;

  return (
    <Banner
      status="info"
      container="section"
      title="Appel en cours"
      endContent={
        <Button
          label="Rejoindre"
          variant="secondary"
          onClick={() => router.push(cheminAppel(roomId, "video", true))}
        />
      }
    />
  );
}
