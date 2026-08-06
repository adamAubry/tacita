"use client";

import type { Session } from "@tacita/client-core";
import { useCallback, useEffect, useState } from "react";

import {
  liensDeLaSession,
  urlDInvitation,
  type LienActif,
  type LiensInvitation,
} from "../../lib/liens-invitation";
import { Banner, Button, List, ListItem, Text } from "../foundation/primitives";

export interface LienInvitationProps {
  session: Session;
  roomId: string;
  /** Injecté en test : le service est une API HTTP, pas un paquet importable. */
  liens?: LiensInvitation;
  origine?: string;
}

const dateLisible = (ms: number) => new Date(ms).toLocaleString();

/**
 * REQ-UIX-34 / spec 12 — les liens d'invitation d'un groupe : émettre, voir l'expiration,
 * révoquer.
 *
 * **La limite est écrite au-dessus du bouton, pas en bas de page** (interdit n°13,
 * REQ-INV-15 amendée) : le service de liens n'a aucun pouvoir Matrix, il ne peut donc pas
 * voir que l'émetteur a quitté le groupe. Un lien émis reste résolvable après un départ,
 * et c'est l'invitation qui échoue ensuite. Ça se dit avant d'émettre.
 *
 * Le token n'est lisible **qu'à l'émission** — le service le stocke haché (REQ-INV-02).
 * La liste des liens actifs ne peut donc montrer que leur identifiant et leur échéance ;
 * un lien qu'on n'a pas copié tout de suite se révoque et se réémet.
 */
export function LienInvitation({
  session,
  roomId,
  liens,
  origine = globalThis.location?.origin ?? "",
}: LienInvitationProps) {
  const [service] = useState<LiensInvitation>(() => liens ?? liensDeLaSession(session));
  const [actifs, setActifs] = useState<LienActif[] | null>(null);
  const [emis, setEmis] = useState<string | undefined>();
  const [indisponible, setIndisponible] = useState(false);

  const rafraichir = useCallback(() => {
    void service
      .lister()
      .then(setActifs)
      .catch(() => {
        setActifs([]);
        setIndisponible(true);
      });
  }, [service]);

  useEffect(rafraichir, [rafraichir]);

  return (
    <div style={{ display: "grid", gap: "var(--spacing-3)", padding: "var(--spacing-3)" }}>
      <Banner
        status="warning"
        title="Un lien de groupe ne garantit pas que le groupe reste joignable"
        description="Le service qui émet les liens n'a aucun droit sur les salons : il ne peut pas voir que vous avez quitté ce groupe. Le lien resterait valide, et l'invitation échouerait."
      />

      <Button
        label="Créer un lien d'invitation"
        onClick={() => {
          setIndisponible(false);
          void service
            .emettreGroupe(roomId)
            .then(({ token }) => {
              setEmis(urlDInvitation(origine, token));
              rafraichir();
            })
            .catch(() => setIndisponible(true));
        }}
      />

      {emis && (
        <div style={{ display: "grid", gap: "var(--spacing-1)" }}>
          <Text type="label">Lien créé — copiez-le maintenant</Text>
          <Text type="code" color="secondary">
            {emis}
          </Text>
          <Button
            label="Copier le lien"
            variant="secondary"
            onClick={() => void navigator.clipboard?.writeText(emis)}
          />
          <Text type="supporting" color="secondary">
            Il ne sera plus affiché : le service ne conserve pas le lien lui-même, seulement
            de quoi le vérifier.
          </Text>
        </div>
      )}

      {indisponible && (
        <Text type="supporting" color="secondary">
          Le service de liens ne répond pas. Vous pouvez toujours inviter quelqu'un par son
          identifiant Matrix — cela ne passe pas par lui.
        </Text>
      )}

      {actifs !== null && actifs.length > 0 && (
        <List>
          {actifs.map((lien) => (
            <ListItem
              key={lien.id}
              label={lien.kind === "group" ? "Lien de groupe" : "Lien d'ami"}
              description={`Expire le ${dateLisible(lien.expiresAt)} · ${lien.usesLeft} usage(s) restant(s)`}
              endContent={
                <Button
                  label="Révoquer"
                  variant="ghost"
                  onClick={() => {
                    void service
                      .revoquer(lien.id)
                      .then(rafraichir)
                      .catch(() => setIndisponible(true));
                  }}
                />
              }
              style={{ minHeight: 44 }}
            />
          ))}
        </List>
      )}
    </div>
  );
}
