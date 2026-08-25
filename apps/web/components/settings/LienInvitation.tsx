"use client";

import type { Session } from "@tacita/client-core";
import { joinRule, setJoinRule } from "@tacita/messaging";
import { useCallback, useEffect, useState } from "react";

import {
  liensDeLaSession,
  urlDInvitation,
  type LienActif,
  type LiensInvitation,
} from "../../lib/liens-invitation";
import { Banner, Button, List, ListItem, Text } from "../foundation/primitives";

interface LienInvitationProps {
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
 * **Le sas d'entrée suit le cycle de vie des liens** (E-13, voie A). Un lien de groupe ne
 * peut pas faire entrer tout seul : son porteur ne peut ni s'inviter ni rejoindre un
 * salon en `join_rule: invite`. Le salon passe donc en `knock` **à l'émission du premier
 * lien actif** et revient à `invite` **à la révocation du dernier** — pas de knock
 * permanent sur tous les groupes, et pas de porte qui reste entrouverte après coup.
 *
 * La bascule est ici et non dans `createGroupChat` (spec 05 inchangée par défaut) parce
 * que c'est ici qu'on sait combien de liens sont actifs. Elle est **idempotente** : on ne
 * réécrit l'état que s'il diffère, un `m.room.join_rules` inutile étant un événement de
 * plus dans un salon partagé.
 *
 * **La limite est écrite au-dessus du bouton, pas en bas de page** (interdit n°13,
 * REQ-INV-15 amendée) : le service de liens n'a aucun pouvoir Matrix, il ne peut donc pas
 * voir que l'émetteur a quitté le groupe. Depuis E-13 la conséquence a changé de nature —
 * le porteur frappe, et ce sont **les membres restants** qui confirment. Un lien dont
 * l'émetteur est parti n'est plus une impasse tant qu'il reste quelqu'un dans le groupe.
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
  /** La bascule refusée par le serveur, s'il l'a refusée : `undefined` = tout va bien. */
  const [sasRefuse, setSasRefuse] = useState<"knock" | "invite" | undefined>();

  /**
   * Le sas suit le nombre de liens actifs, et rien d'autre. Aligné à chaque
   * rafraîchissement plutôt qu'aux seuls gestes d'émission et de révocation : un lien
   * peut expirer tout seul, et personne n'est là pour refermer la porte ce jour-là.
   */
  const alignerSas = useCallback(
    (liens: LienActif[]) => {
      const voulue = liens.some((lien) => lien.kind === "group") ? "knock" : "invite";
      if (joinRule(session, roomId) === voulue) return;

      // **Un échec ne se tait pas** (interdit n°13). Basculer `join_rules` exige le
      // power level d'état : un membre ordinaire peut créer un lien et voir la bascule
      // refusée. Son lien serait alors parfaitement valide et ne ferait entrer personne
      // — exactement le genre de promesse silencieuse que l'escalade E-13 a corrigée.
      // Ni réessai ni rattrapage : le droit ne s'obtient pas en insistant, il se demande
      // à quelqu'un. On le dit, c'est tout ce qu'on peut faire d'utile.
      void setJoinRule(session, roomId, voulue).catch(() => setSasRefuse(voulue));
    },
    [session, roomId],
  );

  const rafraichir = useCallback(() => {
    void service
      .lister()
      .then((liens) => {
        setActifs(liens);
        alignerSas(liens);
      })
      .catch(() => {
        setActifs([]);
        setIndisponible(true);
      });
  }, [service, alignerSas]);

  useEffect(rafraichir, [rafraichir]);

  return (
    <div style={{ display: "grid", gap: "var(--spacing-3)", padding: "var(--spacing-3)" }}>
      {/* REQ-INV-15 — dit avant d'émettre, et dit ce qui se passe **vraiment** depuis
          E-13 : ce n'est plus « l'invitation échouera », c'est « un membre confirmera ». */}
      <Banner
        status="info"
        title="Avec un lien, on frappe à la porte"
        description="Le porteur du lien ne rejoint pas directement : sa demande s'affiche dans les informations du groupe, et n'importe quel membre la confirme. Tant qu'un lien est actif, le groupe accepte ces demandes ; il se referme dès la révocation du dernier."
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

      {sasRefuse === "knock" && (
        <Banner
          status="warning"
          title="Ce lien ne fera entrer personne"
          description="L'ouverture du groupe aux demandes d'entrée a été refusée : elle demande le droit de modifier les réglages du salon. Demandez à un administrateur du groupe de créer le lien, ou de vous donner ce droit."
        />
      )}

      {sasRefuse === "invite" && (
        <Banner
          status="warning"
          title="Le groupe accepte encore les demandes d'entrée"
          description="La fermeture a été refusée : elle demande le droit de modifier les réglages du salon. Les liens sont bien révoqués, mais quelqu'un qui a déjà frappé attend toujours."
        />
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
