"use client";

import { useEffect, useState } from "react";

import { basculerModeMasque } from "../../lib/mode-masque";
import { lireModeMasque } from "../../lib/preferences";
import { Banner, Switch, Text } from "../foundation/primitives";

interface ConfidentialiteProps {
  /** Surchargeable en test ; `globalThis.indexedDB` en navigateur. */
  indexedDB?: IDBFactory;
}

/**
 * (partie réglage) / le **mode masqué**.
 *
 * L'effet est **symétrique**, et c'est le seul point qui compte dans cet écran : passer
 * ses reçus en `m.read.private` ne fait pas que cacher les siens, ça éteint aussi ceux
 * qu'on reçoit. Beaucoup d'applications posent ce réglage sans le dire ; on l'écrit
 * au-dessus de l'interrupteur, avant le geste, pas dans une aide qu'il faut chercher.
 *
 * La bascule est **optimiste** : l'état visible suit le doigt, l'écriture IndexedDB
 * suit derrière. Un réglage d'affichage qui attendrait une transaction paraîtrait cassé.
 */
export function Confidentialite({ indexedDB = globalThis.indexedDB }: ConfidentialiteProps) {
  const [masque, setMasque] = useState(false);

  useEffect(() => {
    let annule = false;
    void lireModeMasque(indexedDB)
      .then((valeur) => {
        if (!annule) setMasque(valeur);
      })
      .catch(() => {});
    return () => {
      annule = true;
    };
  }, [indexedDB]);

  return (
    <div style={{ display: "grid", gap: "var(--spacing-3)", padding: "var(--spacing-3)" }}>
      <Switch
        label="Mode masqué"
        description="Vos accusés de lecture deviennent privés."
        value={masque}
        onChange={(valeur) => {
          setMasque(valeur);
          void basculerModeMasque(indexedDB, valeur).catch(() => {});
        }}
      />

      {/* L'échange est réel, il n'est pas une petite ligne : dit une fois, en clair. */}
      <Banner
        status="info"
        title="L'effet va dans les deux sens"
        description="Vos correspondants ne verront plus « délivré » ni « lu » de votre part — et vous ne verrez plus les leurs. Vos propres compteurs de non-lus continuent de se synchroniser entre vos appareils."
      />

      <Text type="supporting" color="secondary">
        « Délivré » est une extension à nous, pas un accusé standard de Matrix : un
        correspondant qui utilise un autre client ne l'émet pas, et son message reste à
        « envoyé » sans que cela veuille dire qu'il n'a pas été reçu.
      </Text>
    </div>
  );
}
