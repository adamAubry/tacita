import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

/**
 * REQ-INF-09 — **l'authentification sans e-mail.**
 *
 * Décision produit : aucune adresse e-mail n'est collectée ni requise. Ce fichier garde
 * les quatre conséquences de ce choix, dont trois sont invisibles à l'exécution — un
 * champ redevenu obligatoire, un lien de réinitialisation qui réapparaît ou un flux de
 * connexion débranché ne produisent aucune erreur, seulement un formulaire différent.
 *
 * Ce qu'il ne prouve pas : que Keycloak applique cette configuration. `--import-realm`
 * ignore un realm déjà existant, en silence — voir `infra/smoke/theme-keycloak.sh`.
 */

const ici = (c: string) => new URL(c, import.meta.url);
const lire = (c: string) => readFileSync(ici(c), "utf-8");

const realm = JSON.parse(lire("../keycloak/realm-export.json"));
const homeserver = parse(lire("../synapse/homeserver.yaml.tmpl"));
const messages = lire("../keycloak/themes/tacita/login/messages/messages_fr.properties");

/** Le profil utilisateur voyage dans le realm sous forme de JSON encodé en chaîne. */
const profil = JSON.parse(
  realm.components["org.keycloak.userprofile.UserProfileProvider"][0].config["kc.user.profile.config"][0],
);
const attribut = (nom: string) => profil.attributes.find((a: { name: string }) => a.name === nom);

describe("REQ-INF-09 — aucune adresse e-mail n'est demandée", () => {
  it("le profil ne porte plus ni prénom ni nom", () => {
    // Trois champs étaient obligatoires sans qu'aucun consommateur ne les lise : Synapse
    // dérive tout de `preferred_username`. Collecter ce que personne ne lit est du stockage
    // de données personnelles sans contrepartie.
    expect(profil.attributes.map((a: { name: string }) => a.name)).toEqual(["username", "email"]);
  });

  it("l'e-mail n'est ni obligatoire ni visible par l'utilisateur", () => {
    /*
     * `email` est le seul attribut que Keycloak refuse de supprimer (« The attribute
     * 'email' can not be removed ») : c'est un attribut racine. Il reste donc déclaré,
     * mais sans obligation et sans permission utilisateur — ce qui le retire de tous les
     * formulaires. C'est la forme la plus proche de la suppression que Keycloak autorise.
     */
    expect(attribut("email").required).toBeUndefined();
    expect(attribut("email").permissions).toEqual({ view: ["admin"], edit: ["admin"] });
  });

  it("Synapse ne demande jamais la portée e-mail", () => {
    // La jonction avec l'autre moitié du déploiement : un `email` ajouté ici referait
    // entrer l'adresse par la porte OIDC, sans que la config Keycloak ne bouge.
    expect(homeserver.oidc_providers[0].scopes).toEqual(["openid", "profile"]);
  });

  it("aucune réinitialisation par e-mail n'est proposée", () => {
    /*
     * Interdit n°13. Sans `smtpServer`, « Mot de passe oublié » menait à un écran
     * annonçant un e-mail que rien n'envoyait. La porte se retire, elle ne se reformule pas.
     */
    expect(realm.resetPasswordAllowed).toBe(false);
    expect(realm.smtpServer).toBeUndefined();
  });
});

describe("REQ-INF-09 — trois façons d'entrer, aucune par e-mail", () => {
  const flux = (alias: string) =>
    realm.authenticationFlows.find((f: { alias: string }) => f.alias === alias);

  it("le realm utilise le flux de connexion du produit", () => {
    expect(realm.browserFlow).toBe("tacita-browser");
    expect(flux("tacita-browser")).toBeTruthy();
  });

  it("l'identifiant vient d'abord, le facteur ensuite", () => {
    // C'est ce découpage qui rend le choix possible : tant que le mot de passe est sur le
    // même écran que l'identifiant, aucun autre facteur ne peut être proposé.
    const formulaires = flux("tacita-formulaires").authenticationExecutions;
    expect(formulaires[0].authenticator).toBe("auth-username-form");
    expect(formulaires[0].requirement).toBe("REQUIRED");
    expect(formulaires[1].flowAlias).toBe("tacita-facteurs");
  });

  it("clé d'accès, mot de passe et code de secours sont interchangeables", () => {
    const facteurs = flux("tacita-facteurs").authenticationExecutions;
    expect(facteurs.map((e: { authenticator: string }) => e.authenticator)).toEqual([
      "webauthn-authenticator-passwordless",
      "auth-password-form",
      "auth-recovery-authn-code-form",
    ]);
    // ALTERNATIVE et non REQUIRED : c'est ce qui fait qu'un seul suffit.
    for (const e of facteurs) expect(e.requirement).toBe("ALTERNATIVE");
  });

  it("les actions requises que la récupération sans e-mail exige sont enregistrées", () => {
    /*
     * Le realm déclarait explicitement `requiredActions`, ce qui **remplace** la liste par
     * défaut de Keycloak : `UPDATE_PASSWORD` n'était pas enregistrée, et un mot de passe
     * temporaire posé par l'administrateur ne pouvait donc forcer aucun changement.
     */
    const alias = realm.requiredActions.map((a: { alias: string }) => a.alias);
    expect(alias).toContain("UPDATE_PASSWORD");
    expect(alias).toContain("CONFIGURE_RECOVERY_AUTHN_CODES");
  });
});

describe("REQ-INF-09 — « récupération » désigne une seule chose", () => {
  it("les codes Keycloak sont des codes de secours, jamais de récupération", () => {
    /*
     * Collision de noms, pas préférence de style : Tacita appelle « clé de récupération »
     * le secret qui déchiffre l'historique Matrix. Deux secrets affichés une fois,
     * recopiés à la main, aux conséquences opposées, ne peuvent pas porter le même nom.
     */
    const affiches = messages
      .split("\n")
      .filter((l) => !l.trimStart().startsWith("#") && l.includes("="))
      .map((l) => l.split("=").slice(1).join("="))
      .join("\n");
    expect(affiches).not.toMatch(/codes? de récupération/i);
    expect(messages).toMatch(/^auth-recovery-code-prompt=Code de secours #\{0\}$/m);
  });
});
