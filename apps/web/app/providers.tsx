"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

import { AppelEntrant } from "../components/appels/AppelEntrant";
import { OutboxProvider } from "../components/conversation/OutboxProvider";
import { ConnectionBannerLive } from "../components/foundation/ConnectionBanner";
import { Theme, type ThemeMode } from "../components/foundation/primitives";
import { tacitaTheme } from "../components/foundation/theme";
import { PushNotifications } from "../components/notifications/PushNotifications";
import { RechercheProvider } from "../components/recherche/RechercheProvider";
import { RecoveryGate } from "../components/onboarding/RecoveryGate";
import { SessionProvider } from "../components/onboarding/SessionProvider";
import { HOMESERVER } from "../lib/config";
import { ecrireTheme, lireTheme } from "../lib/preferences";

/**
 * **Le `Theme` d'Astryx doit être ici, dans un composant client à nous.** Posé
 * directement dans le layout racine — un composant serveur —, il fait échouer le rendu
 * (`defineSyntaxTheme` appelé côté serveur). Contrainte de construction du spike, M-A.
 */

/** DESIGN.md : le clair est le thème de référence ; c'est lui le défaut. */
export const MODE_DEFAUT: ThemeMode = "light";

const ContexteTheme = createContext<{
  mode: ThemeMode;
  changerMode: (m: ThemeMode) => void;
}>({
  mode: MODE_DEFAUT,
  changerMode: () => {},
});

export const useModeTheme = () => useContext(ContexteTheme);

export function Providers({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<ThemeMode>(MODE_DEFAUT);

  // réhydratation depuis IndexedDB. Asynchrone par nature : le premier
  // rendu se fait au défaut, ce qui est assumé (M-A). Un échec de lecture n'est pas une
  // panne : on reste au défaut plutôt que de bloquer l'app sur un réglage d'apparence.
  useEffect(() => {
    let annule = false;
    void lireTheme(globalThis.indexedDB)
      .then((enregistre) => {
        if (!annule && enregistre) setMode(enregistre);
      })
      .catch(() => {});
    return () => {
      annule = true;
    };
  }, []);

  const changerMode = useCallback((suivant: ThemeMode) => {
    setMode(suivant);
    void ecrireTheme(globalThis.indexedDB, suivant).catch(() => {});
  }, []);

  return (
    <ContexteTheme.Provider value={{ mode, changerMode }}>
      <Theme theme={tacitaTheme} mode={mode}>
        {/*
          Le fond de l'application. **Rien ne le peignait** : `html` et `body` sont
          transparents, et le conteneur d'Astryx ne fait que porter les tokens sans
          hauteur propre. En thème clair le blanc du navigateur passait pour le bon fond
          — en sombre, il serait resté blanc derrière tout espace non couvert.
          Mesuré au navigateur le 07/08/2026 ; jsdom ne peint pas.

          Ici et pas sur `body` : les tokens sont posés par `Theme` sur son conteneur,
          donc invisibles depuis `body`. `100dvh` et non `100vh` — sur mobile, la barre
          d'URL rétractable rend `vh` plus grand que la zone réellement visible.
        */}
        <div
          style={{
            minHeight: "100dvh",
            background: "var(--color-background-body)",
          }}
        >
          {/* la porte est **dans** le thème et **autour** de tout le contenu :
            aucune route ne rend quoi que ce soit tant que la clé n'est pas confirmée. */}
          {/* au-dessus de tout, porte de récupération comprise :
            perdre le réseau pendant l'onboarding mérite la même explication qu'ailleurs. */}
          <ConnectionBannerLive />
          <SessionProvider homeserverUrl={HOMESERVER}>
            {/* la file d'envoi est **au-dessus** de la porte et des écrans :
              ce qui a été écrit doit partir à la reconnexion quel que soit l'écran ouvert,
              y compris quand aucune conversation n'est affichée. */}
            <OutboxProvider>
              {/* l'index de recherche est **au-dessus des écrans**, pour la
                même raison que la file : il n'indexe que ce qui se déchiffre pendant
                qu'il est branché, et branché à l'ouverture d'un onglet il ne voyait
                jamais passer un message. */}
              <RechercheProvider>
                <RecoveryGate>{children}</RecoveryGate>
              </RechercheProvider>
            </OutboxProvider>
            {/* la chaîne push est **hors** de la porte de récupération : elle
              ne rend rien tant qu'un message n'est pas arrivé, et elle doit pouvoir
              répondre au service worker quel que soit l'écran affiché. */}
            <PushNotifications />
            {/* Et pour la même raison, l'appel entrant : il doit sonner quel que soit
              l'écran ouvert. Monté dans un écran, il n'aurait sonné que là — c'est
              exactement le défaut qu'il corrige. */}
            <AppelEntrant />
          </SessionProvider>
        </div>
      </Theme>
    </ContexteTheme.Provider>
  );
}
