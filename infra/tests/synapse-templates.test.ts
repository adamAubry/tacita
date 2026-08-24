import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

/**
 * REQ-INF-09 — les gabarits que Synapse rend lui-même.
 *
 * Ces pages ne passent par **aucun** des garde-fous du shard : ni typecheck, ni jsdom, ni
 * Astryx. Elles sont du Jinja lu par un serveur Python, et l'interdit n°12 ferme la porte
 * au navigateur piloté qui seul les rendrait. Tout ce qui est vérifiable ici l'est donc
 * de façon **structurelle** : on lit la source, on lit son site de lecture, et on assert
 * que les deux se correspondent (règle 7).
 *
 * Ce que ce fichier ne prouve pas, et qu'il ne faut pas lui faire dire : que les pages
 * s'affichent correctement. Il prouve qu'elles portent ce dont d'autres dépendent, et que
 * leurs couleurs ne dérivent pas de DESIGN.md en silence.
 */

const ici = (chemin: string) => new URL(chemin, import.meta.url);
const lire = (chemin: string) => readFileSync(ici(chemin), "utf-8");

/**
 * La source **moins ses commentaires Jinja**, c'est-à-dire ce que la page rend vraiment.
 *
 * Les `{# … #}` de ces gabarits expliquent longuement ce qui a été retiré des versions
 * d'origine et pourquoi — ils citent donc les formulations refusées. Une assertion sur la
 * copie affichée doit lire la copie affichée : sans ce filtre, le premier test d'honnêteté
 * s'est déclenché sur le commentaire qui justifie l'honnêteté.
 */
