/**
 * L'émission du certificat. C'est la seule commande de l'outil qui appelle un service
 * externe, prend des droits root et consomme un quota : Let's Encrypt limite à cinq
 * certificats identiques par semaine. Elle s'annonce donc entièrement avant d'agir, et
 * refuse de tourner tant qu'une de ses conditions n'est pas remplie — un certbot lancé
 * sur un DNS qui ne résout pas brûle une tentative et rend un message qui ne nomme pas
 * le DNS.
 */

export type Etape = {
  readonly titre: string;
  readonly commande: string;
  readonly args: readonly string[];
  /** Pourquoi cette étape existe, en une phrase, affichée avec le plan. */
  readonly motif: string;
};

export type Obstacle = {
  readonly quoi: string;
  readonly remede: string;
};

export type Faits = {
  readonly domaine: string;
  readonly email: string;
  readonly dev: boolean;
  readonly certbotPresent: boolean;
  /** Les noms qui ne résolvent pas encore. */
  readonly nomsMuets: readonly string[];
  readonly port80: "libre" | "occupe" | "inconnu";
  /** Un certificat déjà en place qui couvre les deux noms, avec ses jours restants. */
  readonly certificatExistant: { readonly joursRestants: number } | undefined;
  readonly force: boolean;
};

export type Plan = {
  readonly obstacles: readonly Obstacle[];
  readonly etapes: readonly Etape[];
  readonly avertissements: readonly string[];
};

export const HOOK_SOURCE = "infra/staging/certs-deploy-hook.sh";
export const HOOK_DESTINATION = "/etc/letsencrypt/renewal-hooks/deploy/tacita.sh";

/** En dessous, renouveler est légitime ; au-dessus, c'est brûler une tentative pour rien. */
export const JOURS_AVANT_RENOUVELLEMENT = 30;

export function planifier(faits: Faits): Plan {
  const obstacles: Obstacle[] = [];
  const avertissements: string[] = [];

  if (faits.dev) {
    return {
      obstacles: [],
      avertissements: [
        "Machine de développement : le certificat sera auto-signé, pas émis par Let's Encrypt.",
        "Il faudra l'importer comme autorité de confiance du navigateur, sans quoi le service",
        "worker ne s'installera pas — un contexte sécurisé est exigé.",
      ],
      etapes: [
        {
          titre: "Certificat auto-signé",
          commande: "./infra/proxy/generate-dev-certs.sh",
          args: [],
          motif: "il porte les subjectAltName sans lesquels Synapse et le navigateur le refusent",
        },
      ],
    };
  }

  if (!faits.certbotPresent)
    obstacles.push({
      quoi: "certbot n'est pas installé",
      remede: "sudo apt install -y certbot",
    });

  if (faits.nomsMuets.length > 0)
    obstacles.push({
      quoi: `${faits.nomsMuets.join(" et ")} ne résout pas encore`,
      remede: "pnpm admin dns — il donne les enregistrements exacts à créer",
    });

  if (faits.port80 === "occupe")
    obstacles.push({
      quoi: "le port 80 est occupé, or certbot s'y lie le temps du défi",
      remede: "sudo ss -ltnp 'sport = :80' pour voir qui l'occupe, puis l'arrêter",
    });

  if (faits.certificatExistant !== undefined && !faits.force) {
    const { joursRestants } = faits.certificatExistant;
    if (joursRestants > JOURS_AVANT_RENOUVELLEMENT)
      obstacles.push({
        quoi: `un certificat valide couvre déjà les deux noms, pour ${joursRestants} jours encore`,
        remede:
          "rien à faire — le renouvellement est automatique ; --force pour réémettre malgré tout",
      });
  }

  avertissements.push(
    "Let's Encrypt limite à cinq certificats identiques par semaine. Un échec compte.",
    "Le port 80 sera occupé quelques secondes par certbot, le temps du défi HTTP.",
  );

  return {
    obstacles,
    avertissements,
    etapes: [
      {
        titre: "Hook de renouvellement",
        commande: "sudo",
        args: ["install", "-D", "-m", "755", HOOK_SOURCE, HOOK_DESTINATION],
        // Certbot exécute les hooks de déploiement dès la première émission : posé
        // après, il ne servirait qu'au renouvellement suivant, et les fichiers ne
        // seraient pas en place pour le proxy aujourd'hui.
        motif: "posé avant l'émission, il met les fichiers en place dès la première fois",
      },
      {
        titre: "Émission",
        commande: "sudo",
        args: [
          "certbot",
          "certonly",
          "--standalone",
          "-d",
          faits.domaine,
          "-d",
          `call.${faits.domaine}`,
          "--agree-tos",
          "-m",
          faits.email,
          "--no-eff-email",
          "--non-interactive",
          ...(faits.force ? ["--force-renewal"] : []),
        ],
        // `--nginx` ne convient pas : notre nginx tourne en conteneur, avec une
        // configuration montée en lecture seule, et il n'écoute pas sur le 80.
        motif: "en --standalone, certbot lie lui-même le 80 le temps du défi",
      },
    ],
  };
}

/** Ce qu'il reste à faire une fois le certificat en place. */
export function apresEmission(dev: boolean): readonly string[] {
  return dev
    ? [
        "importer infra/proxy/certs/fullchain.pem comme autorité de confiance du navigateur",
        "cd infra && docker compose -f docker-compose.yml -f smoke/docker-compose.yml up -d",
      ]
    : [
        "cd infra && docker compose -f docker-compose.yml -f staging/docker-compose.yml up -d",
        "pnpm admin doctor — il relit le certificat et confirme les subjectAltName",
      ];
}
