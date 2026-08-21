"use client";

import type { Profile } from "@tacita/messaging";
import { useEffect, useState } from "react";

import { DEBOUNCE_MS } from "../../lib/recherche";
import { ButtonsList } from "../foundation/ButtonsList";
import { LayoutHeader } from "../foundation/LayoutHeader";
import { Placeholder } from "../foundation/Placeholder";
import { Button, Skeleton, Text, TextInput } from "../foundation/primitives";
import { Suggestions } from "./FriendsList";

export interface AjouterAmisProps {
  /**
   * REQ-MSG-19 — l'annuaire du homeserver, ouvert à tous les comptes locaux depuis E-21
   * (REQ-INF-18). Rien à voir avec l'interdit n°3, qui vise la recherche de **contenu**.
   */
  chercher: (terme: string) => Promise<Profile[]>;
  /** REQ-UIX-28 — crée puis partage un lien (spec 12). Rend ce qui s'est passé. */
  onPartagerLien: () => Promise<"partage" | "copie" | "annule">;
  onOuvrirProfil: (userId: string) => void;
}

/**
 * REQ-UIX-28 — Add-friends.
 *
 * Deux chemins, dans l'ordre où ils servent : partager un lien (on connaît déjà la
 * personne, hors de Tacita), puis la chercher dans l'annuaire (elle y est déjà).
 *
 * **Les suggestions serveur n'existent pas et l'écran le dit.** D-09 a refusé le graphe
 * social : il n'y a aucune source de données pour suggérer qui que ce soit. Un carrousel
 * vide « Suggestions » laisserait croire à une panne, et un carrousel rempli au hasard
 * serait pire.
 */
export function AjouterAmis({ chercher, onPartagerLien, onOuvrirProfil }: AjouterAmisProps) {
  const [terme, setTerme] = useState("");
  const [resultats, setResultats] = useState<Profile[] | null>(null);
  const [chargement, setChargement] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  // Débouncée (contrainte M-G) : l'annuaire est un appel réseau, une frappe ne le
  // déclenche pas. Même fenêtre que la recherche locale, pour que les deux se
  // ressemblent à l'usage.
  useEffect(() => {
    if (terme.trim().length === 0) {
      setResultats(null);
      setChargement(false);
      return;
    }

    let annule = false;
    setChargement(true);
    const minuteur = setTimeout(() => {
      void chercher(terme)
        .then((profils) => {
          if (!annule) {
            setResultats(profils);
            setChargement(false);
          }
        })
        .catch(() => {
          // L'annuaire peut être désactivé côté serveur : liste vide plutôt qu'écran
          // cassé, et le placeholder dira qu'on n'a rien trouvé.
          if (!annule) {
            setResultats([]);
            setChargement(false);
          }
        });
    }, DEBOUNCE_MS);

    return () => {
      annule = true;
      clearTimeout(minuteur);
    };
  }, [terme, chercher]);

  const partager = async () => {
    const issue = await onPartagerLien().catch(() => "echec" as const);
    setMessage(
      issue === "copie"
        ? "Lien copié. Il expire dans 24 heures."
        : issue === "echec"
          ? "Le lien n'a pas pu être créé. Réessayez."
          : null,
    );
  };

  return (
    <>
      <LayoutHeader titre="Ajouter" />

      <ButtonsList
        boutons={[
          {
            cle: "lien",
            libelle: "Partager un lien d'invitation",
            description: "Valable 24 heures, une seule utilisation.",
            onClick: () => void partager(),
          },
        ]}
      />
      {/* `role="status"` : le retour du partage arrive après une action, et doit être
          annoncé sans voler le focus. */}
      {message && (
        <div role="status" style={{ padding: "0 var(--spacing-3)" }}>
          <Text type="supporting" color="secondary">
            {message}
          </Text>
        </div>
      )}

      <div style={{ display: "grid", gap: "var(--spacing-2)", padding: "var(--spacing-3)" }}>
        {/* REQ-UIX-28 — « par identifiant » n'est plus le seul chemin depuis que
            l'annuaire couvre tout le serveur (REQ-INF-18, E-21) : le libellé le dit,
            sans quoi personne n'essaierait un prénom. REQ-UIX-42 — le domaine, lui, ne
            se tape plus : `identifiantComplet` le remet. */}
        <TextInput
          label="Rechercher par nom ou identifiant"
          value={terme}
          onChange={setTerme}
          placeholder="mira, ou @mira"
        />
        {/* Interdit n°13, pris par les deux bouts : ce que la recherche trouve, et ce
            qu'elle expose. L'annuaire est réciproque — le dire ici est la seule place où
            l'utilisateur peut l'apprendre au moment où ça le concerne. */}
        <Text type="supporting" color="secondary">
          Les comptes de ce serveur sont trouvables par leur nom ou leur identifiant, sans
          le domaine — y compris le vôtre.
        </Text>
      </div>

      {chargement && (
        <div
          aria-label="Recherche en cours"
          aria-busy="true"
          style={{ display: "grid", gap: "var(--spacing-2)", padding: "var(--spacing-3)" }}
        >
          {[0, 1].map((rang) => (
            <Skeleton key={rang} height={56} />
          ))}
        </div>
      )}

      {!chargement && resultats !== null && resultats.length === 0 && (
        <Placeholder
          titre="Personne à ce nom"
          explication="Vérifiez l'orthographe, ou partagez plutôt un lien d'invitation."
        />
      )}

      {!chargement && resultats !== null && resultats.length > 0 && (
        <Suggestions profils={resultats} onOuvrirProfil={onOuvrirProfil} />
      )}

      {resultats === null && !chargement && (
        <Placeholder
          titre="Aucune suggestion"
          explication="Tacita ne construit pas de graphe social : personne ne peut vous suggérer qui ajouter. Partagez un lien, ou cherchez un nom."
          action={<Button label="Partager un lien" onClick={() => void partager()} />}
        />
      )}
    </>
  );
}
