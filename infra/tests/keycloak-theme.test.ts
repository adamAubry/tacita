import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

/**
 * REQ-INF-09 — le thème de connexion Keycloak.
 *
 * Même régime que `synapse-templates.test.ts`, et pour la même raison : ces fichiers ne
 * passent par aucun garde-fou du shard. Ce sont des propriétés Java et du CSS lus par un
 * serveur Quarkus. Tout ce qui est vérifiable ici l'est de façon structurelle.
 *
 * Ce que ce fichier ne prouve pas : que Keycloak démarre avec ce thème et le sert. C'est
 * `infra/smoke/` qui s'en charge — la jurisprudence de la règle 4.
 */

const ici = (chemin: string) => new URL(chemin, import.meta.url);
const lire = (chemin: string) => readFileSync(ici(chemin), "utf-8");

const THEME = "../keycloak/themes/tacita/login/";
const proprietes = lire(THEME + "theme.properties");
const css = lire(THEME + "resources/css/tacita.css");
const messages = lire(THEME + "messages/messages_fr.properties");
/**
 * Le dictionnaire **moins ses commentaires**, c'est-à-dire ce qui s'affiche.
 *
 * L'en-tête de ce fichier cite les formulations qu'on a retirées pour expliquer pourquoi
 * — comme les `{# … #}` des gabarits Synapse. Une assertion sur les mots affichés doit
 * lire les mots affichés : sans ce filtre, le test se déclenche sur sa propre explication.
 */
const affiches = messages
  .split("\n")
  .filter((ligne) => !ligne.trimStart().startsWith("#"))
  .join("\n");
const realm = JSON.parse(lire("../keycloak/realm-export.json"));
const compose = parse(lire("../docker-compose.yml"));

describe("REQ-INF-09 — le thème hérite au lieu de recopier", () => {
  it("il étend keycloak.v2 et n'embarque aucun gabarit", () => {
    expect(proprietes).toMatch(/^parent=keycloak\.v2$/m);
    /*
     * **Le cœur du choix.** Un `.ftl` recopié est figé à la version où on l'a pris ;
     * Keycloak fait évoluer ses formulaires (champs de profil, passkeys, sélecteur
     * d'authentifiant) sans que rien ne signale la divergence. Tant que ce répertoire
     * n'en contient aucun, un bump ne peut pas nous laisser un formulaire d'une version
     * dans une page d'une autre.
     */
    const fichiers = readdirSync(ici(THEME), { recursive: true }) as string[];
    expect(fichiers.filter((f) => f.endsWith(".ftl"))).toEqual([]);
  });

  it("la feuille du parent est reprise avant la nôtre", () => {
    // `styles` remplace la valeur du parent au lieu de s'y ajouter : oublier
    // `css/styles.css` fait perdre toute la mise en page de keycloak.v2, sans erreur.
    expect(proprietes).toMatch(/^styles=css\/styles\.css css\/tacita\.css$/m);
  });
});

describe("REQ-INF-09 — le realm sélectionne le thème, et parle français", () => {
  it("loginTheme pointe le thème livré", () => {
    expect(realm.loginTheme).toBe("tacita");
  });

  it("l'en-tête de la carte porte le nom du produit", () => {
    // `template.ftl` rend `msg("loginTitleHtml", realm.displayNameHtml)` : sans cette
    // valeur, l'en-tête est vide et la page perd sa seule marque.
    expect(realm.displayNameHtml).toBe("Tacita");
  });

  it("les écrans sont en français, comme le shard", () => {
    /*
     * Sans i18n, Keycloak sert ses pages en anglais à l'intérieur d'une application dont
     * le `<html lang>` est `fr`. C'est le premier signe qu'on a changé de maison — avant
     * même les couleurs.
     */
    expect(realm.internationalizationEnabled).toBe(true);
    expect(realm.defaultLocale).toBe("fr");
    expect(realm.supportedLocales).toContain("fr");
  });

  it("le compose monte le thème là où Keycloak le cherche", () => {
    const volumes: string[] = compose.services.keycloak.volumes;
    expect(volumes).toContain("./keycloak/themes/tacita:/opt/keycloak/themes/tacita:ro");
  });
});

describe("REQ-INF-09 — le sombre survit à l'ordre de chargement", () => {
  it("les valeurs sombres passent par :root.pf-v5-theme-dark", () => {
    /*
     * **Le piège de spécificité, tenu par un test.** Keycloak pose `pf-v5-theme-dark` sur
     * `<html>` en JavaScript. `:root` et `.pf-v5-theme-dark` ont la même spécificité, et
     * notre feuille est chargée *après* PatternFly : un `:root` de notre côté écraserait
     * le thème sombre de PatternFly par simple ordre de cascade, et la page resterait
     * claire sur un système sombre. `:root.pf-v5-theme-dark` passe devant les deux.
     *
     * Rien à l'écran ne dirait que c'est cassé — d'où ce test (règle 7).
     */
    expect(css).toContain(":root.pf-v5-theme-dark");
    expect(css).not.toMatch(/@media\s*\(prefers-color-scheme/);
  });
});

describe("REQ-INF-09 — les mots sont ceux du produit", () => {
  it("aucune excuse, aucun « veuillez », aucun « courriel »", () => {
    /*
     * Les trois défauts du bundle d'origine. `errorTitle` valait « Nous sommes
     * désolés... » : PRODUCT.md refuse l'excuse, un écran d'erreur nomme ce qui s'est
     * passé. Le reste est du vouvoiement et du vocabulaire daté dans un produit qui tutoie.
     */
    expect(affiches).not.toMatch(/désolé/i);
    expect(affiches).not.toMatch(/veuillez/i);
    expect(affiches).not.toMatch(/courriel/i);
  });

  it("le titre d'erreur nomme l'événement, comme les pages Synapse", () => {
    expect(affiches).toMatch(/^errorTitle=La connexion a échoué$/m);
  });
});

describe("REQ-INF-09 — les couleurs ne dérivent pas de DESIGN.md", () => {
  /*
   * Troisième et dernier endroit du dépôt où un hexadécimal de DESIGN.md est recopié,
   * après `palette.ts` et les gabarits Synapse. Même jonction, même site de lecture.
   */
  const hex = (source: string) =>
    new Set((source.match(/#[0-9A-Fa-f]{6}(?:[0-9A-Fa-f]{2})?\b/g) ?? []).map((h) => h.toUpperCase()));

  const connues = new Set([
    ...hex(readFileSync(ici("../../DESIGN.md"), "utf-8")),
    ...hex(readFileSync(ici("../../apps/web/components/foundation/palette.ts"), "utf-8")),
  ]);

  it("chaque couleur du thème vient de DESIGN.md ou de palette.ts", () => {
    for (const couleur of hex(css)) {
      expect(connues, `${couleur} n'existe dans aucune des deux sources`).toContain(couleur);
    }
  });
});
