import { describe, expect, it } from "vitest";

import { genererVapid, planifier, resteAFaire, valider } from "../src/init.ts";
import { lireEnv } from "../src/verifications.ts";

const REPONSES = { domaine: "chat.tacita.fr", email: "adam@tacita.fr" };

/** Un extrait fidèle de `.env.example` : commentaires compris, ce sont eux qui documentent. */
const EXEMPLE = `# Copie en .env, ne jamais committer .env (secrets réels)

SERVER_NAME=chat.example.org

POSTGRES_USER=synapse
POSTGRES_PASSWORD=change-me

SYNAPSE_REGISTRATION_SHARED_SECRET=change-me
SYNAPSE_MACAROON_SECRET_KEY=change-me
SYNAPSE_FORM_SECRET=change-me

S3_BUCKET=synapse-media
S3_ACCESS_KEY_ID=change-me
S3_SECRET_ACCESS_KEY=change-me
# format attendu : <key-id>:<base64 32 octets>
MINIO_KMS_SECRET_KEY=change-me:change-me

VAPID_SUBJECT=mailto:admin@example.org
VAPID_PUBLIC_KEY=change-me
VAPID_PRIVATE_KEY=change-me
SYNAPSE_IP_RANGE_WHITELIST=["172.16.0.0/12"]

# Le proxy et le TURN-TLS veulent tous les deux 443 : une IP publique chacun.
WEB_BIND_IP=
TURN_BIND_IP=
TURN_DOMAIN=turn.chat.example.org
LIVEKIT_KEY=change-me
LIVEKIT_SECRET=change-me
`;

describe("la paire VAPID, produite sans dépendance ni conteneur jetable", () => {
  it("respecte au caractère près les formats qu'attendent la passerelle et le navigateur", () => {
    // 87 et 43 ne sont pas des conventions : ce sont les longueurs en base64url d'un
    // point P-256 non compressé (65 octets) et de sa clé privée (32 octets).
    const { publique, privee } = genererVapid();
    expect(publique).toHaveLength(87);
    expect(privee).toHaveLength(43);
    expect(Buffer.from(publique, "base64url")).toHaveLength(65);
    expect(Buffer.from(publique, "base64url")[0]).toBe(4);
    expect(Buffer.from(privee, "base64url")).toHaveLength(32);
  });

  it("rend une paire différente à chaque appel", () => {
    expect(genererVapid().publique).not.toBe(genererVapid().publique);
  });
});

describe("la préparation d'infra/.env depuis l'exemple", () => {
  const { contenu, modifications } = planifier(EXEMPLE, REPONSES);
  const valeurs = lireEnv(contenu);
  const actionDe = (cle: string) => modifications.find((m) => m.cle === cle)?.action;

  it("ne laisse aucun « change-me » derrière elle", () => {
    expect(contenu).not.toContain("change-me");
  });

  it("produit un fichier que le doctor accepte, longueurs comprises", () => {
    expect(valeurs.get("VAPID_PUBLIC_KEY")).toHaveLength(87);
    expect(valeurs.get("VAPID_PRIVATE_KEY")).toHaveLength(43);
    expect(Buffer.from(valeurs.get("MINIO_KMS_SECRET_KEY")!.split(":")[1]!, "base64")).toHaveLength(32);
    expect(valeurs.get("SERVER_NAME")).toBe("chat.tacita.fr");
    expect(valeurs.get("VAPID_SUBJECT")).toBe("mailto:adam@tacita.fr");
  });

  it("préserve les commentaires et l'ordre, qui portent l'essentiel de la documentation", () => {
    // Les remplacer par une liste de clés échangerait une documentation vivante contre
    // un fichier que plus personne ne comprend six mois plus tard.
    expect(contenu).toContain("# Copie en .env, ne jamais committer .env (secrets réels)");
    expect(contenu).toContain("# format attendu : <key-id>:<base64 32 octets>");
    expect(contenu.indexOf("SERVER_NAME")).toBeLessThan(contenu.indexOf("POSTGRES_USER"));
  });

  it("laisse vides les deux IP de liaison, qu'aucun outil ne peut deviner", () => {
    // Les remplir au hasard produirait une pile qui refuse de démarrer pour une raison
    // que l'outil aurait inventée lui-même.
    expect(valeurs.get("WEB_BIND_IP")).toBe("");
    expect(valeurs.get("TURN_BIND_IP")).toBe("");
    expect(actionDe("WEB_BIND_IP")).toBe("laissé vide");
  });

  it("dérive le domaine TURN du domaine donné", () => {
    expect(valeurs.get("TURN_DOMAIN")).toBe("turn.chat.tacita.fr");
  });

  it("rend compte de chaque clé, y compris celles qu'elle n'a pas touchées", () => {
    expect(actionDe("SYNAPSE_MACAROON_SECRET_KEY")).toBe("généré");
    expect(actionDe("SERVER_NAME")).toBe("renseigné");
    expect(actionDe("SYNAPSE_IP_RANGE_WHITELIST")).toBe("conservé");
  });

  it("ne divulgue aucun secret dans son compte rendu", () => {
    // Un rapport qui s'affiche à l'écran, se copie dans un ticket et finit dans un
    // historique de shell n'a aucune raison de porter les secrets qu'il vient de poser.
    const secret = valeurs.get("SYNAPSE_MACAROON_SECRET_KEY")!;
    for (const { apercu } of modifications) expect(apercu).not.toContain(secret);
  });

  it("tire un secret différent pour chaque variable", () => {
    const secrets = ["POSTGRES_PASSWORD", "SYNAPSE_FORM_SECRET", "SYNAPSE_MACAROON_SECRET_KEY"].map(
      (cle) => valeurs.get(cle),
    );
    expect(new Set(secrets).size).toBe(secrets.length);
  });
});

