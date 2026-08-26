import { attente, casse, ok, type Contexte, type Verification } from "./contrat.ts";

/**
 * L'état réel des conteneurs, par opposition à ce que `docker compose ps` laisse croire.
 * C'est ici que vit la panne la plus coûteuse du dépôt : un service qui redémarre en
 * boucle affiche « Up » à chaque relance, et la colonne se réaffiche sans rien signaler.
 */

const PHASE = "Pile";
export const PROJET = "tacita";

export type Conteneur = {
  readonly Name: string;
  readonly Service: string;
  readonly State: string;
  readonly Health?: string;
  readonly ExitCode?: number;
  readonly Publishers?: readonly { readonly PublishedPort?: number }[];
};

/**
 * `docker compose ps --format json` rend un objet par ligne selon les versions, et un
 * tableau selon d'autres. Accepter les deux coûte trois lignes et évite un diagnostic qui
 * dépend de la version du plugin installé chez l'administrateur.
 */
export function lireConteneurs(sortie: string): Conteneur[] {
  const texte = sortie.trim();
  if (texte === "") return [];
  try {
    const parse: unknown = JSON.parse(texte);
    if (Array.isArray(parse)) return parse as Conteneur[];
  } catch {
    /* ce n'est pas un tableau : on tente ligne par ligne */
  }
  const conteneurs: Conteneur[] = [];
  for (const ligne of texte.split("\n")) {
    if (ligne.trim() === "") continue;
    try {
      conteneurs.push(JSON.parse(ligne) as Conteneur);
    } catch {
      /* une ligne illisible n'invalide pas les autres */
    }
  }
  return conteneurs;
}

const conteneursDe = async ({ executer }: Contexte): Promise<Conteneur[] | undefined> => {
  const { code, sortie } = await executer("docker", ["compose", "-p", PROJET, "ps", "--format", "json"]);
  return code === 0 ? lireConteneurs(sortie) : undefined;
};

/** Le job d'initialisation de MinIO sort en 0 et reste « exited » : c'est son état normal. */
const JOBS = new Set(["minio-init"]);

export const pileDemarree: Verification = {
  nom: "pile",
  phase: PHASE,
  verifier: async (ctx) => {
    const conteneurs = await conteneursDe(ctx);
    if (conteneurs === undefined)
      return attente("pile", "état illisible — Docker ne répond pas");
    if (conteneurs.length === 0)
      return attente(
        "pile",
        "pas démarrée — les vérifications qui suivent attendent qu'elle le soit",
      );
    return ok("pile", `${conteneurs.length} conteneurs`);
  },
};

export const servicesEnBonneSante: Verification = {
  nom: "services",
  phase: PHASE,
  verifier: async (ctx) => {
    const conteneurs = await conteneursDe(ctx);
    if (conteneurs === undefined || conteneurs.length === 0)
      return attente("services", "en attente du démarrage de la pile");

    const fautifs = conteneurs
      .filter((c) => !JOBS.has(c.Service))
      .filter((c) => c.State !== "running" || c.Health === "unhealthy")
      .map((c) => `${c.Service} (${c.Health === "unhealthy" ? "unhealthy" : c.State})`);

    return fautifs.length === 0
      ? ok("services", `${conteneurs.length} conteneurs, tous en état de marche`)
      : casse(
          "services",
          fautifs.join(", "),
          `docker compose -p ${PROJET} logs ${fautifs[0]?.split(" ")[0] ?? ""} pour voir pourquoi`,
        );
  },
};

/** Au-delà, ce n'est plus un redémarrage : c'est une boucle. */
export const REDEMARRAGES_TOLERES = 3;

/**
 * Un conteneur qui boucle vient de démarrer, par construction : il ne tient que quelques
 * secondes. Au-delà de ce délai, des relances au compteur sont de l'histoire — un
 * redémarrage de la machine, ou l'attente d'une dépendance au premier `up`.
 */
export const SECONDES_POUR_BOUCLE = 120;

