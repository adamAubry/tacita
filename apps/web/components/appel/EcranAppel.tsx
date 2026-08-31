"use client";

import {
  attachCallWidget,
  buildCallWidget,
  discoverFocus,
  hangupLocal,
  RtcFociMissingError,
  type CallWidget,
} from "@tacita/calls";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { Button, Text } from "../foundation/primitives";
import { useSession } from "../onboarding/SessionProvider";

/** Déploiement Element Call : une valeur d'exploitation, publique par nature. */
const ELEMENT_CALL_URL = process.env.NEXT_PUBLIC_ELEMENT_CALL_URL ?? "https://call.example.org";

/**
 * Au-delà, le widget ne chargera pas : réseau coupé, déploiement Element Call absent,
 * CSP qui refuse l'iframe. Généreux à dessein — une connexion lente n'est pas une panne.
 */
export const DELAI_CHARGEMENT_MS = 20_000;

/**
 * REQ-CAL-02 / REQ-UI-19 — chaque panne de focus dit ce qu'elle est. Un bouton d'appel
 * qui ne fait rien, ou un écran noir, est exactement ce que l'exigence refuse.
 */
function messageDeLErreur(erreur: unknown): string {
  if (!(erreur instanceof RtcFociMissingError)) return "L'appel n'a pas pu être préparé.";

  switch (erreur.reason) {
    case "well-known-unreachable":
      return "Le serveur n'a pas répondu. Sans sa configuration d'appel, aucun appel ne peut démarrer.";
    case "well-known-absent":
      return "Ce serveur n'annonce aucun service d'appel. Les appels y sont indisponibles.";
    default:
      return "Le service d'appel annoncé par ce serveur n'est pas pris en charge. Signalez-le à son administrateur.";
  }
}

type Phase =
  | { quoi: "ouverture" }
  | { quoi: "widget"; widget: CallWidget }
  | { quoi: "echec"; message: string };

/**
 * REQ-UI-19 / REQ-UIX-38 — le shell d'appel, et rien de plus : un conteneur plein écran,
 * l'iframe Element Call, une sortie de secours.
 *
 * Tout ce qui se passe **dans** l'appel appartient à Element Call (E-07, interdit n°7) :
 * bascule voix↔vidéo, disposition des vignettes, auto-masquage des menus. Nous n'avons
 * ni à les rendre, ni à les imiter — le seul choix qui nous revient est le point
 * d'entrée, audio ou vidéo, passé au widget en paramètre de lancement.
 */
export function EcranAppel({
  roomId,
  media,
  rejoindre = false,
}: {
  roomId: string;
  media: "audio" | "video";
  rejoindre?: boolean;
}) {
  const { etat } = useSession();
  const router = useRouter();
  const session = etat.phase === "prete" ? etat.session : null;

  const iframe = useRef<HTMLIFrameElement>(null);
  const [phase, setPhase] = useState<Phase>({ quoi: "ouverture" });
  const [charge, setCharge] = useState(false);
  const [tropLong, setTropLong] = useState(false);

  // REQ-CAL-02 — le focus se découvre avant de monter quoi que ce soit : un widget monté
  // sans SFU joignable donne un écran noir, là où la panne a un nom.
  useEffect(() => {
    if (!session) return;
    let annule = false;

    void discoverFocus(session.client.baseUrl)
      .then(() => {
        if (annule) return;
        setPhase({
          quoi: "widget",
          widget: buildCallWidget(session, roomId, {
            elementCallUrl: ELEMENT_CALL_URL,
            parentUrl: globalThis.location.origin,
            widgetId: `tacita-appel-${roomId}`,
            media,
            join: rejoindre,
          }),
        });
      })
      .catch((erreur: unknown) => {
        if (!annule) setPhase({ quoi: "echec", message: messageDeLErreur(erreur) });
      });

    return () => {
      annule = true;
    };
  }, [session, roomId, media, rejoindre]);

  /**
   * REQ-CAL-05 — l'iframe est à nous, la conversation avec le widget est au paquet 10.
   * Le décrochage vide aussi notre appartenance à l'appel : quitter l'écran sans le faire
   * laisserait le salon « en appel » pour les autres jusqu'à expiration.
   */
  useEffect(() => {
    if (phase.quoi !== "widget" || !session || !iframe.current) return;
    const detacher = attachCallWidget(iframe.current, session, roomId, phase.widget);

    return () => {
      detacher();
      void hangupLocal(session, roomId).catch(() => {});
    };
  }, [phase, session, roomId]);

  // REQ-UIX-38 — le widget qui ne charge pas doit se voir. Sans ce minuteur, l'écran
  // reste noir sans jamais rien dire, et la sortie de secours passe pour une annulation.
  useEffect(() => {
    if (phase.quoi !== "widget" || charge) return;
    const minuteur = setTimeout(() => setTropLong(true), DELAI_CHARGEMENT_MS);
    return () => clearTimeout(minuteur);
  }, [phase, charge]);

  const sortir = () => router.back();

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Appel"
      style={{
        position: "fixed",
        inset: 0,
        display: "grid",
        gridTemplateRows: "auto 1fr",
        background: "var(--color-background-body)",
        paddingTop: "env(safe-area-inset-top, 0px)",
        paddingBottom: "env(safe-area-inset-bottom, 0px)",
        paddingLeft: "env(safe-area-inset-left, 0px)",
        paddingRight: "env(safe-area-inset-right, 0px)",
        zIndex: 20,
      }}
    >
      {/* La sortie de secours est là dès le premier instant, pas seulement après une
          panne : un widget qui s'affiche mais ne répond plus enferme tout autant. */}
      <div style={{ padding: "var(--spacing-2)" }}>
        <Button label="Quitter l'appel" variant="ghost" onClick={sortir} />
      </div>

      {phase.quoi === "widget" ? (
        <>
          <iframe
            ref={iframe}
            src={phase.widget.url}
            title="Appel"
            onLoad={() => setCharge(true)}
            // Strictement ce dont un appel a besoin : ni géolocalisation, ni paiement,
            // ni capteurs. Le partage d'écran passe par le même geste que la caméra.
            allow="camera; microphone; fullscreen"
            style={{ border: "none", width: "100%", height: "100%" }}
          />
          {tropLong && !charge && (
            <div
              style={{
                position: "absolute",
                inset: 0,
                display: "grid",
                placeItems: "center",
                gap: "var(--spacing-3)",
                padding: "var(--spacing-4)",
                background: "var(--color-background-body)",
                textAlign: "center",
              }}
            >
              <Text>
                L&apos;appel ne s&apos;ouvre pas. Le service d&apos;appel ne répond pas, ou votre
                connexion l&apos;empêche de charger.
              </Text>
              <Button label="Revenir à la conversation" variant="primary" onClick={sortir} />
            </div>
          )}
        </>
      ) : (
        <div
          style={{
            display: "grid",
            placeItems: "center",
            gap: "var(--spacing-3)",
            padding: "var(--spacing-4)",
            textAlign: "center",
          }}
        >
          <Text>{phase.quoi === "echec" ? phase.message : "Préparation de l'appel…"}</Text>
          {phase.quoi === "echec" && (
            <Button label="Revenir à la conversation" variant="primary" onClick={sortir} />
          )}
        </div>
      )}
    </div>
  );
}
