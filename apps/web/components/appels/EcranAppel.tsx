"use client";

import {
  attachCallWidget,
  buildCallWidget,
  discoverFocus,
  hangupLocal,
  RtcFociMissingError,
} from "@tacita/calls";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import { ELEMENT_CALL_URL, HOMESERVER } from "../../lib/config";
import { Placeholder } from "../foundation/Placeholder";
import { Button } from "../foundation/primitives";
import { useSession } from "../onboarding/SessionProvider";

/**
 * REQ-CAL-02 — la cause, en clair. Les trois `reason` n'appellent pas le même geste :
 * l'une se retente, les deux autres se règlent côté déploiement. Un « appel impossible »
 * unique ferait ressembler une pile sans SFU (E-08, cas fréquent en développement) à une
 * panne réseau passagère.
 */
export function messageFocusManquant(cause: unknown): string {
  if (!(cause instanceof RtcFociMissingError)) {
    return "L'appel n'a pas pu démarrer. Réessayez dans un instant.";
  }
  return cause.reason === "well-known-unreachable"
    ? "Le serveur n'a pas répondu. Vérifiez votre connexion, puis réessayez."
    : "Ce serveur n'a pas de service d'appel. Les appels y sont indisponibles — les messages, eux, fonctionnent.";
}

/**
 * Au-delà, le widget est considéré comme ne chargeant pas (REQ-UIX-38). Le compte
 * s'arrête quand Element Call **nous parle**, pas quand l'iframe charge : le `load` d'une
 * iframe se déclenche pour n'importe quel document, y compris une page d'erreur — s'y
 * fier ferait passer un déploiement en panne pour un appel qui démarre.
 */
export const DELAI_CHARGEMENT_MS = 15_000;

export interface EcranAppelProps {
  roomId: string;
  /** REQ-UIX-38 — le point d'entrée : « appel vidéo » plutôt qu'« appel audio ». */
  video: boolean;
}

/**
 * REQ-UI-19 / REQ-UIX-38 — **le shell d'appel, et rien de plus.**
 *
 * Ce qui est à nous : le conteneur plein écran avec ses safe-areas, la découverte du
 * focus et son message d'erreur, la sortie de secours tant que le widget n'a pas chargé.
 *
 * Ce qui ne l'est pas, et n'a pas à être discuté ici (E-07, interdit n°7) : la bascule
 * voix↔vidéo, le layout des vignettes, l'auto-masquage des contrôles, le raccrochage —
 * tout cela vit dans Element Call. Le seul paramètre que nous lui passons est celui du
 * point d'entrée choisi.
 */
export function EcranAppel({ roomId, video }: EcranAppelProps) {
  const { etat } = useSession();
  const router = useRouter();
  const session = etat.phase === "prete" ? etat.session : null;

  const cadre = useRef<HTMLIFrameElement>(null);
  const [erreur, setErreur] = useState<string | undefined>();
  const [charge, setCharge] = useState(false);
  const [expire, setExpire] = useState(false);

  // L'identifiant de widget est stable pour la durée de l'écran : `buildCallWidget` et
  // `attachCallWidget` doivent produire la même URL, sinon le pont postMessage parle à
  // une origine qui n'est pas celle de l'iframe.
  const options = useMemo(
    () => ({
      elementCallUrl: ELEMENT_CALL_URL,
      parentUrl: globalThis.location?.origin ?? "",
      widgetId: `tacita-call-${roomId}`,
      video,
    }),
    [roomId, video],
  );

  const url = useMemo(
    () => (session ? buildCallWidget(session, roomId, options).url : undefined),
    [session, roomId, options],
  );

  useEffect(() => {
    if (!session || !url) return;
    let annule = false;
    let detacher: (() => void) | undefined;

    void discoverFocus(HOMESERVER).then(
      () => {
        if (annule || !cadre.current) return;
        detacher = attachCallWidget(session, roomId, cadre.current, options, () => {
          if (!annule) setCharge(true);
        });
      },
      (cause: unknown) => {
        if (!annule) setErreur(messageFocusManquant(cause));
      },
    );

    return () => {
      annule = true;
      detacher?.();
      // Le widget retire son appartenance quand il se ferme proprement ; en démontage
      // brutal (retour arrière, navigation), il n'en a pas le temps — sans ceci le
      // salon resterait « appel en cours » jusqu'à l'expiration, quatre heures plus loin.
      void hangupLocal(session, roomId).catch(() => {});
    };
  }, [session, roomId, options, url]);

  useEffect(() => {
    if (charge || erreur) return;
    const minuteur = setTimeout(() => setExpire(true), DELAI_CHARGEMENT_MS);
    return () => clearTimeout(minuteur);
  }, [charge, erreur]);

  const sortir = () => router.back();
  const panne = erreur ?? (expire ? "Le service d'appel n'a pas répondu." : undefined);

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        display: "grid",
        background: "var(--color-background-body)",
        paddingTop: "env(safe-area-inset-top, 0px)",
        paddingBottom: "env(safe-area-inset-bottom, 0px)",
      }}
    >
      {panne ? (
        <Placeholder
          titre="Appel impossible"
          explication={panne}
          action={<Button label="Retour" variant="primary" onClick={sortir} />}
        />
      ) : (
        <>
          <iframe
            ref={cadre}
            src={url}
            title="Appel"
            // La contrainte de M-I : les permissions nécessaires, et pas une de plus.
            allow="camera; microphone; fullscreen"
            style={{ border: 0, width: "100%", height: "100%" }}
          />

          {/* La sortie de secours de REQ-UIX-38. Elle disparaît dès qu'Element Call est
              là : c'est lui qui porte le raccrochage, et deux boutons de sortie
              concurrents dans le même écran est exactement ce que E-07 refuse. */}
          {!charge && (
            <div
              style={{
                position: "absolute",
                top: "calc(var(--spacing-3) + env(safe-area-inset-top, 0px))",
                left: "var(--spacing-3)",
              }}
            >
              <Button label="Quitter" variant="secondary" onClick={sortir} />
            </div>
          )}
        </>
      )}
    </div>
  );
}
