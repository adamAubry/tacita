import { generateKeyPairSync, randomBytes } from "node:crypto";

/**
 * `init` fabrique ce que `doctor` se contente de réclamer. Deux règles le gouvernent :
 *
 * 1. **Rejouable.** Relancé, il ne régénère rien — un secret régénéré invaliderait les
 *    sessions ouvertes, et un `SERVER_NAME` réécrit abandonnerait le homeserver.
 * 2. **Rien ne s'écrase en silence.** Une valeur déjà posée est conservée et dite comme
 *    telle ; l'outil rend compte de chaque ligne, y compris celles qu'il n'a pas touchées.
 *
 * Le cœur est pur : il transforme un texte en texte. L'écriture sur disque vit dans
 * `index.ts`, ce qui rend tout ceci prouvable sans jamais toucher un fichier réel.
 */

export type Action = "généré" | "renseigné" | "conservé" | "laissé vide";

export type Modification = {
  readonly cle: string;
  readonly action: Action;
  /** Jamais la valeur elle-même pour un secret : un rapport ne divulgue pas ce qu'il pose. */
  readonly apercu: string;
};

export type Reponses = {
  readonly domaine: string;
  readonly email: string;
};

export type Plan = {
  readonly contenu: string;
  readonly modifications: readonly Modification[];
};

/** Une paire VAPID P-256, aux formats exacts qu'attendent la passerelle et le navigateur. */
export function genererVapid(): { publique: string; privee: string } {
  const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const { x, y } = publicKey.export({ format: "jwk" });
  const { d } = privateKey.export({ format: "jwk" });
  // Point non compressé : 0x04 ‖ X ‖ Y, soit 65 octets, soit 87 caractères en base64url.
  const point = Buffer.concat([
    Buffer.of(4),
    Buffer.from(x as string, "base64url"),
    Buffer.from(y as string, "base64url"),
  ]);
  return { publique: point.toString("base64url"), privee: d as string };
}

const secretHexa = () => randomBytes(32).toString("hex");

/**
 * Ce qui compte comme « pas encore renseigné ». `.env.example` livre `change-me` ; un
 * fichier à moitié rempli livre du vide. Les deux se remplissent, tout le reste se garde.
 */
const estAPourvoir = (valeur: string): boolean =>
  valeur === "" || valeur === "change-me" || valeur === "change-me:change-me";

/**
 * Volontairement vides, et qui doivent le rester : l'overlay RTC exige deux IPv4
 * publiques distinctes que personne ne peut deviner. Les remplir au hasard produirait une
 * pile qui refuse de démarrer pour une raison inventée par l'outil.
 */
const LAISSEES_VIDES = new Set(["WEB_BIND_IP", "TURN_BIND_IP"]);

const SECRETS_GENERES = new Set([
  "POSTGRES_PASSWORD",
  "SYNAPSE_REGISTRATION_SHARED_SECRET",
  "SYNAPSE_MACAROON_SECRET_KEY",
  "SYNAPSE_FORM_SECRET",
  "S3_SECRET_ACCESS_KEY",
  "LIVEKIT_SECRET",
]);

const masquer = (valeur: string) => `${valeur.slice(0, 4)}… (${valeur.length} caractères)`;

/**
 * Rend le contenu du futur `infra/.env` à partir d'une source — le `.env` existant s'il y
 * en a un, `.env.example` sinon. Les commentaires et l'ordre de la source sont préservés :
 * ils portent l'essentiel de ce qu'un administrateur doit comprendre, et les perdre
 * reviendrait à échanger une documentation vivante contre une liste de clés.
 */