/**
 * La panne que `docker compose ps` ne peut pas montrer. Un service qui refuse sa
 * configuration sort, redémarre, et la colonne réaffiche « Up » à chaque relance. Sur le
 * staging, la passerelle push a tourné en boucle depuis le premier jour sans que personne
 * le voie : la pile paraissait debout, et aucune notification ne partait.
 *
 * **`RestartCount` seul ne suffit pas**, et le croire produisait un faux positif : il est
 * cumulatif sur toute la vie du conteneur, redémarrages de l'hôte compris. Sur ce dépôt, un
 * service affichait cinq relances tout en tournant sans interruption depuis quinze heures
 * — l'attente d'une dépendance au premier démarrage. Un diagnostic qui crie au loup sur
 * une pile saine ne sera plus jamais lu.
 */
export const servicesQuiBouclent: Verification = {
  nom: "redémarrages",
  phase: PHASE,
  verifier: async (ctx) => {
    const conteneurs = await conteneursDe(ctx);
    if (conteneurs === undefined || conteneurs.length === 0)
      return attente("redémarrages", "en attente du démarrage de la pile");

    const etats = await Promise.all(
      conteneurs
        .filter((c) => !JOBS.has(c.Service))
        .map(async (c) => {
          const { code, sortie } = await ctx.executer("docker", [
            "inspect",
            "-f",
            "{{.RestartCount}} {{.State.Restarting}} {{.State.StartedAt}}",
            c.Name,
          ]);
          const [compte, redemarre, depuis] = sortie.trim().split(/\s+/);
          return {
            service: c.Service,
            compte: code === 0 ? Number(compte) : 0,
            redemarre: redemarre === "true",
            secondesDebout: (ctx.maintenant.getTime() - Date.parse(depuis ?? "")) / 1000,
          };
        }),
    );

    const boucleurs = etats
      .filter(
        ({ compte, redemarre, secondesDebout }) =>
          redemarre ||
          (compte > REDEMARRAGES_TOLERES &&
            Number.isFinite(secondesDebout) &&
            secondesDebout < SECONDES_POUR_BOUCLE),
      )
      .map(({ service, compte }) => `${service} (${compte} fois)`);

    return boucleurs.length === 0
      ? ok("redémarrages", "aucun service ne boucle")
      : casse(
          "redémarrages",
          `${boucleurs.join(", ")} — « Up » se réaffiche à chaque relance, la colonne ne le dit pas`,
          `docker compose -p ${PROJET} logs ${boucleurs[0]?.split(" ")[0] ?? ""} : le message nomme la variable en cause`,
        );
  },
};

/**
 * L'overlay de fumée publie PostgreSQL et l'API Synapse sur l'hôte, et installe un CA de
 * développement dans le magasin de confiance de Synapse. Trois choses qui n'ont rien à
 * faire sur une machine publique — et `ufw` n'y change rien, puisqu'il ne protège pas ce
 * que Docker publie : les règles de redirection de Docker s'écrivent en amont de la
 * chaîne que `ufw` contrôle.
 */
export const overlayDeFumee: Verification = {
  nom: "ports publiés",
  phase: PHASE,
  verifier: async (ctx) => {
    const conteneurs = await conteneursDe(ctx);
    if (conteneurs === undefined || conteneurs.length === 0)
      return attente("ports publiés", "en attente du démarrage de la pile");

    const publies = [
      ...new Set(
        conteneurs.flatMap((c) =>
          (c.Publishers ?? [])
            .map((p) => p.PublishedPort)
            .filter((port): port is number => typeof port === "number" && port !== 0),
        ),
      ),
    ].sort((a, b) => a - b);

    const indus = publies.filter((port) => port !== 443);
    if (indus.length === 0) return ok("ports publiés", "443 seulement");
    if (ctx.dev)
      return ok("ports publiés", `443 et ${indus.join(", ")} — l'overlay de fumée, attendu ici`);

    return casse(
      "ports publiés",
      `${indus.join(", ")} exposés en plus du 443 — l'overlay smoke/ ne doit jamais être chargé ici`,
      "ufw ne protège pas ce que Docker publie : relancer sans -f smoke/docker-compose.yml",
    );
  },
};

export const VERIFICATIONS_PILE: readonly Verification[] = [
  pileDemarree,
  servicesEnBonneSante,
  servicesQuiBouclent,
  overlayDeFumee,
];
