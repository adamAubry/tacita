"use client";

import type { SearchStats } from "@tacita/search";
import { useCallback, useEffect, useState } from "react";

import { tailleLisible } from "../media/media";
import { useSession } from "../onboarding/SessionProvider";
import { useRecherche } from "../recherche/RechercheProvider";
import { Button, Text } from "../foundation/primitives";

interface Mesure {
  index: SearchStats | null;
  /** Octets occupés par l'origine entière, tels que le navigateur les compte. */
  octets?: number;
}

/**
 * « stockage local » : ce que cet appareil garde, et de quoi le vider.
 *
 * Deux chiffres, deux sources, et ils ne mesurent pas la même chose : `stats()` compte
 * les **messages indexés** (plafond D-01), `navigator.storage.estimate()` rend
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

  // L'index est celui de la session (`RechercheProvider`) : cet écran le **mesure et le
  // vide**, il n'en ouvre pas un second. Un moteur de plus sur la même base aurait donné
  // deux chiffres pour un même stockage.
  const recherche = useRecherche();
  const [mesure, setMesure] = useState<Mesure | null>(null);

  const relever = useCallback(async () => {
    const [index, estimation] = await Promise.all([
      recherche?.stats().catch(() => null) ?? null,
      navigator.storage?.estimate?.().catch(() => undefined),
    ]);
    setMesure({ index, octets: estimation?.usage });
  }, [recherche]);

  useEffect(() => {
    if (session) void relever();
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
        isDisabled={recherche === null}
        onClick={() => {
          // La mesure est reprise après la purge : la relire est la seule confirmation
          // honnête qu'elle a eu lieu.
          void recherche
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
