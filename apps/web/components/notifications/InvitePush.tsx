"use client";

import type { Session } from "@tacita/client-core";
import { useEffect, useState } from "react";

import { ecrireRefusInvitePush, lireRefusInvitePush } from "../../lib/preferences";
import { activerPush, etatPush } from "../../lib/push";
import { Button, Text, VStack } from "../foundation/primitives";
import { Sheet } from "../foundation/Sheet";
import { estInstallee, estIOS, IosPushEducation } from "../onboarding/IosPushEducation";

export interface InvitePushProps {
  /**
   * REQ-UI-18 — **le bon moment** : après un premier message reçu, jamais au premier
   * lancement. Une permission demandée avant qu'on sache à quoi elle sert est une
   * permission refusée, et un refus navigateur ne se redemande pas.
   */
  declenche: boolean;
  session: Session | null;
  indexedDB?: IDBFactory;
}

/**
 * L'invitation à activer les notifications. Elle ne se montre que si elle a une chance
 * d'aboutir : permission encore à demander, et pas déjà écartée une fois.
 *
 * Sur iPhone hors écran d'accueil, aucun abonnement n'est possible (REQ-PSH-05) : on
 * montre l'explication de M-B au lieu d'une demande qui échouerait sans dire pourquoi.
 */
export function InvitePush({ declenche, session, indexedDB }: InvitePushProps) {
  const base = indexedDB ?? globalThis.indexedDB;
  const [visible, setVisible] = useState(false);
  const iosSansPwa = declenche && estIOS(globalThis.navigator.userAgent) && !estInstallee();

  useEffect(() => {
    if (!declenche || !session || iosSansPwa) return;
    let annule = false;

    void Promise.all([etatPush(), lireRefusInvitePush(base)]).then(([etat, refusee]) => {
      if (!annule && etat === "a-demander" && !refusee) setVisible(true);
    });

    return () => {
      annule = true;
    };
  }, [declenche, session, iosSansPwa, base]);

  if (iosSansPwa) return <IosPushEducation declenche indexedDB={base} />;

  const ecarter = () => {
    setVisible(false);
    void ecrireRefusInvitePush(base).catch(() => {});
  };

  if (!visible) return null;

  return (
    <Sheet ouvert onFermer={ecarter} titre="Être prévenu des nouveaux messages">
      <VStack gap={4}>
        <Text>
          Votre navigateur vous préviendra quand un message arrive. Le contenu reste
          chiffré : il est déchiffré sur cet appareil, au moment de l&apos;affichage.
        </Text>
        <Button
          label="Activer les notifications"
          variant="primary"
          clickAction={async () => {
            setVisible(false);
            // L'échec n'a rien à dire ici : l'état exact, et le chemin de rattrapage,
            // vivent dans les réglages (REQ-UI-18).
            if (session) await activerPush(session).catch(() => undefined);
          }}
        />
        <Button label="Plus tard" variant="ghost" onClick={ecarter} />
      </VStack>
    </Sheet>
  );
}
