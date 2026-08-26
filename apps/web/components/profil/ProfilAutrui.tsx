"use client";

import type { Profile } from "@tacita/messaging";
import { useState, type ReactNode } from "react";

import { ButtonsList } from "../foundation/ButtonsList";
import { IconeAppel } from "../foundation/icons";
import { Button, Icon, SegmentedControl, SegmentedControlItem, Text } from "../foundation/primitives";
import { Sheet } from "../foundation/Sheet";
import { Note } from "./Note";
import { ProfileCard } from "./ProfileCard";

/**
 * les textes de confirmation, sortis du JSX pour être lisibles d'un coup.
 *
 * **Ils disent l'effet réel, pas l'effet espéré** (interdit n°13) : bloquer
 * n'empêche personne d'écrire et ne prévient personne — le serveur cesse simplement de
 * nous envoyer ses messages. Promettre davantage serait dangereux : quelqu'un pourrait
 * s'en remettre à un blocage qui ne protège pas de ce qu'il croit.
 */
export const CONFIRMATIONS = {
  bloquer: {
    titre: "Bloquer cette personne ?",
    corps:
      "Ses messages ne s'afficheront plus chez vous. Elle n'en sera pas informée, pourra continuer à écrire, et restera membre des conversations de groupe que vous partagez.",
    action: "Bloquer",
  },
  debloquer: {
    titre: "Débloquer cette personne ?",
    corps: "Ses messages s'afficheront de nouveau, y compris ceux envoyés pendant le blocage.",
    action: "Débloquer",
  },
  retirer: {
    titre: "Retirer cette personne de vos amis ?",
    corps:
      "Vous quitterez votre conversation privée. Son historique ne vous sera plus accessible sur cet appareil, et elle verra que vous l'avez quittée.",
    action: "Retirer",
  },
} as const;

export type ActionProfil = keyof typeof CONFIRMATIONS;

interface ProfilAutruiProps {
  profil: Profile;
  /** **Vient de `Contacts`, jamais d'une heuristique locale** (contrainte M-G). */
  estAmi: boolean;
  bloque: boolean;
  indexedDB: IDBFactory;
  onMessage: () => void;
  onAppel: () => void;
  /** envoyer une demande (V1 : invitation de DM). */
  onInviter: () => Promise<void>;
  onAction: (action: ActionProfil) => Promise<void>;
  /** l'onglet Activity : `ConversationCollections` du DM partagé (M-E). */
  activite?: ReactNode;
}

/**
 * le profil de quelqu'un d'autre, dans ses deux états.
 *
 * **Un seul des deux s'affiche, jamais les deux** : ami → sélecteur Actions/Activity ;
 * non-ami → le grand bouton « Ajouter ». Proposer d'envoyer un message à quelqu'un avec
 * qui on n'a pas de conversation serait une action qui échoue, et afficher « Ajouter » à
 * un ami serait une action sans effet.
 *
 * La Note est **sous les deux** : on peut vouloir noter quelque chose sur quelqu'un qu'on
 * n'a pas encore ajouté — c'est même le cas le plus utile.
 */
export function ProfilAutrui({
  profil,
  estAmi,
  bloque,
  indexedDB,
  onMessage,
  onAppel,
  onInviter,
  onAction,
  activite,
}: ProfilAutruiProps) {
  const [onglet, setOnglet] = useState("actions");
  const [options, setOptions] = useState(false);
  const [confirmation, setConfirmation] = useState<ActionProfil | null>(null);
  const [enCours, setEnCours] = useState(false);

  const confirmer = async () => {
    if (!confirmation) return;
    setEnCours(true);
    try {
      await onAction(confirmation);
      setConfirmation(null);
    } finally {
      setEnCours(false);
    }
  };

  const texte = confirmation ? CONFIRMATIONS[confirmation] : null;

  return (
    <>
      <ProfileCard
        nom={profil.displayName}
        avatarUrl={profil.avatarUrl}
        bannerUrl={profil.bannerUrl}
        statut={bloque ? "bloque" : estAmi ? "ami" : "non-ami"}
        actions={
          <Button
            label="Options"
            variant="ghost"
            isIconOnly
            icon={<Icon icon="moreHorizontal" />}
            onClick={() => setOptions(true)}
          />
        }
      />

      {estAmi ? (
        <>
          <div style={{ padding: "0 var(--spacing-3)" }}>
            <SegmentedControl
              label="Actions ou activité"
              value={onglet}
              onChange={setOnglet}
              layout="fill"
            >
              <SegmentedControlItem value="actions" label="Actions" />
              <SegmentedControlItem value="activite" label="Activity" />
            </SegmentedControl>
          </div>

          {onglet === "actions" ? (
            // Composant 25 — deux actions, pas plus : écrire et appeler. Le reste est
            // dans les options, où on ne va pas par accident.
            <div
              style={{
                display: "flex",
                gap: "var(--spacing-3)",
                justifyContent: "center",
                padding: "var(--spacing-4)",
              }}
            >
              <Button label="Message" variant="primary" onClick={onMessage} />
              <Button label="Appel audio" variant="secondary" icon={IconeAppel} onClick={onAppel} />
            </div>
          ) : (
            <div style={{ padding: "var(--spacing-3)" }}>{activite}</div>
          )}
        </>
      ) : (
        // Composant 26 — un seul grand bouton. C'est la seule chose à faire ici.
        <div
          style={{ display: "grid", justifyItems: "center", gap: "var(--spacing-2)", padding: "var(--spacing-4)" }}
        >
          <Button
            label="Ajouter"
            variant="primary"
            size="lg"
            onClick={() => void onInviter()}
          />
          <Text type="supporting" color="secondary">
            Une invitation lui sera envoyée. Vous pourrez vous écrire dès qu&apos;elle l&apos;aura
            acceptée.
          </Text>
        </div>
      )}

      <Note userId={profil.userId} indexedDB={indexedDB} />

      <Sheet
        ouvert={options}
        onFermer={() => setOptions(false)}
        nom={`Options concernant ${profil.displayName}`}
      >
        <ButtonsList
          boutons={[
            ...(estAmi
              ? [
                  {
                    cle: "retirer",
                    libelle: "Retirer des amis",
                    destructif: true,
                    onClick: () => {
                      setOptions(false);
                      setConfirmation("retirer");
                    },
                  },
                ]
              : []),
            {
              cle: "blocage",
              libelle: bloque ? "Débloquer" : "Bloquer",
              destructif: !bloque,
              onClick: () => {
                setOptions(false);
                setConfirmation(bloque ? "debloquer" : "bloquer");
              },
            },
          ]}
        />
      </Sheet>

      {/* DESIGN.md n'autorise la modale d'interruption que pour le destructif — c'est
          exactement le cas : quitter un DM perd son historique local. */}
      <Sheet
        ouvert={confirmation !== null}
        onFermer={() => setConfirmation(null)}
        ancrage="centre"
        titre={texte?.titre ?? "Confirmation"}
      >
        {texte && (
          <div style={{ display: "grid", gap: "var(--spacing-3)", padding: "var(--spacing-4)" }}>
            <Text type="body" color="secondary">
              {texte.corps}
            </Text>
            <div style={{ display: "flex", gap: "var(--spacing-2)", justifyContent: "flex-end" }}>
              <Button label="Annuler" variant="ghost" onClick={() => setConfirmation(null)} />
              <Button
                label={texte.action}
                variant={confirmation === "debloquer" ? "primary" : "destructive"}
                isLoading={enCours}
                onClick={() => void confirmer()}
              />
            </div>
          </div>
        )}
      </Sheet>
    </>
  );
}
