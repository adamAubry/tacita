"use client";

import { PINNED_EVENTS_METADATA, REACTIONS_METADATA } from "@tacita/messaging";
import { DELIVERED_EVENT_TYPE } from "@tacita/receipts";

import { Text } from "../foundation/primitives";

interface Limite {
  cle: string;
  titre: string;
  texte: string;
  /** `false` quand le paquet dit que la limite n'existe pas : la ligne disparaît. */
  reelle?: boolean;
}

/**
 * REQ-UIX-32 — l'écran « limites connues ». **Honnêteté produit** (spec 00, interdit
 * n°13) : ce que le produit ne garantit pas est écrit ici, une fois, en clair.
 *
 * Rédaction sobre et non anxiogène — le but est qu'on puisse décider, pas qu'on ait
 * peur. Chaque limite dit **ce qui est exposé** et **pourquoi**, sans superlatif, sans
 * icône d'alerte, sans rouge. La couleur `danger` est réservée au destructif (DESIGN.md),
 * et un écran d'information n'en est pas.
 *
 * Les deux premières lignes ne sont pas recopiées : elles sont conditionnées par la
 * métadonnée que les paquets exposent. Le jour où l'une devient chiffrée, la ligne
 * disparaît d'elle-même au lieu de mentir jusqu'à ce qu'on pense à la retirer.
 */
const LIMITES: Limite[] = [
  {
    cle: "reactions",
    titre: "Les réactions circulent en clair",
    texte:
      "C'est le serveur qui regroupe les réactions d'un message, il doit donc lire l'emoji. Il voit qui réagit à quoi. Le message lui-même reste chiffré.",
    reelle: REACTIONS_METADATA.cleartext,
  },
  {
    cle: "epingles",
    titre: "La liste des messages épinglés est en clair",
    texte:
      "L'épinglage est un événement d'état, et Matrix ne chiffre pas l'état. Le serveur voit quels messages sont épinglés, et dans quel salon.",
    reelle: PINNED_EVENTS_METADATA.cleartext,
  },
  {
    cle: "delivre",
    titre: "« Délivré » est une extension à nous",
    texte:
      "Matrix ne définit que « lu ». Notre accusé de réception est un type d'événement propre à Tacita : un correspondant qui utilise un autre client ne l'émettra pas, et son message restera à « envoyé ».",
  },
  {
    cle: "metadonnees",
    titre: "Le serveur voit qui parle à qui, et quand",
    texte:
      "Le contenu ne lui est jamais lisible. L'appartenance aux salons, les horodatages, la taille des fichiers et les conversations mises en silence, si — ce sont les métadonnées dont il a besoin pour acheminer.",
  },
  {
    cle: "annuaire",
    titre: "Votre nom est trouvable par tous les comptes de ce serveur",
    texte:
      "Pour qu'on puisse vous ajouter sans connaître votre identifiant par cœur, l'annuaire du serveur répond à toutes les recherches : votre nom d'affichage et votre identifiant y apparaissent, même pour quelqu'un à qui vous n'avez jamais parlé. Vos messages, eux, n'y sont pas.",
  },
  {
    /*
     * D-12 — **la contrepartie du garde de changement de mot de passe**, dite là où elle
     * se lit avant d'en dépendre. `infra/LIMITES.md` la porte pour l'opérateur ; cet
     * écran est le seul endroit où l'utilisateur peut la voir.
     *
     * Elle est ici et pas seulement dans l'écran de changement : quelqu'un qui décide de
     * confier ses conversations à ce produit doit pouvoir le savoir avant, pas au moment
     * où il tape sa clé.
     */
    cle: "cle-au-serveur",
    titre: "Changer votre mot de passe transmet votre clé au serveur",
    texte:
      "C'est votre clé de récupération, et non votre mot de passe actuel, qui autorise ce changement — quelqu'un qui accède à votre téléphone ne peut donc pas s'approprier votre compte. En échange, la clé est envoyée au serveur pour qu'il la vérifie. Il ne la conserve pas, mais un serveur mal intentionné pourrait le faire, et déchiffrerait alors vos conversations. Le nôtre est auto-hébergé ; si vous n'hébergez pas vous-même, sachez que cette confiance-là est nécessaire.",
  },
  {
    cle: "recherche",
    titre: "La recherche porte sur cet appareil",
    texte:
      "L'index est construit localement à partir des messages déchiffrés ici. Un message plus ancien que ce que cet appareil a synchronisé existe, mais ne sera pas trouvé.",
  },
  {
    cle: "liens",
    titre: "Un lien de groupe ne garantit pas que le groupe reste joignable",
    texte:
      "Le service qui émet les liens n'a aucun pouvoir sur les salons : il ne peut pas voir que l'émetteur a quitté le groupe. Le lien reste valide, l'invitation échoue.",
  },
  {
    cle: "photo",
    titre: "Votre photo de profil n'est pas chiffrée",
    texte:
      "Un avatar doit pouvoir s'afficher chez tous vos correspondants, y compris ceux qui n'ont aucune de vos clés. Il est donc déposé en clair sur le serveur. Le choisir est facultatif — le reste de votre profil ne l'exige pas.",
  },
  {
    cle: "notifications",
    titre: "Une notification arrivée application fermée reste sans contenu",
    texte:
      "Le serveur n'envoie que de quoi réveiller l'application : il n'a rien d'autre à envoyer. Le déchiffrement demande les clés de cet appareil, qui ne sont accessibles qu'à l'application ouverte — sinon, la notification dit « Nouveau message » et rien de plus.",
  },
  {
    cle: "invitations",
    titre: "Le service de liens apprend qui invite qui",
    texte:
      "Il ne voit aucun message et n'en émet aucun. Il sait qu'un lien a été créé, et par qui. L'ajout par identifiant Matrix ne passe pas par lui.",
  },
];

export function LimitesConnues() {
  return (
    <div style={{ display: "grid", gap: "var(--spacing-4)", padding: "var(--spacing-3)" }}>
      <Text type="supporting" color="secondary">
        Tacita chiffre le contenu de bout en bout. Voici ce que cela ne couvre pas — pour
        que vous le sachiez avant d'en avoir besoin.
      </Text>

      {LIMITES.filter((limite) => limite.reelle !== false).map(({ cle, titre, texte }) => (
        <div key={cle} style={{ display: "grid", gap: "var(--spacing-1)" }}>
          <Text type="body" weight="bold" as="h2">
            {titre}
          </Text>
          <Text type="supporting" color="secondary">
            {texte}
          </Text>
        </div>
      ))}

      {/* Le type d'événement est lu du paquet, pas recopié : une chaîne recopiée n'est
          plus un contrat (spec 11). Discret — il n'intéresse que qui sait le lire. */}
      <Text type="code" color="secondary">
        {DELIVERED_EVENT_TYPE}
      </Text>
    </div>
  );
}
