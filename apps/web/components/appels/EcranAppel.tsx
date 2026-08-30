/**
 * L'écran d'appel : le widget Element Call, et ce qui l'entoure.
 *
 *  1. `messageFocusManquant` — traduit un échec de découverte du SFU en une phrase
 *     qui dit quoi faire, au lieu d'un 502 en pleine connexion.
 *  2. `EcranAppel` — monte le widget, et abandonne après `DELAI_CHARGEMENT_MS` plutôt
 *     que de laisser tourner un écran noir.
 */
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
import { ConversationAvatar } from "../foundation/ConversationAvatar";
import { IconeAppel } from "../foundation/icons";
import { Placeholder } from "../foundation/Placeholder";
import { Button, Text } from "../foundation/primitives";
import { useSession } from "../onboarding/SessionProvider";

/**
 * la cause, en clair. Les trois `reason` n'appellent pas le même geste :
 * l'une se retente, les deux autres se règlent côté déploiement. Un « appel impossible »
 * unique ferait ressembler une pile sans SFU (cas fréquent en développement) à une
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
 * Au-delà, le widget est considéré comme ne chargeant pas. Le compte
 * s'arrête quand Element Call **nous parle**, pas quand l'iframe charge : le `load` d'une
 * iframe se déclenche pour n'importe quel document, y compris une page d'erreur — s'y
 * fier ferait passer un déploiement en panne pour un appel qui démarre.
 */
export const DELAI_CHARGEMENT_MS = 15_000;

interface EcranAppelProps {
  roomId: string;
  /** le point d'entrée : « appel vidéo » plutôt qu'« appel audio ». */
  video: boolean;
}

/**
 * **le shell d'appel, et rien de plus.**
 *
 * Ce qui est à nous : le conteneur plein écran avec ses safe-areas, la découverte du
 * focus et son message d'erreur, la sortie de secours tant que le widget n'a pas chargé.
 *
 * Ce qui ne l'est pas, et n'a pas à être discuté ici (interdit n°7) : la bascule
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
        detacher = attachCallWidget(
          session,
          roomId,
          cadre.current,
          options,
          () => {
            if (!annule) setCharge(true);
          },
          // **Le raccrochage vit dans le widget** (E-07 : pas deux sorties concurrentes
          // dans le même écran), donc c'est lui qui nous dit quand sortir. Sans cet
          // écouteur, raccrocher dans Element Call laissait cet écran ouvert sur une
          // session finie — l'appel était terminé et l'utilisateur restait devant.
          () => {
            if (!annule) router.back();
          },
        );
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

  /**
   * **Qui on appelle, pendant qu'on l'appelle.** Le nom du salon vient du SDK, comme
   * partout ailleurs dans le shard ; rien n'est dérivé ici. Absent — salon pas encore
   * connu du client —, l'écran d'attente se réduit à sa ligne d'état, ce qui reste très
   * au-dessus de ce qu'il montrait avant : une iframe vide.
   */
  const salon = session?.client.getRoom(roomId) ?? null;
  const nom = salon?.name ?? "";
  const direct = (salon?.getJoinedMemberCount() ?? 2) <= 2;

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
          icone={IconeAppel}
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

          {/*
            **L'écran d'attente, et pas une iframe vide.** Le widget met une à trois
            secondes à parler, et pendant ce temps l'écran ne montrait rien : ni qui on
            appelait, ni que quelque chose se passait. C'est le moment où l'on se demande
            si on a touché le bon bouton, et c'est exactement le moment où les appels se
            raccrochent avant d'avoir commencé.

            Un avatar, un nom, une ligne d'état — la forme qu'a prise cet écran partout,
            et pour une raison : elle répond aux deux questions qu'on se pose. Pas de
            spinner : DESIGN.md n'en veut pas en plein écran, et il ne dirait de toute
            façon ni qui ni quoi.

            Il disparaît dès qu'Element Call est là : c'est lui qui porte le raccrochage,
            et deux boutons de sortie concurrents dans le même écran est exactement ce
            que E-07 refuse.
          */}
          {!charge && (
            <div
              aria-live="polite"
              style={{
                position: "absolute",
                inset: 0,
                display: "grid",
                gridTemplateRows: "1fr auto",
                justifyItems: "center",
                background: "var(--color-background-body)",
                paddingTop: "env(safe-area-inset-top, 0px)",
                paddingBottom: "calc(var(--spacing-5) + env(safe-area-inset-bottom, 0px))",
              }}
            >
              <div
                style={{
                  alignSelf: "center",
                  display: "grid",
                  justifyItems: "center",
                  gap: "var(--spacing-3)",
                  padding: "var(--spacing-3)",
                  textAlign: "center",
                }}
              >
                {nom !== "" && <ConversationAvatar nom={nom} direct={direct} taille={96} />}
                {nom !== "" && <Text type="display-3">{nom}</Text>}
                <Text type="supporting" color="secondary">
                  {video ? "Appel vidéo · connexion…" : "Appel audio · connexion…"}
                </Text>
              </div>

              {/* « Annuler » et non « Quitter » : rien n'a commencé, il n'y a rien à
                  quitter — et le mot juste évite d'hésiter avant de le toucher. */}
              <Button label="Annuler" variant="secondary" onClick={sortir} />
            </div>
          )}
        </>
      )}
    </div>
  );
}
