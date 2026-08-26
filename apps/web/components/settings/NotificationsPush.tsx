"use client";

import { useCallback, useEffect, useState } from "react";

import {
  brancherPush,
  demanderEtBrancher,
  etatPushLocal,
  type DiagnosticPush,
  type EtatPush,
} from "../../lib/push";
import { Button, Text } from "../foundation/primitives";
import { useSession } from "../onboarding/SessionProvider";

/**
 * Ce que chaque état dit, et ce qu'il laisse faire.
 *
 * **Chaque état réparable porte une action.** L'ancienne table n'en donnait qu'à
 * `default` : dès que la permission était accordée — ce qui est le cas de tout appareil
 * ayant déjà répondu une fois —, l'écran n'affichait plus aucun bouton, et il n'existait
 * donc plus aucun moyen de rebrancher une chaîne cassée. C'est le « bouton invisible » :
 * il n'était pas masqué par le style, il n'était pas rendu.
 */
const ETATS: Record<EtatPush, { titre: string; texte: string; action?: string }> = {
  abonne: {
    titre: "Notifications activées",
    texte: "Votre appareil vous prévient à l'arrivée d'un message.",
    // Une chaîne qui traverse cinq maillons se vérifie, elle ne se croit pas.
    action: "Vérifier à nouveau",
  },
  "a-reparer": {
    titre: "Notifications interrompues",
    texte:
      "L'autorisation est accordée, mais la chaîne est coupée plus loin — le détail ci-dessous dit où. Cela arrive quand le navigateur renouvelle son abonnement ou après une reconnexion.",
    action: "Réactiver",
  },
  possible: {
    titre: "Notifications non activées",
    texte: "Vous serez prévenu des nouveaux messages, même application fermée.",
    action: "Activer",
  },
  refuse: {
    titre: "Notifications refusées",
    // le chemin de rattrapage. Un refus se lève **dans le navigateur** : le
    // dire est la seule chose utile ici, un bouton « Activer » ne pourrait qu'échouer en
    // silence, la permission n'étant plus redemandable.
    texte:
      "Ce navigateur les a bloquées pour Tacita. Rouvrez ses réglages de site — l'icône à gauche de l'adresse — et autorisez les notifications.",
  },
  "ios-a-installer": {
    titre: "Ajoutez Tacita à votre écran d'accueil",
    // sur iPhone, ce n'est pas un réglage à trouver : hors écran d'accueil,
    // Safari ne propose aucune notification, à personne. Le dire évite de chercher.
    texte:
      "Sur iPhone, les notifications n'existent que pour une application ajoutée à l'écran d'accueil. Ouvrez le menu de partage de Safari, puis « Sur l'écran d'accueil », et revenez ici.",
  },
  indisponible: {
    titre: "Notifications indisponibles",
    texte: "Ce navigateur ne gère pas les notifications web. Le reste de Tacita fonctionne.",
  },
};

/**
 * Les trois maillons, nommés. Ils ne s'affichent que lorsque la permission est accordée :
 * avant, il n'y a rien à diagnostiquer, seulement une question à poser.
 *
 * C'est la réponse à un problème d'exploitation réel : la chaîne traverse le navigateur,
 * un service push tiers, Synapse et notre passerelle, et **aucun de ces maillons ne peut
 * être observé depuis un poste de développement**. Un écran qui dit lequel a lâché est ce
 * qui remplace le débogueur qu'on n'a pas.
 */
const MAILLONS: { cle: keyof Omit<DiagnosticPush, "etat">; libelle: string }[] = [
  { cle: "permission", libelle: "Autorisation du navigateur" },
  { cle: "abonnement", libelle: "Abonnement de cet appareil" },
  { cle: "pusher", libelle: "Enregistrement sur votre compte" },
];

/**
 * l'état de l'abonnement push, et son rattrapage, dans les réglages.
 *
 * C'est le second point d'entrée voulu par l'exigence : le premier est la proposition au
 * premier message reçu, celui-ci est celui qu'on cherche quand on s'est aperçu de rien.
 * Depuis que la proposition ne se fait **qu'une fois** (M-B), c'est aussi le seul.
 */
export function NotificationsPush() {
  const { etat } = useSession();
  const session = etat.phase === "prete" ? etat.session : null;

  // Rien n'est lisible au rendu serveur — ni `Notification.permission`, ni l'abonnement
  // du service worker. L'état arrive après le montage, comme le thème (M-A).
  const [diagnostic, setDiagnostic] = useState<DiagnosticPush | null>(null);

  const verifier = useCallback(async () => {
    const local = etatPushLocal();
    if (local !== "accordee") {
      setDiagnostic({ etat: local, permission: false, abonnement: false, pusher: false });
      return;
    }
    // Permission accordée mais session pas encore prête : on ne conclut rien. Dire
    // « manquant » de trois maillons qu'on n'a pas regardés serait un faux diagnostic,
    // et c'est exactement le genre de mensonge que cet écran doit cesser de faire.
    if (!session) return;
    setDiagnostic(await brancherPush(session));
  }, [session]);

  useEffect(() => {
    void verifier();
  }, [verifier]);

  const activer = useCallback(async () => {
    if (!session) return;
    // Pas d'`await` avant la demande de permission : elle n'a d'effet que dans le geste.
    setDiagnostic(await demanderEtBrancher(session));
  }, [session]);

  // Le premier rendu ne promet rien : annoncer « activées » puis se dédire est pire que
  // d'attendre une seconde.
  const decrit = diagnostic ? ETATS[diagnostic.etat] : null;

  return (
    <div style={{ display: "grid", gap: "var(--spacing-2)" }}>
      <Text type="body" weight="bold" as="h2">
        {decrit ? decrit.titre : "Notifications"}
      </Text>
      <Text type="supporting" color="secondary">
        {decrit ? decrit.texte : "Vérification de l'état de cet appareil…"}
      </Text>

      {diagnostic?.permission && (
        <dl style={{ display: "grid", gap: "var(--spacing-1)", margin: 0 }}>
          {MAILLONS.map(({ cle, libelle }) => (
            <div key={cle} style={{ display: "flex", justifyContent: "space-between", gap: "var(--spacing-2)" }}>
              <dt>
                <Text type="supporting" color="secondary">
                  {libelle}
                </Text>
              </dt>
              {/* Deux mots, pas une coche : une coche verte et une croix rouge se
                  ressemblent trop pour quelqu'un qui distingue mal les couleurs, et
                  DESIGN.md réserve `danger` au destructif. */}
              <dd style={{ margin: 0 }}>
                <Text type="supporting">{diagnostic[cle] ? "en place" : "manquant"}</Text>
              </dd>
            </div>
          ))}
        </dl>
      )}

      {decrit?.action && (
        <Button
          label={decrit.action}
          variant={diagnostic?.etat === "abonne" ? "secondary" : "primary"}
          width="100%"
          clickAction={activer}
        />
      )}
    </div>
  );
}
