/**
 * Le guide de redirection du nom de domaine. C'est la seule étape que l'outil ne peut
 * pas faire à la place de l'administrateur — elle se passe chez son registrar — donc la
 * moindre des choses est de lui donner les deux lignes exactes à recopier, avec l'adresse
 * déjà remplie, plutôt qu'une phrase qui décrit ce qu'il devrait deviner.
 */

/** Les plages qu'aucun résolveur public ne peut atteindre. */
const PRIVEES = [
  /^10\./,
  /^127\./,
  /^169\.254\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./, // CGNAT
];

export function estPublique(adresse: string): boolean {
  return !PRIVEES.some((plage) => plage.test(adresse));
}

/**
 * L'adresse à mettre dans l'enregistrement A. Sur un VPS, elle est portée par une
 * interface. Derrière un NAT, il n'y en a aucune — et c'est un cas qu'il faut dire, pas
 * deviner : proposer une adresse privée produirait un domaine qui ne résout que pour soi.
 */
export function adressePublique(adresses: readonly string[]): string | undefined {
  return adresses.find(estPublique);
}

export type EtatDuNom = {
  readonly nom: string;
  readonly adresses: readonly string[];
};

const PLACEHOLDER = "<IP publique de cette machine>";

export function guideDns(
  domaine: string,
  publique: string | undefined,
  etats: readonly EtatDuNom[],
): string[] {
  const adresse = publique ?? PLACEHOLDER;
  const largeur = Math.max(...etats.map((e) => e.nom.length), domaine.length + 5);

  const lignes = [
    "",
    "Rediriger le nom de domaine",
    "",
    "Deux enregistrements A à créer chez ton registrar (OVH, Gandi, Cloudflare…) :",
    "",
    `  ${"Type".padEnd(6)}${"Nom".padEnd(largeur + 2)}Valeur`,
    `  ${"A".padEnd(6)}${domaine.padEnd(largeur + 2)}${adresse}`,
    `  ${"A".padEnd(6)}${`call.${domaine}`.padEnd(largeur + 2)}${adresse}`,
    "",
  ];

  if (publique === undefined) {
    lignes.push(
      "Aucune adresse publique n'est portée par cette machine : elle est derrière un NAT,",
      "ou son adresse publique vit sur la passerelle. Prendre celle que t'affiche le panneau",
      "de ton hébergeur, et vérifier que les ports 80 et 443 sont bien redirigés vers ici.",
      "",
    );
  }

  lignes.push(
    "Le sous-domaine call. n'est pas optionnel. Il sert aux appels audio/vidéo, mais",
    "surtout le certificat doit le porter dès son émission : l'ajouter plus tard oblige",
    "à tout réémettre. Le déclarer maintenant, même sans appels déployés.",
    "",
    "État constaté à l'instant :",
    "",
  );

  for (const { nom, adresses } of etats) {
    /**
     * Sans adresse publique connue, il n'y a rien à comparer : afficher « ce n'est pas
     * la bonne » face à un texte de remplacement accuserait une configuration correcte.
     */
    const constat =
      adresses.length === 0
        ? "ne résout pas encore"
        : publique === undefined
          ? `→ ${adresses.join(", ")}`
          : adresses.includes(publique)
            ? `→ ${adresses.join(", ")} ✓`
            : `→ ${adresses.join(", ")} — ce n'est pas ${publique}`;
    lignes.push(`  ${nom.padEnd(largeur + 2)}${constat}`);
  }

  const manquants = etats.filter((e) => e.adresses.length === 0);
  lignes.push("");
  if (manquants.length > 0) {
    lignes.push(
      "La propagation prend de quelques minutes à quelques heures selon le registrar.",
      "Vérifier sans attendre l'outil :",
      "",
      `  dig +short ${etats.map((e) => e.nom).join(" ")}`,
      "",
      "Ne pas lancer `pnpm admin certificat` avant que les deux répondent : certbot",
      "échouerait, et sur un message qui ne nomme jamais le DNS.",
    );
  } else {
    lignes.push("Les deux noms répondent. La suite :", "", "  pnpm admin certificat");
  }
  lignes.push("");
  return lignes;
}
