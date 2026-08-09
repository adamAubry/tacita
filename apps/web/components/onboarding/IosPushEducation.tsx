"use client";

import { useEffect, useState } from "react";

import { Button, Text, VStack } from "../foundation/primitives";
import { Sheet } from "../foundation/Sheet";
import { ecrireRefusEducationIOS, lireRefusEducationIOS } from "../../lib/preferences";

/**
 * REQ-UI-18 (partie éducation) / REQ-PSH-05 — sur iOS, le Web Push n'existe **que** pour
 * une PWA installée à l'écran d'accueil. Ce n'est pas une limite de notre passerelle,
 * c'est Safari : hors standalone, aucun abonnement n'est possible.
 *
 * `standalone` sur `navigator` est une extension Safari, absente du type standard.
 */
export const estIOS = (userAgent: string) => /iPad|iPhone|iPod/.test(userAgent);

export const estInstallee = (): boolean =>
  globalThis.matchMedia?.("(display-mode: standalone)").matches === true ||
  (globalThis.navigator as Navigator & { standalone?: boolean }).standalone === true;

export interface IosPushEducationProps {
  /** REQ-UI-18 : **pas au premier lancement** — au premier point de friction pertinent. */
  declenche: boolean;
  indexedDB?: IDBFactory;
}

export function IosPushEducation({ declenche, indexedDB }: IosPushEducationProps) {
  const [visible, setVisible] = useState(false);
  const base = indexedDB ?? globalThis.indexedDB;

  useEffect(() => {
    if (!declenche || !estIOS(globalThis.navigator.userAgent) || estInstallee()) return;

    let annule = false;
    // REQ-UI-18 — un refus explicite vaut pour toujours. Insister est le plus court
    // chemin vers quelqu'un qui n'écoute plus, et la préférence survit au rechargement.
    void lireRefusEducationIOS(base).then((refusee) => {
      if (!annule && !refusee) setVisible(true);
    });
    return () => {
      annule = true;
    };
  }, [declenche, base]);

  const refuser = () => {
    setVisible(false);
    void ecrireRefusEducationIOS(base);
  };

  // Rien de monté tant que l'écran n'a pas lieu d'être : `<dialog>` garde son contenu
  // dans le DOM même fermé, et un contenu non pertinent y resterait lisible.
  if (!visible) return null;

  return (
    <Sheet ouvert onFermer={refuser} nom="Recevoir les notifications sur iPhone">
      <VStack gap={4}>
        <Text type="display-3">Recevoir les notifications sur iPhone</Text>
        <Text>
          Sur iPhone, les notifications ne fonctionnent que si Tacita est ajoutée à votre écran
          d&apos;accueil. Ouvrez le menu de partage de Safari, puis « Sur l&apos;écran
          d&apos;accueil ».
        </Text>
        {/* Honnêteté produit : on ne promet pas que ça marchera « bientôt » sans ça. */}
        <Text type="supporting">
          C&apos;est une contrainte de Safari, pas un réglage que nous pouvons changer.
        </Text>
        <Button label="Compris" variant="primary" onClick={refuser} />
      </VStack>
    </Sheet>
  );
}
