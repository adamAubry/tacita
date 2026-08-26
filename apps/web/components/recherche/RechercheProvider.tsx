"use client";

import { createSearch, type Search } from "@tacita/search";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

import { useSession } from "../onboarding/SessionProvider";

const ContexteRecherche = createContext<Search | null>(null);

export const useRecherche = () => useContext(ContexteRecherche);

/**
 * **l'index de recherche appartient à la session, pas à un
 * écran.** Même défaut, même remède qu'`OutboxProvider`.
 *
 * `createSearch` n'indexe pas l'historique : il écoute `MatrixEventEvent.Decrypted` et
 * indexe ce qui se déchiffre **pendant qu'il est branché**. Créé à l'ouverture de
 * l'onglet Recherche et jeté à sa fermeture, il n'était donc branché que sur les
 * quelques secondes où personne n'écrit — tout le reste, c'est-à-dire tous les messages
 * de la vie de l'app, se déchiffrait sans témoin. Signalé par les utilisateurs sous la
 * forme « la recherche des messages et des mentions ne fonctionne juste pas » : c'était
 * exact, l'index était vide et le restait.
 *
 * Ici il vit tant que la session vit : les messages qui arrivent, ceux qu'on écrit, et
 * ceux que la remontée d'historique redescend du serveur entrent tous dans
 * l'index quel que soit l'écran affiché.
 */
export function RechercheProvider({ children }: { children: ReactNode }) {
  const { etat } = useSession();
  const session = etat.phase === "prete" ? etat.session : null;
  const [recherche, setRecherche] = useState<Search | null>(null);

  useEffect(() => {
    if (!session) return;

    /*
     * `lib/search-worker.ts`, comme l'autre site du shard : une seule forme, une seule
     * chose à vérifier au prochain changement de bundler.
     *
     * Mesuré au build le 21/08/2026, parce que l'en-tête de `lib/search-worker.ts` laisse
     * entendre le contraire : webpack **résout aussi** `new URL("@tacita/search/worker",
     * import.meta.url)` et en émet le même chunk de worker. Les deux formes marchent ici ;
     * ce n'est donc pas un correctif, seulement une uniformisation.
     */
    const worker = new Worker(new URL("../../lib/search-worker.ts", import.meta.url), {
      type: "module",
    });
    const instance = createSearch(session, worker);
    setRecherche(instance);

    return () => {
      instance.dispose();
      setRecherche(null);
    };
  }, [session]);

  return <ContexteRecherche.Provider value={recherche}>{children}</ContexteRecherche.Provider>;
}