describe("la relance, qui ne doit rien casser de ce qui tourne déjà", () => {
  it("aucun secret déjà posé n'est régénéré", () => {
    // Régénérer un macaroon invalide toutes les sessions ouvertes ; régénérer la clé
    // KMS rend les médias déjà stockés illisibles. La relance doit être sans effet.
    const premier = planifier(EXEMPLE, REPONSES).contenu;
    const second = planifier(premier, REPONSES).contenu;
    expect(second).toBe(premier);
  });

  it("le compte rendu d'une relance ne dit que « conservé »", () => {
    const premier = planifier(EXEMPLE, REPONSES).contenu;
    const { modifications } = planifier(premier, REPONSES);
    const actions = new Set(modifications.map((m) => m.action));
    expect(actions).toEqual(new Set(["conservé", "laissé vide"]));
  });

  it("un fichier à moitié rempli ne voit compléter que ce qui manque", () => {
    const partiel = EXEMPLE.replace("POSTGRES_PASSWORD=change-me", "POSTGRES_PASSWORD=déjà-posé");
    const { contenu, modifications } = planifier(partiel, REPONSES);
    expect(lireEnv(contenu).get("POSTGRES_PASSWORD")).toBe("déjà-posé");
    expect(modifications.find((m) => m.cle === "POSTGRES_PASSWORD")?.action).toBe("conservé");
    expect(modifications.find((m) => m.cle === "SYNAPSE_FORM_SECRET")?.action).toBe("généré");
  });

  it("un SERVER_NAME réel n'est jamais remplacé, même par un autre domaine", () => {
    // Le changer abandonnerait le homeserver : chaque identifiant Matrix le porte.
    const pose = EXEMPLE.replace("SERVER_NAME=chat.example.org", "SERVER_NAME=chat.deja.fr");
    const { contenu } = planifier(pose, { domaine: "chat.autre.fr", email: REPONSES.email });
    expect(lireEnv(contenu).get("SERVER_NAME")).toBe("chat.deja.fr");
  });
});

describe("la validation des deux réponses, refusée tôt plutôt que payée au certificat", () => {
  it.each([
    [{ domaine: "chat.tacita.fr", email: "adam@tacita.fr" }, undefined],
    [{ domaine: "pas un domaine", email: "adam@tacita.fr" }, /nom de domaine/],
    [{ domaine: "localhost", email: "adam@tacita.fr" }, /nom de domaine/],
    [{ domaine: "chat.example.org", email: "adam@tacita.fr" }, /ne résoudra jamais/],
    [{ domaine: "chat.tacita.fr", email: "pas-une-adresse" }, /e-mail/],
  ])("%o", (reponses, attendu) => {
    const probleme = valider(reponses);
    if (attendu === undefined) expect(probleme).toBeUndefined();
    else expect(probleme).toMatch(attendu);
  });
});

describe("ce que l'outil dit ne pas pouvoir faire", () => {
  it("en production, il nomme le DNS, le certificat et le hook de renouvellement", () => {
    const etapes = resteAFaire("chat.tacita.fr", false).join("\n");
    expect(etapes).toContain("enregistrements A");
    expect(etapes).toContain("certbot");
    expect(etapes).toContain("renewal-hooks");
    expect(etapes).toContain("call.chat.tacita.fr");
  });

  it("en développement, il nomme le fichier hosts et le certificat auto-signé", () => {
    const etapes = resteAFaire("chat.example.org", true).join("\n");
    expect(etapes).toContain("hosts");
    expect(etapes).toContain("generate-dev-certs.sh");
    expect(etapes).not.toContain("certbot");
  });
});
