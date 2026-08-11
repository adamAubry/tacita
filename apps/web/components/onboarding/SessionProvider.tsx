"use client";

import {
  initSession,
  onSessionInvalidee,
  restoreSession,
  type Session,
} from "@tacita/client-core";
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

import { poserIdentiteParDefaut } from "../../lib/identite-par-defaut";
import { etatDe, retirerJetonDeLUrl, urlConnexion, type EtatSession } from "../../lib/session";

interface Contexte {
  etat: EtatSession;
  /**
   * REQ-UI-04 — appelé par l'étape de récupération une fois la clé confirmée (création)
   * ou l'appareil déverrouillé (reconnexion). Les deux gestes finissent au même endroit :
   * cet appareil est désormais signé, la porte s'ouvre.
   */
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

  /*
   * REQ-UIX-06 — un jeton que le serveur refuse ne doit pas survivre à l'écran.
   *
   * Mesuré au navigateur le 08/08/2026 : session révoquée côté serveur, page rechargée,
   * et l'application se rouvrait comme si de rien n'était — les credentials locaux
   * suffisaient à la faire démarrer, et le refus n'arrivait que plus tard, dans /sync.
   * Le SDK a un signal pour ça, et c'est le seul qui distingue « refusé » de « injoignable ».
   */
  useEffect(() => {
    if (etat.phase !== "prete" && etat.phase !== "recuperation-requise") return;
    return onSessionInvalidee(etat.session, () => {
      setEtat({ phase: "hors-session" });
      versOidc();
    });
  }, [etat, versOidc]);

  const recuperationConfirmee = useCallback(() => {
    if (etat.phase !== "recuperation-requise") return;

    /*
     * REQ-MSG-22 — **le seul endroit du produit où « le compte vient d'être créé » est
     * une information disponible.** `mode` vaut `creation` quand le compte n'a aucune
     * identité cross-signing, c'est-à-dire à la toute première ouverture et à ce
     * moment-là seulement ; toute reconnexion passe par `deverrouillage`. Poser les
     * images ailleurs — au premier /sync, à l'ouverture du profil — aurait demandé un
     * marqueur local à maintenir, alors que la porte le sait déjà.
     *
     * Sans attendre, et sans bruit si ça échoue : l'étape qui vient de se terminer est
     * celle du chiffrement, et rien ne justifie de retenir l'entrée dans l'app pour deux
     * images décoratives. `poserImagesParDefaut` est sans effet au second appel, ce qui
     * rend ce départ sans garde sûr. Rien n'est journalisé — un échec de téléversement
     * porte l'URL d'un média (interdit n°8).
     *
     * ponytail: pas de reprise si le réseau tombe pile ici ; le compte reste sur ses
     * initiales jusqu'à ce qu'il choisisse une photo. Ajouter une reprise le jour où
     * l'écran de profil montre que c'est arrivé pour de vrai.
     */
    if (etat.mode === "creation") void poserIdentiteParDefaut(etat.session).catch(() => {});

    setEtat({ phase: "prete", session: etat.session });
  }, [etat]);

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
