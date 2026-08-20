"use client";

import type { Session } from "@tacita/client-core";
import {
  conversations as listerConversations,
  createGroupChat,
  getPinnedEvents,
  invite,
  memberCount,
  messages as listerMessages,
  roomNotificationLevel,
  type RoomNotificationLevel,
} from "@tacita/messaging";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { contactsDeLaSession } from "../../lib/contacts";
import { NewConversationSheet } from "../accueil/NewConversationSheet";
import { ConversationAvatar } from "../foundation/ConversationAvatar";
import { LayoutHeader } from "../foundation/LayoutHeader";
import {
  IconeAjouterMembre,
  IconeMuet,
  IconeOptions,
  IconeProfil,
  IconeRecherche,
} from "../foundation/icons";
import { Sheet } from "../foundation/Sheet";
import { Button, Text, TextInput } from "../foundation/primitives";
import { ConversationCollections } from "../media/ConversationCollections";
import { useMediaActions } from "../media/useMediaActions";
import { useSession } from "../onboarding/SessionProvider";
import { InfoButtons } from "./InfoButtons";
import { LienInvitation } from "./LienInvitation";
import { MembresGroupe } from "./MembresGroupe";
import { NotificationsSalon, libelleNiveau } from "./NotificationsSalon";
import { OptionsConversation, type OptionConversation } from "./OptionsConversation";
import { ThemeConversation } from "./ThemeConversation";
import { routeConversation } from "../../lib/routes";

/** Ce qui peut être ouvert par-dessus l'écran : une option, ou le panneau « muter ». */
type Panneau = OptionConversation | "notifications" | "ajouter";

/** Le bouton « Options » amène à la section, qui est sur le même écran. */
const ANCRE_OPTIONS = "options-conversation";

const TITRES: Record<Panneau, string> = {
  theme: "Thème de la conversation",
  notifications: "Notifications",
  groupe: "Nouveau groupe",
  lien: "Lien d'invitation",
  membres: "Membres",
  ajouter: "Ajouter un membre",
};

/**
 * Layout Conversation info (REQ-UIX-33, 34, 37) — une seule implémentation pour les deux
 * variantes.
 *
 * Ce qui distingue le 1:1 du groupe tient en deux listes : le jeu d'Info buttons et le
 * jeu d'Options. Tout le reste — en-tête, galeries, panneaux — est identique, comme
 * REQ-UIX-37 l'exige. Deux composants auraient dérivé au premier changement d'un côté.
 */
