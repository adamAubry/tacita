"use client";

import { useEffect } from "react";

import { brancherNotifications } from "../../lib/notifications";
import { useSession } from "../onboarding/SessionProvider";

/**
 * REQ-UI-18 — branche la réponse aux demandes du service worker, une fois pour l'onglet.
 *
 * Monté au-dessus des routes plutôt que dans un écran : un push peut réveiller le worker
 * pendant qu'on est n'importe où dans l'app, y compris sur les réglages.
 */
export function PontNotifications() {
  const { etat } = useSession();
  const session = etat.phase === "prete" ? etat.session : null;

  useEffect(() => (session ? brancherNotifications(session) : undefined), [session]);

  return null;
}