export function planifier(source: string, reponses: Reponses): Plan {
  const vapid = genererVapid();
  const modifications: Modification[] = [];
  const vues = new Set<string>();

  const lignes = source.split("\n").map((ligne) => {
    const coupure = ligne.indexOf("=");
    if (ligne.trimStart().startsWith("#") || coupure <= 0) return ligne;
    const cle = ligne.slice(0, coupure).trim();
    if (!/^[A-Z][A-Z0-9_]*$/.test(cle)) return ligne;
    const valeur = ligne.slice(coupure + 1).trim();
    vues.add(cle);

    const garder = (action: Action, apercu: string) => {
      modifications.push({ cle, action, apercu });
      return ligne;
    };
    const poser = (nouvelle: string, action: Action, apercu: string) => {
      modifications.push({ cle, action, apercu });
      return `${cle}=${nouvelle}`;
    };

    if (LAISSEES_VIDES.has(cle))
      return valeur === ""
        ? garder("laissé vide", "à remplir seulement pour les appels audio/vidéo")
        : garder("conservé", valeur);

    if (cle === "SERVER_NAME")
      return estAPourvoir(valeur) || valeur.endsWith("example.org") || valeur.endsWith("example.com")
        ? poser(reponses.domaine, "renseigné", reponses.domaine)
        : garder("conservé", valeur);

    if (cle === "VAPID_SUBJECT")
      return estAPourvoir(valeur) || valeur.includes("example.org")
        ? poser(`mailto:${reponses.email}`, "renseigné", `mailto:${reponses.email}`)
        : garder("conservé", valeur);

    if (cle === "TURN_DOMAIN")
      return estAPourvoir(valeur) || valeur.endsWith("example.org")
        ? poser(`turn.${reponses.domaine}`, "renseigné", `turn.${reponses.domaine}`)
        : garder("conservé", valeur);

    if (!estAPourvoir(valeur)) return garder("conservé", cle.includes("SECRET") || cle.includes("PASSWORD") ? masquer(valeur) : valeur);

    if (cle === "VAPID_PUBLIC_KEY") return poser(vapid.publique, "généré", masquer(vapid.publique));
    if (cle === "VAPID_PRIVATE_KEY") return poser(vapid.privee, "généré", masquer(vapid.privee));
    if (cle === "MINIO_KMS_SECRET_KEY")
      return poser(`tacita:${randomBytes(32).toString("base64")}`, "généré", "tacita:… (32 octets)");
    if (cle === "POSTGRES_USER") return poser("synapse", "renseigné", "synapse");
    if (cle === "S3_BUCKET") return poser("synapse-media", "renseigné", "synapse-media");
    if (cle === "S3_ACCESS_KEY_ID" || cle === "LIVEKIT_KEY")
      return poser("tacita", "renseigné", "tacita");
    if (SECRETS_GENERES.has(cle)) {
      const secret = secretHexa();
      return poser(secret, "généré", masquer(secret));
    }
    return garder("conservé", valeur);
  });

  return { contenu: lignes.join("\n"), modifications };
}

/** Ce que l'outil ne peut pas faire, et qui reste à l'administrateur. Dit, jamais tu. */
export function resteAFaire(domaine: string, dev: boolean): readonly string[] {
  return dev
    ? [
        `ajouter « 127.0.0.1 ${domaine} call.${domaine} » au fichier hosts`,
        "cd infra && ./proxy/generate-dev-certs.sh",
        "importer infra/proxy/certs/fullchain.pem comme autorité de confiance du navigateur",
        "cd infra && docker compose -f docker-compose.yml -f smoke/docker-compose.yml up -d",
      ]
    : [
        `créer deux enregistrements A : ${domaine} et call.${domaine} vers l'IP de cette machine`,
        `sudo certbot certonly --standalone -d ${domaine} -d call.${domaine}`,
        "sudo install -D -m 755 infra/staging/certs-deploy-hook.sh /etc/letsencrypt/renewal-hooks/deploy/tacita.sh",
        "cd infra && docker compose -f docker-compose.yml -f staging/docker-compose.yml up -d",
        "pnpm admin doctor — pour vérifier que tout est en place",
      ];
}

const DOMAINE = /^(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Refuser tôt : un domaine mal formé se paierait au premier certificat, une heure plus tard. */
export function valider({ domaine, email }: Reponses): string | undefined {
  if (!DOMAINE.test(domaine))
    return `« ${domaine} » n'est pas un nom de domaine valide (attendu : chat.ton-domaine.fr)`;
  if (domaine.endsWith("example.org") || domaine.endsWith("example.com"))
    return `« ${domaine} » est un domaine d'exemple — il ne résoudra jamais`;
  if (!EMAIL.test(email)) return `« ${email} » n'est pas une adresse e-mail valide`;
  return undefined;
}
