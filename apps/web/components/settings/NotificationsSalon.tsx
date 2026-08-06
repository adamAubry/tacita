"use client";

import type { Session } from "@tacita/client-core";
import {
  roomNotificationLevel,
  setRoomNotificationLevel,
  type RoomNotificationLevel,
} from "@tacita/messaging";
import { useState } from "react";

import { RadioList, RadioListItem, Text } from "../foundation/primitives";

/**
 * REQ-UIX-36 — les trois niveaux, avec ce que chacun fait réellement. Les libellés du
 * wireframe seuls (« silencieux », « mentions uniquement », « tout ») laissent croire
 * que « silencieux » épargne les mentions ; la description dit que non.
 */
export const NIVEAUX: { valeur: RoomNotificationLevel; libelle: string; effet: string }[] = [
  { valeur: "all", libelle: "Tout", effet: "Chaque message notifie." },
  {
    valeur: "mentions",
    libelle: "Mentions uniquement",
    effet: "Seuls les messages qui vous nomment, ou qui nomment tout le groupe, notifient.",
  },
  {
    valeur: "mute",
    libelle: "Silencieux",
    effet: "Rien ne notifie, mentions comprises. La conversation reste dans la liste.",
  },
];

export const libelleNiveau = (niveau: RoomNotificationLevel) =>
  NIVEAUX.find((entree) => entree.valeur === niveau)!.libelle;

export interface NotificationsSalonProps {
  session: Session;
  roomId: string;
  /** Remonté au parent, qui affiche le niveau courant sous l'option (REQ-UIX-36). */
  onChange?: (niveau: RoomNotificationLevel) => void;
}

/**
 * REQ-UIX-36 — le niveau de notification d'un salon.
 *
 * Rien n'est stocké ici : le niveau **est** l'état des push rules du compte, lu au
 * montage et réécrit au choix. Une mémoire locale à côté finirait par diverger du
 * serveur, qui est celui qui décide de réveiller le téléphone.
 *
 * La bascule est optimiste, et **revient en arrière si l'écriture échoue** : un réglage
 * qui reste affiché alors que le serveur l'a refusé est une promesse non tenue.
 */
export function NotificationsSalon({ session, roomId, onChange }: NotificationsSalonProps) {
  const [niveau, setNiveau] = useState<RoomNotificationLevel>(() =>
    roomNotificationLevel(session, roomId),
  );
  const [echec, setEchec] = useState(false);

  const choisir = (suivant: RoomNotificationLevel) => {
    const precedent = niveau;
    setNiveau(suivant);
    setEchec(false);
    onChange?.(suivant);

    void setRoomNotificationLevel(session, roomId, suivant).catch(() => {
      setNiveau(precedent);
      onChange?.(precedent);
      setEchec(true);
    });
  };

  return (
    <div style={{ display: "grid", gap: "var(--spacing-2)", padding: "var(--spacing-3)" }}>
      <RadioList
        label="Notifications de cette conversation"
        value={niveau}
        onChange={(valeur) => choisir(valeur as RoomNotificationLevel)}
      >
        {NIVEAUX.map(({ valeur, libelle, effet }) => (
          <RadioListItem key={valeur} value={valeur} label={libelle} description={effet} />
        ))}
      </RadioList>

      {echec && (
        <Text type="supporting" color="secondary">
          Le réglage n'a pas pu être enregistré. Il vit sur votre compte, pas sur cet
          appareil : réessayez quand la connexion sera revenue.
        </Text>
      )}
    </div>
  );
}
