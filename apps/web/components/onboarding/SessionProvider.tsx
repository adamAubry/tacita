"use client";

import { initSession, restoreSession, type Session } from "@tacita/client-core";
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

import { etatDe, retirerJetonDeLUrl, urlConnexion, type EtatSession } from "../../lib/session";

interface Contexte {
  etat: EtatSession;
  /** REQ-UI-04 — appelé par l'étape de récupération une fois la clé confirmée. */
  recuperationConfirmee: () => void;
  /** REQ-UIX-06 — wipe complet (REQ-COR-10), après confirmation explicite. */
  deconnecter: (session: Session) => Promise<void>;
}

const ContexteSession = createContext<Contexte>({
  etat: { phase: "chargement" },
  recuperationConfirmee: () => {},
  deconnecter: async () => {},
});

export const useSession = () => useContext(ContexteSession);

export interface SessionProviderProps {
  children: ReactNode;
  homeserverUrl: string;
  /** Injecté en test ; en production, la vraie redirection du navigateur. */
  rediriger?: (url: string) => void;
}

/**
 * REQ-UIX-06 — la reprise de session, dans l'ordre où elle se produit :
 *
 * 1. un jeton de connexion dans l'URL (retour du fournisseur OIDC) → on ouvre la session
 *    et **on retire le jeton de l'historique** ;
 * 2. sinon, une session restaurable en IndexedDB → arrivée directe sur l'Accueil, sans
 *    réseau ni écran intermédiaire ;
 * 3. sinon → retour à l'OIDC, sans écran intermédiaire non plus. Un écran « connectez-vous »
 *    qui ne fait que rediriger est une étape de plus pour rien.
 *
 * Un jeton restauré n'est pas validé (limite assumée de `client-core`) : un
 * `M_UNKNOWN_TOKEN` au premier appel se traduit ici par un retour à l'OIDC.
 */
export function SessionProvider({ children, homeserverUrl, rediriger }: SessionProviderProps) {
  const [etat, setEtat] = useState<EtatSession>({ phase: "chargement" });

  const versOidc = useCallback(() => {
    const aller = rediriger ?? ((url: string) => globalThis.location.assign(url));
    aller(urlConnexion(homeserverUrl, globalThis.location.origin));
  }, [homeserverUrl, rediriger]);

  useEffect(() => {
    let annule = false;

    void (async () => {
      try {
        const jeton = retirerJetonDeLUrl(globalThis.location, globalThis.history);
        const session = jeton
          ? await initSession({ homeserverUrl, loginToken: jeton })
          : await restoreSession({ homeserverUrl });

        if (annule) return;
        if (!session) {
          setEtat({ phase: "hors-session" });
          versOidc();
          return;
        }
        setEtat(await etatDe(session));
      } catch {
        // Jeton révoqué, crypto indisponible, réseau absent au premier appel : dans tous
        // les cas l'entrée passe par l'OIDC. Rien n'est journalisé — un message d'erreur
        // de connexion peut porter le jeton.
        if (!annule) {
          setEtat({ phase: "hors-session" });
          versOidc();
        }
      }
    })();

    return () => {
      annule = true;
    };
  }, [homeserverUrl, versOidc]);

  const recuperationConfirmee = useCallback(() => {
    setEtat((precedent) =>
      precedent.phase === "recuperation-requise"
        ? { phase: "prete", session: precedent.session }
        : precedent,
    );
  }, []);

  const deconnecter = useCallback(
    async (session: Session) => {
      await session.logout();
      setEtat({ phase: "hors-session" });
      versOidc();
    },
    [versOidc],
  );

  return (
    <ContexteSession.Provider value={{ etat, recuperationConfirmee, deconnecter }}>
      {children}
    </ContexteSession.Provider>
  );
}
