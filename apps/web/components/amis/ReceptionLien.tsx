"use client";

import type { Session } from "@tacita/client-core";
import { joinRule, knock } from "@tacita/messaging";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { contactsDeLaSession } from "../../lib/contacts";
import { estLienRefuse, liensDeLaSession, type LiensInvitation } from "../../lib/liens-invitation";
import { IconeLien } from "../foundation/icons";
import { LayoutHeader } from "../foundation/LayoutHeader";
import { Placeholder } from "../foundation/Placeholder";
import { Button, Text } from "../foundation/primitives";
import { useSession } from "../onboarding/SessionProvider";
import { routeConversation } from "../../lib/routes";

/**
 * Les états de la réception. `attente` est un état **terminal et honnête** : on a frappé,
 * et il ne se passera rien de plus sans un geste humain à l'autre bout.
 */
type Etat =
  | { phase: "resolution" }
  | { phase: "attente"; groupe?: string }
  | { phase: "invalide" }
  | { phase: "indisponible" };

interface ReceptionLienProps {
  token: string;
  /** Injectés en test : le service est une API HTTP, les contacts une interface (E-04). */
  liens?: LiensInvitation;
  session?: Session;
}

/**
 * l'écran qui consomme un lien d'invitation (E-13, voie A).
 *
 * Il fait **une** chose et la fait sans rien demander : on a cliqué sur un lien, on a
 * déjà exprimé son intention. Un écran « voulez-vous vraiment ? » ajouterait un geste à
 * une décision déjà prise.
 *
 * Deux chemins, selon ce que le service rend — et le service ne fait ni l'un ni l'autre,
 * il ne fait que résoudre (ratification n°1 du service de liens) :
 *
 * - `friend` → invitation de DM native vers l'émetteur, le chemin de D-09 ;
 * - `group` → **`knock`** sur le salon. C'est tout ce qu'un non-membre peut faire : il ne
 *   peut ni s'inviter (il faudrait être membre) ni rejoindre (le salon est fermé). Un
 *   membre confirmera depuis les informations du groupe.
 *
 * L'échec est **indifférencié**, et c'est voulu : le service rend la même réponse pour un
 * token inconnu, expiré, révoqué ou bloqué. Deviner laquelle pour l'afficher
 * reconstruirait l'énumérabilité qu'il refuse. « Ce lien n'est plus valide » est tout ce
 * qu'on peut honnêtement dire.
 */
export function ReceptionLien({ token, liens, session: injectee }: ReceptionLienProps) {
  const { etat: etatSession } = useSession();
  const router = useRouter();
  const session = injectee ?? (etatSession.phase === "prete" ? etatSession.session : null);

  const [etat, setEtat] = useState<Etat>({ phase: "resolution" });

  useEffect(() => {
    if (!session) return;
    let annule = false;
    const service = liens ?? liensDeLaSession(session);

    void (async () => {
      try {
        const resolu = await service.resoudre(token);
        if (annule) return;

        if (resolu.kind === "friend") {
          // idempotent : `inviter` rend le DM existant s'il y en a un, sinon
          // le crée. Rien à distinguer ici, le paquet s'en charge.
          const roomId = await contactsDeLaSession(session).inviter(resolu.issuer);
          if (!annule) router.replace(routeConversation(roomId));
          return;
        }

        if (!resolu.roomId) {
          // Un lien `group` sans salon est une réponse que le service ne devrait pas
          // rendre. On ne devine pas : c'est un lien inutilisable.
          if (!annule) setEtat({ phase: "invalide" });
          return;
        }

        // déjà membre : rien à demander, on ouvre. Le cas se produit quand
        // on rouvre un lien qu'on a déjà utilisé.
        const salon = session.client.getRoom(resolu.roomId);
        if (salon?.getMyMembership() === "join") {
          if (!annule) router.replace(routeConversation(resolu.roomId));
          return;
        }

        // Déjà frappé : on réaffiche l'attente au lieu de frapper une seconde fois.
        if (salon?.getMyMembership() !== "knock") {
          // Le sas doit être ouvert — M-H le bascule à l'émission du premier lien. S'il
          // ne l'est pas, le serveur refusera : autant le dire tout de suite plutôt que
          // d'afficher une attente qui n'attend rien.
          if (joinRule(session, resolu.roomId) === "invite" && salon) {
            if (!annule) setEtat({ phase: "invalide" });
            return;
          }
          await knock(session, resolu.roomId);
        }

        if (!annule) setEtat({ phase: "attente", groupe: salon?.name });
      } catch (erreur) {
        // Rien n'est journalisé : le token est dans l'URL, et une trace le porterait.
        //
        // **Refus et panne se distinguent, et eux seuls** (règle 2). Le service confond
        // ses quatre causes d'invalidité, et on ne cherche pas à les rouvrir : on lit
        // seulement s'il a refusé le lien ou s'il n'a pas répondu. Sans cette ligne, un
        // lien expiré — le cas nominal d'un lien à usage unique valable un jour —
        // affichait « le service ne répond pas, réessayez plus tard », c'est-à-dire un
        // conseil d'attendre là où attendre ne peut rien donner. L'échec du `knock`, lui,
        // n'est pas un refus du lien : il reste une panne, ce qu'il est.
        if (!annule) setEtat({ phase: estLienRefuse(erreur) ? "invalide" : "indisponible" });
      }
    })();

    return () => {
      annule = true;
    };
  }, [session, token, liens, router]);

  const retour = <Button label="Aller à l'accueil" variant="primary" onClick={() => router.replace("/")} />;

  return (
    <>
      <LayoutHeader titre="Invitation" retour={false} />

      {etat.phase === "resolution" && (
        <Placeholder icone={IconeLien} titre="Vérification du lien…" explication="Un instant." />
      )}

      {etat.phase === "attente" && (
        <div style={{ display: "grid", gap: "var(--spacing-3)", padding: "var(--spacing-4)", justifyItems: "center" }}>
          <Text type="display-3">Demande envoyée</Text>
          <Text type="body" color="secondary">
            {etat.groupe
              ? `Votre demande d'entrée dans « ${etat.groupe} » attend la confirmation d'un membre.`
              : "Votre demande d'entrée attend la confirmation d'un membre du groupe."}
          </Text>
          {/* Honnêteté : on ne promet ni délai, ni notification qu'on n'émet pas. La
              conversation apparaîtra dans la liste, c'est la seule chose qu'on sait. */}
          <Text type="supporting" color="secondary">
            Le groupe apparaîtra dans vos conversations dès qu&apos;un membre l&apos;aura
            acceptée. Personne n&apos;est prévenu automatiquement de votre attente.
          </Text>
          {retour}
        </div>
      )}

      {etat.phase === "invalide" && (
        <Placeholder
          icone={IconeLien}
          titre="Ce lien n'est plus valide"
          explication="Il a peut-être expiré, été révoqué, ou déjà servi le nombre de fois prévu. Demandez-en un nouveau à la personne qui vous l'a envoyé."
          action={retour}
        />
      )}

      {etat.phase === "indisponible" && (
        <Placeholder
          icone={IconeLien}
          titre="Le lien n'a pas pu être vérifié"
          explication="Le service ne répond pas. Réessayez plus tard — ou demandez à être ajouté par votre identifiant Matrix, ce qui ne passe pas par lui."
          action={retour}
        />
      )}
    </>
  );
}
