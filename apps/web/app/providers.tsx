"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

import { Theme, type ThemeMode } from "../components/foundation/primitives";
import { tacitaTheme } from "../components/foundation/theme";
import { RecoveryGate } from "../components/onboarding/RecoveryGate";
import { SessionProvider } from "../components/onboarding/SessionProvider";
import { ecrireTheme, lireTheme } from "../lib/preferences";

/**
 * L'adresse du homeserver est une donnée de déploiement, pas un secret : elle est
 * publique dès le premier appel réseau du client.
 */
const HOMESERVER = process.env.NEXT_PUBLIC_HOMESERVER_URL ?? "https://chat.example.org";

/**
 * **Le `Theme` d'Astryx doit être ici, dans un composant client à nous.** Posé
 * directement dans le layout racine — un composant serveur —, il fait échouer le rendu
 * (`defineSyntaxTheme` appelé côté serveur). Contrainte de construction du spike, M-A.
 */

/** DESIGN.md : le clair est le thème de référence ; c'est lui le défaut. */
export const MODE_DEFAUT: ThemeMode = "light";

const ContexteTheme = createContext<{ mode: ThemeMode; changerMode: (m: ThemeMode) => void }>({
  mode: MODE_DEFAUT,
  changerMode: () => {},
});

export const useModeTheme = () => useContext(ContexteTheme);

export function Providers({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<ThemeMode>(MODE_DEFAUT);

  // REQ-UI-03 — réhydratation depuis IndexedDB. Asynchrone par nature : le premier
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
        {/* REQ-UI-04 — la porte est **dans** le thème et **autour** de tout le contenu :
            aucune route ne rend quoi que ce soit tant que la clé n'est pas confirmée. */}
        <SessionProvider homeserverUrl={HOMESERVER}>
          <RecoveryGate>{children}</RecoveryGate>
        </SessionProvider>
      </Theme>
    </ContexteTheme.Provider>
  );
}
