"use client";

import {
  initSession,
  onSessionInvalidee,
  restoreSession,
  type Session,
} from "@tacita/client-core";
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

import { ecrireOnboardingEnCours } from "../../lib/preferences";
import { etatDe, retirerJetonDeLUrl, urlConnexion, type EtatSession } from "../../lib/session";

interface Contexte {
  etat: EtatSession;
  /**
   * REQ-UI-04 — appelé par l'étape de récupération une fois la clé confirmée (création)
   * ou l'appareil déverrouillé (reconnexion). Les deux gestes finissent au même endroit :
   * cet appareil est désormais signé, la porte s'ouvre.
   */
  recuperationConfirmee: () => void;
  /**
   * REQ-UI-22 — le parcours d'accueil est terminé (ou n'a jamais commencé). C'est la
   * seule chose qui rende l'app atteignable une fois la clé confirmée sur un compte neuf.
   */
  onboardingTermine: () => void;
  /** REQ-UIX-06 — wipe complet (REQ-COR-10), après confirmation explicite. */
  deconnecter: (session: Session) => Promise<void>;
}

const ContexteSession = createContext<Contexte>({
  etat: { phase: "chargement" },
  recuperationConfirmee: () => {},
  onboardingTermine: () => {},
  deconnecter: async () => {},
});

export const useSession = () => useContext(ContexteSession);

interface SessionProviderProps {
  children: ReactNode;
  homeserverUrl: string;
  /** Injecté en test ; en production, la vraie redirection du navigateur. */
  rediriger?: (url: string) => void;
  /** REQ-COR-03 — surchargeable en test ; `globalThis.indexedDB` en navigateur. */
  indexedDB?: IDBFactory;
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
export function SessionProvider({
  children,
  homeserverUrl,
  rediriger,
  indexedDB,
}: SessionProviderProps) {
  const [etat, setEtat] = useState<EtatSession>({ phase: "chargement" });
  const base = indexedDB ?? globalThis.indexedDB;

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
        setEtat(await etatDe(session, base));
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
  }, [homeserverUrl, versOidc, base]);

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
     * REQ-UI-22 — **le seul endroit du produit où « le compte vient d'être créé » est une
     * information disponible.** `mode` vaut `creation` quand le compte n'a aucune identité
     * cross-signing, c'est-à-dire à la toute première ouverture et à ce moment-là
     * seulement ; toute reconnexion passe par `deverrouillage`.
     *
     * C'est donc ici, et nulle part ailleurs, que le parcours d'accueil peut savoir qu'il
     * a lieu d'être. Un déverrouillage, lui, entre directement dans l'app : la personne a
     * déjà un profil, des notifications réglées et des conversations — lui rejouer le
     * parcours serait lui redemander ce qu'elle a déjà répondu.
     *
     * La marque IndexedDB qui rend le parcours reprenable après un rechargement est posée
     * par le parcours lui-même (`Onboarding`), pas ici : c'est lui qui sait quand il
     * commence et quand il finit.
     *
     * **Mais `mode` ne suffit pas à décider seul** (corrigé le 25/08/2026). Il dit d'où
     * l'on sort, pas où l'on en était : une inscription interrompue au dépôt de l'identité
     * repart en `deverrouillage`, et le parcours — commencé, marqué, jamais fini — était
     * alors jeté. Symptôme exact remonté par l'utilisateur : la clé recréée, puis l'accueil
     * d'une application vide au lieu de l'étape suivante. La marque est la seule chose qui
     * sache répondre, et `etatDe` l'a déjà lue pour les deux phases.
     */
    setEtat({
      phase: "prete",
      session: etat.session,
      onboarding: etat.mode === "creation" || etat.onboarding,
    });
  }, [etat]);

  const onboardingTermine = useCallback(() => {
    if (etat.phase !== "prete") return;
    // Sans bruit si l'écriture échoue : le pire cas est un parcours reproposé au prochain
    // lancement, jamais une app inatteignable — la marque n'ouvre aucune porte, elle en
    // retarde une.
    if (base) void ecrireOnboardingEnCours(base, false).catch(() => {});
    setEtat({ phase: "prete", session: etat.session });
  }, [etat, base]);

  const deconnecter = useCallback(
    async (session: Session) => {
      await session.logout();
      setEtat({ phase: "hors-session" });
      versOidc();
    },
    [versOidc],
  );

  return (
    <ContexteSession.Provider
      value={{ etat, recuperationConfirmee, onboardingTermine, deconnecter }}
    >
      {children}
    </ContexteSession.Provider>
  );
}
