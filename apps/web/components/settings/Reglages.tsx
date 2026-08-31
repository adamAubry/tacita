"use client";

import type { Session } from "@tacita/client-core";
import {
  conversations as listerConversations,
  roomNotificationLevel,
  type RoomNotificationLevel,
} from "@tacita/messaging";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { useModeTheme } from "../../app/providers";
import { ButtonsList } from "../foundation/ButtonsList";
import { LayoutHeader } from "../foundation/LayoutHeader";
import { Placeholder } from "../foundation/Placeholder";
import { Sheet } from "../foundation/Sheet";
import { RadioList, RadioListItem, Text, type ThemeMode } from "../foundation/primitives";
import { useSession } from "../onboarding/SessionProvider";
import { Confidentialite } from "./Confidentialite";
import { LimitesConnues } from "./LimitesConnues";
import { NotificationsGlobales } from "./NotificationsGlobales";
import { libelleNiveau } from "./NotificationsSalon";
import { SettingsProfileCard } from "./SettingsProfileCard";
import { StockageLocal } from "./StockageLocal";

/** Les cinq options de REQ-UIX-31. Chacune ouvre une modal, aucune ne navigue. */
type Option = "theme" | "confidentialite" | "notifications" | "stockage" | "limites";

const TITRES: Record<Option, string> = {
  theme: "Apparence",
  confidentialite: "Confidentialité",
  notifications: "Notifications",
  stockage: "Stockage local",
  limites: "Limites connues",
};

/** REQ-UI-03 — les trois modes du mécanisme Astryx, dans l'ordre du plus passif. */
const MODES: { valeur: ThemeMode; libelle: string; effet: string }[] = [
  { valeur: "system", libelle: "Comme le système", effet: "Suit le réglage de votre appareil." },
  { valeur: "light", libelle: "Clair", effet: "Le thème de référence de Tacita." },
  { valeur: "dark", libelle: "Sombre", effet: "Les mêmes couleurs, en sombre." },
];

/**
 * Layout Settings (REQ-UIX-31) — la carte de profil, puis les options.
 *
 * Chaque option ouvre une modal plutôt qu'un écran : ce sont des réglages qu'on pose et
 * qu'on quitte, pas des destinations. Seule la carte de profil navigue, parce qu'elle
 * mène à un écran qui a sa propre vie (M-G).
 *
 * Le shard ne calcule rien ici non plus : le thème vient du provider de M-A, le mode
 * masqué du service d'accusés (spec 06), les niveaux de notification des push rules
 * natives (spec 05).
 */
export function Reglages() {
  const { etat } = useSession();
  const router = useRouter();
  const { mode, changerMode } = useModeTheme();
  const session: Session | null = etat.phase === "prete" ? etat.session : null;

  const [ouverte, setOuverte] = useState<Option | undefined>();

  const identifiant = session?.client.getUserId() ?? "";
  // Le nom d'affichage quand le SDK le connaît, sinon le pseudo tiré de l'identifiant.
  // Aucune requête : cet écran ne doit pas attendre le réseau pour se rendre.
  const nom = session?.client.getUser(identifiant)?.displayName ?? identifiant.split(":")[0]?.slice(1) ?? "";

  /**
   * REQ-UIX-36 — les conversations dont le niveau n'est pas « tout ». C'est le réglage
   * par salon ; l'abonnement global au-dessus vient de M-I (REQ-UI-18).
   */
  const filtrees = useMemo(() => {
    if (!session) return [] as { roomId: string; name: string; niveau: RoomNotificationLevel }[];
    return listerConversations(session)
      .map((conversation) => ({
        roomId: conversation.roomId,
        name: conversation.name,
        niveau: roomNotificationLevel(session, conversation.roomId),
      }))
      .filter((conversation) => conversation.niveau !== "all");
    // `ouverte` est la dépendance qui compte : la liste se relit à l'ouverture de la
    // modal, pas à chaque rendu. Interroger les push rules en continu n'apprendrait rien
    // — elles ne changent que depuis un autre écran.
  }, [session, ouverte]);

  return (
    <>
      <LayoutHeader titre="Réglages" />

      <div style={{ display: "grid", gap: "var(--spacing-3)", padding: "var(--spacing-3)" }}>
        <SettingsProfileCard
          nom={nom}
          identifiant={identifiant}
          onOuvrir={() => router.push("/profil")}
        />

        <ButtonsList
          boutons={(Object.keys(TITRES) as Option[]).map((option) => ({
            cle: option,
            libelle: TITRES[option],
            onClick: () => setOuverte(option),
          }))}
        />
      </div>

      <Sheet
        ouvert={ouverte !== undefined}
        onFermer={() => setOuverte(undefined)}
        titre={ouverte ? TITRES[ouverte] : ""}
      >
        {ouverte === "theme" && (
          <div style={{ padding: "var(--spacing-3)" }}>
            <RadioList
              label="Thème"
              value={mode}
              onChange={(valeur) => changerMode(valeur as ThemeMode)}
            >
              {MODES.map(({ valeur, libelle, effet }) => (
                <RadioListItem key={valeur} value={valeur} label={libelle} description={effet} />
              ))}
            </RadioList>
          </div>
        )}

        {ouverte === "confidentialite" && <Confidentialite />}

        {ouverte === "notifications" && (
          <div style={{ display: "grid", gap: "var(--spacing-2)", padding: "var(--spacing-3)" }}>
            {/* REQ-UI-18 — l'abonnement global, livré par M-I. C'est aussi ici que se
                rattrape un refus de permission : nulle part ailleurs on ne peut le voir. */}
            <NotificationsGlobales session={session} />

            <Text type="supporting" color="secondary">
              Les notifications se règlent conversation par conversation, depuis ses
              informations. Voici celles qui ne sont pas au niveau « Tout ».
            </Text>

            {filtrees.length === 0 ? (
              <Placeholder
                titre="Aucune conversation en silence"
                explication="Ouvrez les informations d'une conversation pour changer son niveau."
              />
            ) : (
              <ButtonsList
                boutons={filtrees.map((conversation) => ({
                  cle: conversation.roomId,
                  libelle: conversation.name,
                  description: libelleNiveau(conversation.niveau),
                  onClick: () => router.push(`/c/${conversation.roomId}/infos`),
                }))}
              />
            )}
          </div>
        )}

        {ouverte === "stockage" && <StockageLocal />}
        {ouverte === "limites" && <LimitesConnues />}
      </Sheet>
    </>
  );
}
