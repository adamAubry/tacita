"use client";

import { uploadCiphertext, type Bytes } from "@tacita/media-pipeline";
import { createOutbox, type Outbox } from "@tacita/outbox";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

import { useSession } from "../onboarding/SessionProvider";

const ContexteOutbox = createContext<Outbox | null>(null);

export const useOutbox = () => useContext(ContexteOutbox);

/**
 * **la file d'envoi appartient à la session, pas à un écran.**
 *
 * Elle vivait dans `Conversation` : créée à l'ouverture d'un salon, `dispose()` au
 * démontage. Le bandeau hors ligne promet pourtant que « ce que vous écrivez partira à la
 * reconnexion » — et cette promesse était fausse dès qu'on quittait l'écran. Mesuré au
 * navigateur : deux messages écrits hors ligne, un rechargement, le réseau
 * revenu, et rien ne partait — plus aucune `Conversation` n'était montée pour vider la
 * file. Une promesse qu'on ne tient pas est exactement ce que l'interdit n°13 refuse.
 *
 * Ici, elle est créée une fois la session prête et vidée dès que le réseau le permet,
 * quel que soit l'écran affiché — accueil, réglages, recherche.
 */
export function OutboxProvider({ children }: { children: ReactNode }) {
  const { etat } = useSession();
  const session = etat.phase === "prete" ? etat.session : null;
  const [outbox, setOutbox] = useState<Outbox | null>(null);

  useEffect(() => {
    if (!session) return;
    let vivant = true;
    let creee: Outbox | undefined;

    /*
     * l'étape de téléversement est **injectée** : la file
     * possède la reprise, le pipeline fournit l'étape idempotente, et aucun des deux
     * paquets ne dépend de l'autre. C'est ici, et seulement ici, qu'ils se rencontrent.
     */
    void createOutbox(session, {
      televerser: (octets) => uploadCiphertext(session, new Uint8Array(octets) as Bytes),
    }).then((file) => {
      if (!vivant) {
        file.dispose();
        return;
      }
      creee = file;
      setOutbox(file);
    });

    return () => {
      vivant = false;
      creee?.dispose();
      setOutbox(null);
    };
  }, [session]);

  return <ContexteOutbox.Provider value={outbox}>{children}</ContexteOutbox.Provider>;
}
