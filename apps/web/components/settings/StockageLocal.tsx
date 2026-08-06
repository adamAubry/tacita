"use client";

import { createSearch, type Search, type SearchStats } from "@tacita/search";
import { useCallback, useEffect, useRef, useState } from "react";

import { tailleLisible } from "../media/media";
import { useSession } from "../onboarding/SessionProvider";
import { Button, Text } from "../foundation/primitives";

interface Mesure {
  index: SearchStats | null;
  /** Octets occupés par l'origine entière, tels que le navigateur les compte. */
  octets?: number;
}

/**
 * REQ-UIX-31 — « stockage local » : ce que cet appareil garde, et de quoi le vider.
 *
 * Deux chiffres, deux sources, et ils ne mesurent pas la même chose : `stats()` compte
 * les **messages indexés** (spec 09, plafond D-01), `navigator.storage.estimate()` rend
 * les **octets de l'origine entière** — index, historique du SDK, clés, fonds d'écran.
 * Les additionner donnerait un nombre faux ; on les affiche côte à côte, chacun dit ce
 * qu'il est.
 *
 * L'estimation du navigateur est délibérément imprécise — c'est une protection contre
 * l'empreinte par stockage — et peut manquer. C'est écrit, plutôt que remplacé par un
 * « 0 Mo » rassurant et faux.
 */
export function StockageLocal() {
  const { etat } = useSession();
  const session = etat.phase === "prete" ? etat.session : null;

  const recherche = useRef<Search | null>(null);
  const [mesure, setMesure] = useState<Mesure | null>(null);

  const relever = useCallback(async () => {
    const [index, estimation] = await Promise.all([
      recherche.current?.stats().catch(() => null) ?? null,
      navigator.storage?.estimate?.().catch(() => undefined),
    ]);
    setMesure({ index, octets: estimation?.usage });
  }, []);

  useEffect(() => {
    if (!session) return;

    // Le worker vit le temps de l'écran et est **terminé** au démontage : ouvrir les
    // réglages ne doit pas laisser un moteur de plus branché sur la même base.
    const worker = new Worker(new URL("../../lib/search-worker.ts", import.meta.url));
    recherche.current = createSearch(session, worker);
    void relever();

    return () => {
      recherche.current?.dispose();
      recherche.current = null;
    };
  }, [session, relever]);

  return (
    <div style={{ display: "grid", gap: "var(--spacing-3)", padding: "var(--spacing-3)" }}>
      <div style={{ display: "grid", gap: "var(--spacing-1)" }}>
        <Text type="body" weight="bold" as="h2">
          Index de recherche
        </Text>
        <Text type="supporting" color="secondary" hasTabularNumbers>
          {mesure?.index
            ? `${mesure.index.size} messages indexés sur ${mesure.index.max}`
            : "Mesure en cours…"}
        </Text>
      </div>

      <div style={{ display: "grid", gap: "var(--spacing-1)" }}>
        <Text type="body" weight="bold" as="h2">
          Espace occupé sur cet appareil
        </Text>
        <Text type="supporting" color="secondary" hasTabularNumbers>
          {mesure === null
            ? "Mesure en cours…"
            : mesure.octets === undefined
              ? "Ce navigateur ne donne pas d'estimation."
              : `Environ ${tailleLisible(mesure.octets)} — historique, index, clés et fonds d'écran réunis.`}
        </Text>
      </div>

      <Button
        label="Vider l'index de recherche"
        variant="secondary"
        isDisabled={session === null}
        onClick={() => {
          // La mesure est reprise après la purge : la relire est la seule confirmation
          // honnête qu'elle a eu lieu.
          void recherche.current
            ?.wipe()
            .catch(() => {})
            .then(relever);
        }}
      />

      {/* Interdit n°13 : ce que le bouton fait, et ce qu'il ne fait pas. */}
      <Text type="supporting" color="secondary">
        L'index se reconstruit au fil des messages qui arrivent ; les messages déjà
        téléchargés ne redeviendront pas trouvables tant qu'ils ne sont pas relus. Vos
        conversations ne sont pas touchées.
      </Text>
    </div>
  );
}
