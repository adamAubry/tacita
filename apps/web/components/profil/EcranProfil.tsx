"use client";

import {
  conversations,
  getPinnedEvents,
  messages as listerMessages,
  profileOf,
  updateProfile,
  type Profile,
} from "@tacita/messaging";
import { uploadPublicProfileImage } from "@tacita/media-pipeline";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { routeAppel, routeConversation } from "../../lib/routes";
import { contactsDeLaSession } from "../../lib/contacts";
import { enregistrerWipeNotes } from "../../lib/notes";
import { ConversationCollections } from "../media/ConversationCollections";
import { useMediaActions } from "../media/useMediaActions";
import { VStack } from "../foundation/primitives";
import { LogoutButton } from "../onboarding/LogoutButton";
import { useSession } from "../onboarding/SessionProvider";
import { ProfilAutrui, type ActionProfil } from "./ProfilAutrui";
import { ProfilMoi } from "./ProfilMoi";
import { Skeleton } from "../foundation/Skeleton";

/**
 * Le câblage des deux layouts Profile.
 *
 * La photo de profil et la bannière passent par le **même**
 * `onPhoto` : deux images publiques, une seule fonction de téléversement, donc un seul
 * site d'appel du chemin public — la condition de, vérifiée par un test
 * structurel du paquet média. `userId` absent = son propre profil.
 *
 * Les composants rendus ne connaissent ni `Session` ni les paquets : ils reçoivent un
 * `Profile`, des booléens et des callbacks. C'est ce qui rend M-G testable avec des
 * interfaces mockées, comme son objectif mesurable le demande.
 */
/**
 * **Un squelette, pas un état vide** (30/08/2026, revue de conception R-05). Ces trois
 * écrans rendaient un `<Placeholder>` — le composant d'état *vide* — pendant le
 * chargement : on lisait « Profil / Chargement… » en gros et centré, à la place de
 * l'écran, puis tout était remplacé. Trois défauts en un : le mauvais composant
 * sémantique, un saut de mise en page complet à l'arrivée des données, et une
 * contradiction avec la règle maison « pas de spinner plein écran : skeletons localisés »
 * — l'interdit visait le sablier, et c'est un état vide plein écran qui avait pris sa
 * place. La géométrie ci-dessous est celle du contenu final.
 */
export function EcranProfil({ userId }: { userId?: string }) {
  const { etat } = useSession();
  const router = useRouter();
  const session = etat.phase === "prete" ? etat.session : null;

  const [profil, setProfil] = useState<Profile | null>(null);
  // Un compteur plutôt qu'un booléen : accepter puis bloquer doit relire deux fois, et
  // un booléen bascule sans jamais revenir.
  const [revision, setRevision] = useState(0);

  const moi = session?.client.getUserId() ?? "";
  const cible = userId ?? moi;
  const estMoi = cible === moi;

  const contacts = useMemo(() => (session ? contactsDeLaSession(session) : null), [session]);
  const { env, telecharger, sauvegarder } = useMediaActions(session);

  useEffect(() => {
    if (session) enregistrerWipeNotes(session, globalThis.indexedDB);
  }, [session]);

  useEffect(() => {
    if (!session || !cible) return;
    let annule = false;
    void profileOf(session, cible).then((lu) => {
      if (!annule) setProfil(lu);
    });
    return () => {
      annule = true;
    };
  }, [session, cible, revision]);



  if (!session || !profil || !contacts) {
    return (
      <VStack gap={4} aria-label="Chargement du profil" aria-busy="true">
        {/* La bannière, l'avatar remonté dessus, puis les deux lignes d'identité. */}
        <Skeleton height={190} />
        <VStack gap={2} style={{ padding: "0 var(--spacing-3)" }}>
          <Skeleton width={180} height={28} />
          <Skeleton width={110} height={18} />
        </VStack>
      </VStack>
    );
  }

  if (estMoi) {
    return (
      <ProfilMoi
        profil={profil}
        onEnregistrer={async (changements) => {
          await updateProfile(session, changements);
          setRevision((rang) => rang + 1);
        }}
        // **l'unique site d'appel du chemin public**, dans tout le dépôt.
        // Un test structurel du paquet média balaie les sources et échoue s'il en
        // apparaît un second : c'est ce qui rend la phrase « tout ce qui sort du
        // pipeline est chiffré, sauf l'unique chemin nommé public » vérifiable.
        onPhoto={(fichier) => uploadPublicProfileImage(session, env, fichier)}
        // la déconnexion est **branchée ici et nulle part ailleurs** : c'est
        // le seul écran qui parle de « moi », et jusqu'à aujourd'hui `LogoutButton`
        // n'était rendu par aucun composant — testé, mais inatteignable.
        deconnexion={<LogoutButton session={session} />}
      />
    );
  }

  const dm = conversations(session).find((conversation) => conversation.peerId === cible);

  return (
    <ProfilAutrui
      profil={profil}
      estAmi={contacts.estAmi(cible)}
      bloque={contacts.bloque(cible)}
      indexedDB={globalThis.indexedDB}
      onMessage={() => {
        void contacts.inviter(cible).then((roomId) => router.push(routeConversation(roomId)));
      }}
      onAppel={() => {
        // **le même chemin que le header 1:1**, littéralement le même
        // constructeur de route. Passer par la conversation pour y cliquer une seconde
        // fois ferait deux gestes là où le bouton en promet un.
        if (dm) router.push(routeAppel(dm.roomId));
      }}
      onInviter={async () => {
        await contacts.inviter(cible);
        setRevision((rang) => rang + 1);
      }}
      onAction={async (action: ActionProfil) => {
        if (action === "bloquer") await contacts.bloquer(cible);
        else if (action === "debloquer") await contacts.debloquer(cible);
        else await contacts.retirer(cible);
        setRevision((rang) => rang + 1);
      }}
      activite={
        dm ? (
          <ConversationCollections
            evenements={listerMessages(session, dm.roomId)}
            epingles={getPinnedEvents(session, dm.roomId)}
            telecharger={telecharger}
            onSauvegarder={sauvegarder}
          />
        ) : undefined
      }
    />
  );
}
