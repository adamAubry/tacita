import type { ReactNode } from "react";

import { Navbar } from "../../components/foundation/Navbar";

/**
 * Les quatre onglets de la navbar partagent ce layout ; la conversation et les écrans
 * de pile n'en veulent pas (le geste attendu y est le retour, pas le changement
 * d'onglet). Un groupe de routes, plutôt qu'un `if` sur le chemin dans la navbar.
 *
 * Le `padding-bottom` réserve la hauteur de la navbar fixée : sans lui, le dernier
 * élément de chaque liste passe dessous et devient inatteignable. Depuis qu'elle flotte,
 * il faut réserver trois choses et non plus une : ses 60 px, les 12 px qui la décollent
 * du bas, et 12 px de plus pour que le contenu ne vienne pas se coller sous elle.
 */
export default function LayoutOnglets({ children }: { children: ReactNode }) {
  return (
    <>
      <main style={{ paddingBottom: "calc(60px + var(--spacing-3) * 2 + env(safe-area-inset-bottom, 0px))" }}>
        {children}
      </main>
      <Navbar />
    </>
  );
}
