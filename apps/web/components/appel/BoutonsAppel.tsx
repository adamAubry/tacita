"use client";

import { openDirectMessage } from "@tacita/messaging";
import { useRouter } from "next/navigation";

import { IconeAppel, IconeVideo } from "../foundation/icons";
import { Button } from "../foundation/primitives";
import { useSession } from "../onboarding/SessionProvider";

/**
 * **L'unique chemin d'entrée en appel.** Le header de conversation (M-D), le bandeau
 * « appel en cours » et les Friends interaction buttons (M-G) passent tous par ici :
 * REQ-UIX-39 demande « le même chemin », et deux constructions d'URL finissent toujours
 * par diverger d'un paramètre.
 */
export const cheminAppel = (roomId: string, media: "audio" | "video", rejoindre = false) =>
  `/c/${roomId}/appel?media=${media}${rejoindre ? "&rejoindre=1" : ""}`;

/**
 * REQ-UI-19 — les deux boutons d'appel du header de conversation. Icônes seules, comme
 * le reste des actions de header ; le comportement est ici, l'emplacement vient de M-D.
 *
 * Ils ne vérifient rien avant de naviguer : la découverte du focus RTC (REQ-CAL-02) a
 * lieu sur l'écran d'appel, qui sait afficher la panne. Tester ici obligerait à un appel
 * réseau au rendu du header, et un bouton grisé sans explication est précisément ce que
 * REQ-UI-19 refuse.
 */
export function BoutonsAppel({ roomId }: { roomId: string }) {
  const router = useRouter();

  return (
    <>
      <Button
        label="Appel audio"
        variant="ghost"
        isIconOnly
        icon={IconeAppel}
        onClick={() => router.push(cheminAppel(roomId, "audio"))}
      />
      <Button
        label="Appel vidéo"
        variant="ghost"
        isIconOnly
        icon={IconeVideo}
        onClick={() => router.push(cheminAppel(roomId, "video"))}
      />
    </>
  );
}

/**
 * REQ-UIX-39 — l'entrée « Appel audio » d'un profil (Friends interaction buttons, M-G).
 *
 * Un profil connaît une personne, pas un salon : `openDirectMessage` (spec 05) rend le
 * DM existant ou le crée, puis on repart sur `cheminAppel` — le même chemin que le
 * header, au paramètre près.
 */
export function BoutonAppelAmi({ userId }: { userId: string }) {
  const { etat } = useSession();
  const router = useRouter();
  const session = etat.phase === "prete" ? etat.session : null;

  return (
    <Button
      label="Appel audio"
      variant="secondary"
      icon={IconeAppel}
      isDisabled={!session}
      clickAction={async () => {
        if (!session) return;
        router.push(cheminAppel(await openDirectMessage(session, userId), "audio"));
      }}
    />
  );
}
