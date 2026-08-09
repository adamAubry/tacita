"use client";

import {
  conversations,
  getPinnedEvents,
  messages as listerMessages,
  profileOf,
  updateProfile,
  type Profile,
} from "@tacita/messaging";
import { downloadAttachment, uploadPublicProfileImage } from "@tacita/media-pipeline";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { routeAppel, routeConversation } from "../../lib/routes";
import { contactsDeLaSession } from "../../lib/contacts";
import { environnementMedia } from "../../lib/media-env";
import { enregistrerWipeNotes } from "../../lib/notes";
import { ConversationCollections } from "../media/ConversationCollections";
import { Placeholder } from "../foundation/Placeholder";
import { useSession } from "../onboarding/SessionProvider";
import { ProfilAutrui, type ActionProfil } from "./ProfilAutrui";
import { ProfilMoi } from "./ProfilMoi";

/**
 * Le câblage des deux layouts Profile.
 *
 * **La photo de profil de REQ-UI-20 n'est pas ici, et c'est délibéré** — voir
 * `ESCALATIONS` § E-12 : le pipeline chiffre tout, alors qu'un avatar Matrix doit être
 * public pour être affichable. Le champ est **absent** du formulaire plutôt que grisé
 * ou cassé, comme M-E l'a fait pour le vocal. `userId` absent = son propre profil.
 *
 * Les composants rendus ne connaissent ni `Session` ni les paquets : ils reçoivent un
 * `Profile`, des booléens et des callbacks. C'est ce qui rend M-G testable avec des
 * interfaces mockées, comme son objectif mesurable le demande.
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
  const env = useMemo(() => environnementMedia(), []);

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

  const telecharger = useCallback(
    async (fichier: Parameters<typeof downloadAttachment>[2], mimeType?: string) => {
      if (!session) throw new Error("session absente : aucun média déchiffrable");
      const octets = await downloadAttachment(session, env, fichier);
      return new Blob([octets as BlobPart], { type: mimeType ?? "application/octet-stream" });
    },
    [session, env],
  );

  if (!session || !profil || !contacts) {
    return <Placeholder titre="Profil" explication="Chargement…" />;
  }

  if (estMoi) {
    return (
      <ProfilMoi
        profil={profil}
        onEnregistrer={async (changements) => {
          await updateProfile(session, changements);
          setRevision((rang) => rang + 1);
        }}
        // REQ-MED-11 — **l'unique site d'appel du chemin public**, dans tout le dépôt.
        // Un test structurel du paquet média balaie les sources et échoue s'il en
        // apparaît un second : c'est ce qui rend la phrase « tout ce qui sort du
        // pipeline est chiffré, sauf l'unique chemin nommé public » vérifiable.
        onPhoto={(fichier) => uploadPublicProfileImage(session, env, fichier)}
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
        // REQ-UIX-39 — **le même chemin que le header 1:1**, littéralement le même
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
          />
        ) : undefined
      }
    />
  );
}
