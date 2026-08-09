"use client";

import { createOutbox, type Outbox } from "@tacita/outbox";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

import { useSession } from "../onboarding/SessionProvider";

const ContexteOutbox = createContext<Outbox | null>(null);

export const useOutbox = () => useContext(ContexteOutbox);

/**
 * REQ-OBX-01 / REQ-UI-17 — **la file d'envoi appartient à la session, pas à un écran.**
 *
 * Elle vivait dans `Conversation` : créée à l'ouverture d'un salon, `dispose()` au
 * démontage. Le bandeau hors ligne promet pourtant que « ce que vous écrivez partira à la
 * reconnexion » — et cette promesse était fausse dès qu'on quittait l'écran. Mesuré au
 * navigateur le 08/08/2026 : deux messages écrits hors ligne, un rechargement, le réseau
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

    void createOutbox(session).then((file) => {
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