export function InfosConversation({ roomId }: { roomId: string }) {
  const { etat } = useSession();
  const router = useRouter();
  const session: Session | null = etat.phase === "prete" ? etat.session : null;

  const [panneau, setPanneau] = useState<Panneau | undefined>();
  const [niveau, setNiveau] = useState<RoomNotificationLevel>("all");
  const [version, setVersion] = useState(0);

  const salon = useMemo(
    () => (session ? listerConversations(session).find((c) => c.roomId === roomId) : undefined),
    [session, roomId, version],
  );

  // Le niveau réel est lu à l'arrivée de la session, puis suivi par le panneau qui
  // l'écrit : le relire à chaque rendu interrogerait les push rules pour rien.
  useEffect(() => {
    if (session) setNiveau(roomNotificationLevel(session, roomId));
  }, [session, roomId]);

  const { telecharger, sauvegarder } = useMediaActions(session);

  const direct = salon?.direct ?? false;
  const nom = salon?.name ?? "Conversation";

  const rechercher = () => router.push(`/recherche?salon=${encodeURIComponent(roomId)}`);

  /** REQ-UIX-33 — quatre boutons, et le premier change avec la variante. */
  const boutons = [
    direct
      ? {
          cle: "profil",
          libelle: "Profil",
          icone: IconeProfil,
          onClick: () => router.push(`/profil/${encodeURIComponent(salon?.peerId ?? "")}`),
        }
      : {
          cle: "ajouter",
          libelle: "Ajouter",
          icone: IconeAjouterMembre,
          onClick: () => setPanneau("ajouter"),
        },
    { cle: "rechercher", libelle: "Rechercher", icone: IconeRecherche, onClick: rechercher },
    {
      cle: "muter",
      libelle: "Muter",
      icone: IconeMuet,
      onClick: () => setPanneau("notifications"),
    },
    {
      cle: "options",
      libelle: "Options",
      icone: IconeOptions,
      // Les options sont **déjà sur cet écran**, plus bas : le bouton y amène, il
      // n'ouvre pas une modal de plus. Ouvrir arbitrairement la première (le thème)
      // sous le libellé « Options » serait un bouton qui ment sur sa destination.
      onClick: () =>
        document.getElementById(ANCRE_OPTIONS)?.scrollIntoView?.({ block: "start" }),
    },
  ];

  const contacts = useMemo(
    () => (session ? contactsDeLaSession(session).lister() : []),
    [session, version],
  );

  return (
    <>
      <LayoutHeader titre="Informations" />

      <div
        style={{
          display: "grid",
          justifyItems: "center",
          gap: "var(--spacing-2)",
          padding: "var(--spacing-4)",
        }}
      >
        <ConversationAvatar nom={nom} direct={direct} taille={48} />
        <Text type="display-3" as="h1">
          {nom}
        </Text>
        {/* REQ-UI-05 / REQ-MSG-11 — le compteur de membres, dans l'info groupe. */}
        <Text type="supporting" color="secondary" hasTabularNumbers>
          {direct
            ? (salon?.peerId ?? "")
            : `${session ? memberCount(session, roomId) : 0} membres`}
        </Text>
      </div>

      <InfoButtons boutons={boutons} />

      <div id={ANCRE_OPTIONS}>
        <OptionsConversation
          direct={direct}
          niveauLibelle={libelleNiveau(niveau)}
          onOuvrir={setPanneau}
        />
      </div>

      {/* REQ-UIX-37 — dernière section, identique dans les deux variantes. */}
      <div style={{ padding: "var(--spacing-3)" }}>
        <ConversationCollections
          evenements={session ? listerMessages(session, roomId) : []}
          epingles={session ? getPinnedEvents(session, roomId) : []}
          telecharger={telecharger}
          onSauvegarder={sauvegarder}
        />
      </div>

      {/* La création de groupe réutilise la feuille de M-C, pré-armée sur cette
          personne : REQ-UIX-34 demande « avec cette personne (+ autres) », donc la
          sélection de départ est une prop, pas un second composant. */}
      <NewConversationSheet
        ouvert={panneau === "groupe"}
        onFermer={() => setPanneau(undefined)}
        contacts={contacts}
        etapeInitiale="groupe"
        selectionInitiale={salon?.peerId ? [salon.peerId] : []}
        // La feuille propose aussi « nouvelle conversation » ; depuis ici, elle s'ouvre
        // directement sur l'étape groupe, et ce chemin n'est pas atteignable.
        onConversation={() => setPanneau(undefined)}
        onGroupe={(nomGroupe, membres) => {
          if (session) {
            void createGroupChat(session, nomGroupe, membres).then(({ room_id }) =>
              router.push(routeConversation(room_id)),
            );
          }
        }}
      />

      <Sheet
        ouvert={panneau !== undefined && panneau !== "groupe"}
        onFermer={() => setPanneau(undefined)}
        titre={panneau && panneau !== "groupe" ? TITRES[panneau] : ""}
      >
        {panneau === "theme" && (
          <ThemeConversation roomId={roomId} onApplique={() => setVersion((t) => t + 1)} />
        )}

        {panneau === "notifications" && session && (
          <NotificationsSalon session={session} roomId={roomId} onChange={setNiveau} />
        )}

        {panneau === "membres" && session && <MembresGroupe session={session} roomId={roomId} />}

        {panneau === "lien" && session && <LienInvitation session={session} roomId={roomId} />}

        {panneau === "ajouter" && session && (
          <AjouterMembre
            onInviter={(userId) => {
              void invite(session, roomId, userId).then(() => {
                setPanneau(undefined);
                setVersion((t) => t + 1);
              });
            }}
          />
        )}
      </Sheet>
    </>
  );
}

/**
 * REQ-UIX-33 — « ajouter un membre » : par identifiant Matrix, le chemin natif de D-09.
 * Il **ne passe pas par le service de liens** (REQ-INV-16) — un service indisponible ne
 * doit jamais empêcher d'ajouter quelqu'un.
 */
function AjouterMembre({ onInviter }: { onInviter: (userId: string) => void }) {
  const [identifiant, setIdentifiant] = useState("");
  // La forme d'un identifiant Matrix, et rien de plus : le serveur reste seul juge de
  // son existence. Une validation plus fine ici inventerait une règle qu'il n'a pas.
  const plausible = /^@[^:\s]+:[^\s]+$/.test(identifiant.trim());

  return (
    <div style={{ display: "grid", gap: "var(--spacing-3)", padding: "var(--spacing-3)" }}>
      <TextInput
        label="Identifiant Matrix"
        placeholder="@quelquun:tacita.test"
        value={identifiant}
        onChange={setIdentifiant}
      />
      <Text type="supporting" color="secondary">
        L'invitation part directement, sans passer par le service de liens.
      </Text>
      <Button
        label="Inviter"
        isDisabled={!plausible}
        tooltip="Un identifiant Matrix ressemble à @quelquun:tacita.test."
        onClick={() => onInviter(identifiant.trim())}
      />
    </div>
  );
}
