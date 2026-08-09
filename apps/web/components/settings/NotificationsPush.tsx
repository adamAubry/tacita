"use client";

import { useEffect, useState } from "react";

import { abonnerAuxNotifications, permissionPush } from "../../lib/push";
import { Button, Text } from "../foundation/primitives";
import { useSession } from "../onboarding/SessionProvider";

/** Ce que chaque état de permission dit, et ce qu'il laisse faire. */
const ETATS = {
  granted: {
    titre: "Notifications activées",
    texte: "Votre appareil vous prévient à l'arrivée d'un message.",
  },
  default: {
    titre: "Notifications non activées",
    texte: "Vous serez prévenu des nouveaux messages, même application fermée.",
    action: "Activer",
  },
  denied: {
    titre: "Notifications refusées",
    // REQ-UI-18 — le chemin de rattrapage. Un refus se lève **dans le navigateur** : le
    // dire est la seule chose utile ici, un bouton « Activer » ne pourrait qu'échouer en
    // silence, la permission n'étant plus redemandable.
    texte:
      "Ce navigateur les a bloquées pour Tacita. Rouvrez ses réglages de site — l'icône à gauche de l'adresse — et autorisez les notifications.",
  },
  indisponible: {
    titre: "Notifications indisponibles",
    texte: "Ce navigateur ne gère pas les notifications web. Le reste de Tacita fonctionne.",
  },
} as const;

/**
 * REQ-UI-18 — l'état de l'abonnement push, et son rattrapage, dans les réglages.
 *
 * C'est le second point d'entrée voulu par l'exigence : le premier est la proposition au
 * premier message reçu, celui-ci est celui qu'on cherche quand on s'est aperçu de rien.
 */
export function NotificationsPush() {
  const { etat } = useSession();
  const session = etat.phase === "prete" ? etat.session : null;

  // `Notification.permission` n'est pas lisible au rendu serveur : l'état arrive après
  // le montage, comme le thème (M-A).
  const [permission, setPermission] = useState<keyof typeof ETATS>("indisponible");
  const [enCours, setEnCours] = useState(false);

  useEffect(() => setPermission(permissionPush()), []);

  const activer = async () => {
    if (!session) return;
    setEnCours(true);
    try {
      await abonnerAuxNotifications(session).catch(() => false);
    } finally {
      setPermission(permissionPush());
      setEnCours(false);
    }
  };

  const decrit = ETATS[permission];

  return (
    <div style={{ display: "grid", gap: "var(--spacing-2)" }}>
      <Text type="body" weight="bold" as="h2">
        {decrit.titre}
      </Text>
      <Text type="supporting" color="secondary">
        {decrit.texte}
      </Text>
      {permission === "default" && (
        <Button
          label={ETATS.default.action}
          variant="primary"
          isLoading={enCours}
          onClick={() => void activer()}
        />
      )}
    </div>
  );
}