const rendu = (chemin: string) => lire(chemin).replace(/\{#[\s\S]*?#\}/g, "");

const homeserver = parse(lire("../synapse/homeserver.yaml.tmpl"));
const compose = parse(lire("../docker-compose.yml"));
const gabarits = readdirSync(ici("../synapse/templates"));

/** Les six pages atteignables dans ce déploiement, et elles seules. */
const PAGES = [
  "sso_redirect_confirm.html",
  "sso_auth_confirm.html",
  "sso_auth_success.html",
  "sso_error.html",
  "sso_account_deactivated.html",
  "sso_auth_bad_user.html",
];

describe("REQ-INF-09 — les gabarits SSO sont branchés et livrés", () => {
  it("Synapse lit le répertoire de gabarits du dépôt", () => {
    expect(homeserver.templates?.custom_template_directory).toBe("/conf/templates");
  });

  it("le compose monte ce répertoire à l'emplacement que la config nomme", () => {
    // La config et le montage sont deux fichiers distincts : c'est très exactement le
    // genre de jonction qui casse sans que personne ne le voie (règle 1).
    const volumes: string[] = compose.services.synapse.volumes;
    expect(volumes).toContain("./synapse/templates:/conf/templates:ro");
  });

  it("les six pages atteignables sont présentes, avec leur coquille", () => {
    for (const page of PAGES) expect(gabarits).toContain(page);
    expect(gabarits).toContain("_base.html");
    expect(gabarits).toContain("style.css");
  });

  it("aucun gabarit mort n'est livré", () => {
    /*
     * Un gabarit qu'aucun chemin n'atteint est du code que personne ne relit et que
     * personne ne verra rougir. Les autres pages de Synapse sont éteintes par la
     * configuration (ni email, ni account_validity, ni captcha, ni user_consent, un seul
     * fournisseur OIDC) : les surcharger donnerait six fichiers de plus à maintenir pour
     * des écrans que ce déploiement ne sert jamais.
     */
    expect(gabarits.sort()).toEqual([...PAGES, "_base.html", "style.css"].sort());
  });
});

describe("REQ-INF-09 — ce dont le shard dépend, page par page", () => {
  it("sso_auth_success rend le signal qu'attend RecoveryStep", () => {
    /*
     * `apps/web/components/onboarding/RecoveryStep.tsx` ne reprend la main que sur
     * `postMessage("authDone")`. Sans cette ligne, la promesse de `confirmerIdentite` ne
     * se résout jamais : l'étape reste figée, la sauvegarde déjà remplacée côté serveur
     * et l'identité, non — un compte qui ne chiffre plus, sans message d'erreur.
     */
    const source = lire("../synapse/templates/sso_auth_success.html");
    expect(source).toContain('window.opener.postMessage("authDone", "*")');
  });

  it("les deux pages à bouton portent l'URL de reprise", () => {
    // `redirect_url` porte le jeton de connexion sur `sso_redirect_confirm`, et la reprise
    // de l'UIA sur `sso_auth_confirm`. Une page sans ce lien est un cul-de-sac.
    for (const page of ["sso_redirect_confirm.html", "sso_auth_confirm.html"]) {
      expect(lire(`../synapse/templates/${page}`)).toContain("{{ redirect_url }}");
    }
  });

  it("aucune page ne promet une inscription que ce déploiement n'ouvre pas", () => {
    /*
     * Interdit n°13. Le gabarit d'origine de `sso_account_deactivated` propose « try to
     * create a new account », porte que `enable_registration: false` referme.
     *
     * L'assertion porte sur la promesse, pas sur le réglage : `enable_registration` est
     * une discrepance connue, en cours d'arbitrage. Quel que soit son sort, une page
     * d'erreur n'a pas à orienter vers une inscription — elle renvoie à qui peut agir.
     */
    const source = rendu("../synapse/templates/sso_account_deactivated.html");
    expect(source).not.toMatch(/créer un compte|nouveau compte|inscription/i);
  });

  it("chaque page hérite de la coquille, et la coquille est en français", () => {
    for (const page of PAGES) {
      expect(lire(`../synapse/templates/${page}`)).toContain('{% extends "_base.html" %}');
    }
    expect(lire("../synapse/templates/_base.html")).toContain('<html lang="fr">');
  });
});

describe("REQ-INF-09 — les pages sont autoportantes", () => {
  it("aucune requête sortante depuis le parcours d'authentification", () => {
    /*
     * Le `_base.html` d'origine charge un logo depuis matrix.org (ou static.element.io
     * selon `app_name`) : un tiers appelé à chaque rendu d'une page qui porte une session
     * d'authentification. Les nôtres n'embarquent que du texte et du SVG en ligne.
     *
     * Le balayage porte sur tout le répertoire, coquille et feuille comprises : c'est
     * `_base.html` qui portait la fuite, pas les pages.
     */
    for (const fichier of gabarits) {
      const source = lire(`../synapse/templates/${fichier}`);
      expect(source, `${fichier} référence un hôte distant`).not.toMatch(/https?:\/\//);
    }
  });
});

describe("REQ-INF-09 — les couleurs ne dérivent pas de DESIGN.md", () => {
  /*
   * **Le second endroit du dépôt où un hexadécimal de DESIGN.md est recopié**, après
   * `apps/web/components/foundation/palette.ts`, et pour la même raison : un consommateur
   * qui ne sait pas lire une variable CSS du thème. Ici c'est Jinja, hors du bundle Next.
   *
   * Règle 7 : une valeur posée à une jonction que personne ne relit est indétectable.
   * Ce test est le site de lecture. L'union des deux sources est délibérée — `accent-soft`
   * n'existe sous sa forme alpha (`#155E4D14`) que dans `palette.ts`, et `accent-pressed`
   * n'existe que dans DESIGN.md, qu'Astryx dispense le shard de recopier.
   */
  const hex = (source: string) =>
    new Set((source.match(/#[0-9A-Fa-f]{6}(?:[0-9A-Fa-f]{2})?\b/g) ?? []).map((h) => h.toUpperCase()));

  const design = hex(readFileSync(ici("../../DESIGN.md"), "utf-8"));
  const palette = hex(readFileSync(ici("../../apps/web/components/foundation/palette.ts"), "utf-8"));
  const connues = new Set([...design, ...palette]);

  it("chaque couleur de la feuille vient de DESIGN.md ou de palette.ts", () => {
    for (const couleur of hex(lire("../synapse/templates/style.css"))) {
      expect(connues, `${couleur} n'existe dans aucune des deux sources`).toContain(couleur);
    }
  });

  it("la barre système de la coquille est celle du shard", () => {
    /*
     * Les mêmes deux valeurs que `apps/web/app/layout.tsx`, qui les lit dans `PALETTE.bg`.
     * Sans elles, l'encadrement du navigateur change de couleur entre le shard et ces
     * pages — un saut visible sur mobile, et invisible ici sans cette assertion.
     */
    const base = lire("../synapse/templates/_base.html");
    const bg = readFileSync(ici("../../apps/web/components/foundation/palette.ts"), "utf-8")
      .match(/bg:\s*\{\s*clair:\s*"(#[0-9A-Fa-f]{6})",\s*sombre:\s*"(#[0-9A-Fa-f]{6})"/);

    expect(bg, "PALETTE.bg introuvable : le format de palette.ts a changé").toBeTruthy();
    expect(base).toContain(`(prefers-color-scheme: light)" content="${bg![1]}"`);
    expect(base).toContain(`(prefers-color-scheme: dark)" content="${bg![2]}"`);
  });
});
