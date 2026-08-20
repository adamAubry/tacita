import { statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { PALETTE as COULEURS_DESIGN } from "../components/foundation/palette";
import { lire, RACINE, sansCommentaires, sourcesLivrees } from "./sources";

const sw = lire("public/sw.js");
const manifeste = JSON.parse(lire("public/manifest.webmanifest")) as {
  name: string;
  start_url: string;
  display: string;
  background_color: string;
  theme_color: string;
  icons: { src: string; sizes: string; purpose?: string }[];
};
const paquet = JSON.parse(lire("package.json")) as {
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
};

describe("REQ-UI-01 — PWA installable, service worker de coquille seule", () => {
  it("les couleurs du manifeste sont celles de DESIGN.md", () => {
    // Le manifeste est un JSON statique : il ne peut pas importer le thème. C'est donc
    // le seul endroit où la palette est recopiée, et le seul endroit où elle peut
    // diverger sans que rien ne le dise — d'où ce test.
    expect(manifeste.background_color).toBe(COULEURS_DESIGN.bg.clair);
    expect(manifeste.theme_color).toBe(COULEURS_DESIGN.bg.clair);
  });

  it("le manifeste porte ce qu'une installation exige", () => {
    expect(manifeste.display).toBe("standalone");
    expect(manifeste.start_url).toBe("/");
    expect(manifeste.name).toBe("Tacita");
  });

  it("chaque icône déclarée existe vraiment", () => {
    // Une PWA dont une icône manque n'est pas installable, et le manifeste ne le dit
    // pas : le navigateur échoue en silence.
    expect(manifeste.icons.length).toBeGreaterThanOrEqual(2);
    for (const { src } of manifeste.icons) {
      expect(statSync(join(RACINE, "public", src)).size, `${src} est vide`).toBeGreaterThan(0);
    }
    expect(manifeste.icons.some((i) => i.purpose === "maskable")).toBe(true);
  });

  /**
   * Le critère de la SPEC 11 : « liste des routes précachées du SW : zéro entrée de
   * données ». C'est l'interdit n°8 appliqué au cache — un contenu déchiffré qui y
   * entrerait survivrait à la déconnexion, hors de portée du registre de wipe.
   */
  it("le précache ne contient que des routes de coquille, aucune donnée", () => {
    const liste = /const COQUILLE = \[([^\]]*)\]/.exec(sw)?.[1];
    expect(liste).toBeTruthy();
    const entrees = [...liste!.matchAll(/"([^"]+)"/g)].map(([, valeur]) => valeur);

    expect(entrees.length).toBeGreaterThan(0);
    for (const entree of entrees) {
      // Ni API Matrix, ni média, ni identifiant de salon ou d'événement.
      // `/c` et `/c/infos` sont des coquilles d'écran, pas des salons : depuis le
      // 08/08/2026 le salon voyage en `?room=` (lib/routes.ts) et n'apparaît donc
      // jamais ici. Ce qu'on refuse, ce sont les identifiants — `!salon`, `@compte`,
      // `mxc:` — et toute URL portant une requête.
      expect(entree).not.toMatch(/_matrix|mxc:|\$|!|@|\?/);
      expect(entree).toMatch(/^\//);
    }
  });

  it("seuls les assets versionnés du build peuvent entrer au cache", () => {
    // La condition d'entrée est unique et étroite. L'élargir est exactement ce qui
    // ferait entrer des données utilisateur : le test lit la condition elle-même.
    const condition = /const cachable =([^;]*);/.exec(sw)?.[1];
    expect(condition).toBeTruthy();
    expect(condition).toContain('startsWith("/_next/static/")');
    expect(condition).toContain('requete.method === "GET"');
    expect(condition).toContain("memeOrigine");

    // Et aucune autre branche n'écrit dans le cache.
    expect([...sw.matchAll(/cache\.put\(/g)]).toHaveLength(1);
  });
});

describe("REQ-UI-02 — Astryx exclusif, par défaut de refus", () => {
  // La liste close de la SPEC 11. `@tacita/*` : les paquets 04–10 que le shard compose —
  // ils sont le produit, pas une dépendance de style.
  const AUTORISES = [/^@astryxdesign\//, /^@stylexjs\/stylex$/, /^@tacita\//, /^next$/, /^react(-dom)?$/];
  const STYLE_INTERDIT = /tailwind|bootstrap|shadcn|styled-components|@emotion|stitches|vanilla-extract|sass|less/i;

  it("aucune dépendance de style hors de la liste close", () => {
    const horsListe = Object.keys(paquet.dependencies).filter(
      (nom) => !AUTORISES.some((motif) => motif.test(nom)),
    );
    // Par défaut de refus : une bibliothèque ajoutée demain échoue ici sans avoir eu
    // besoin d'être nommée à l'avance.
    expect(horsListe).toEqual([]);
    for (const nom of [...Object.keys(paquet.dependencies), ...Object.keys(paquet.devDependencies)]) {
      expect(nom).not.toMatch(STYLE_INTERDIT);
    }
  });

  it("le tailwind-theme.css livré par Astryx n'est importé nulle part", () => {
    // Astryx le livre ; l'importer serait Tailwind par la porte de derrière (CLAUDE.md,
    // interdit n°1 et son exception).
    for (const { chemin, code } of sourcesLivrees()) {
      expect(code, chemin).not.toContain("tailwind-theme.css");
    }
  });

  /**
   * La contrainte de construction n°1 du spike, rendue impossible à enfreindre par
   * inadvertance : un seul fichier importe Astryx, et il le fait par sous-chemins. Le
   * barrel casse `next build` — mais seulement au build, longtemps après qu'on l'a écrit.
   */
  it("un seul fichier importe Astryx, et jamais par le barrel", () => {
    // Commentaires retirés : « les interdits portent sur ce que le shard exécute, pas
    // sur ce qu'il explique » (tests/sources.ts). Un composant qui cite `@astryxdesign/…`
    // dans sa docstring pour nommer sa primitive n'importe rien.
    const lues = sourcesLivrees().map(({ chemin, code }) => ({
      chemin,
      code: sansCommentaires(code),
    }));

    const importateurs = lues
      .filter(({ code }) => code.includes("@astryxdesign/"))
      .map(({ chemin }) => chemin.replace(RACINE, ""));

    // Deux, et deux seulement : le module de primitives, et la feuille de style globale
    // que Next exige dans le layout racine.
    expect(importateurs.sort()).toEqual([
      "/app/layout.tsx",
      "/components/foundation/primitives.ts",
    ]);
    const layout = lues.find(({ chemin }) => chemin.endsWith("/app/layout.tsx"))!.code;
    expect(layout.match(/@astryxdesign\/[^"']+/g)).toEqual(["@astryxdesign/core/astryx.css"]);

    for (const { chemin, code } of lues) {
      // `from "@astryxdesign/core"` nu — le sous-chemin, lui, a toujours un `/` après.
      expect(code, chemin).not.toMatch(/from ["']@astryxdesign\/core["']/);
    }
  });

  /**
   * La contrainte n°2, dans l'autre sens. `theme.ts` appelle `defineTheme()`, une fonction
   * **client** : un composant serveur qui l'importe fait échouer `next build`, et seulement
   * le build. C'est arrivé en écrivant M-A — le layout racine voulait la couleur de la
   * barre système. La palette a été sortie dans un module sans aucun import ; ce test garde
   * la séparation, que rien d'autre ne rappellerait avant le prochain build.
   */
  it("aucun composant serveur n'importe le thème — la palette est là pour ça", () => {
    for (const { chemin, code } of sourcesLivrees()) {
      if (chemin.endsWith("/theme.ts")) continue;
      if (!/from ["'][./]*theme["']/.test(code)) continue;
      expect(code.startsWith('"use client"'), `${chemin} importe le thème sans être client`).toBe(
        true,
      );
    }
  });
});

/**
 * REQ-MED-08 (b) — **les bornes du service worker sont la phase, pas un détail.**
 *
 * Il n'y a qu'un worker par portée : celui qui sert les médias **est** celui du push,
 * réveillé hors de toute page. La note de conception D-10 prévoyait une table de clés en
 * mémoire, vide à froid, que le handler `push` ne lit jamais. La forme retenue est plus
 * forte : il n'y a **pas de table**, parce qu'il n'y a pas de clés — le worker demande les
 * octets à une fenêtre vivante, qui vérifie et déchiffre.
 *
 * Sans ces tests, ces bornes ne seraient qu'un commentaire.
 */
describe("REQ-MED-08 (b) — le service worker sert des plages sans jamais détenir de clé", () => {
  const source = sansCommentaires(sw);

  it("aucune clé, aucun déchiffrement, aucune empreinte dans le worker", () => {
    for (const interdit of ["crypto.subtle", "decrypt", "importKey", "AES-CTR", "digest"]) {
      expect(source, interdit).not.toContain(interdit);
    }
  });

  it("un worker démarré à froid n'a personne à qui demander, et ne sert rien", () => {
    // `matchAll` puis « aucune fenêtre ⇒ null ⇒ 404 » : c'est toute la borne. Un push
    // réveille le worker sans client contrôlé ; la chaîne s'arrête au premier maillon.
    expect(source).toContain("self.clients.matchAll");
    expect(source).toMatch(/if \(!fenetre\) return null;/);
    expect(source).toMatch(/if \(!reponse \|\| reponse\.erreur \|\| !reponse\.octets\)/);
    expect(source).toContain('status: 404');
  });

  it("le handler `push` ne touche pas au chemin média", () => {
    const pousse = source.slice(source.indexOf('addEventListener("push"'));
    expect(pousse).not.toContain("PREFIXE_MEDIA");
    expect(pousse).not.toContain("TYPE_PLAGE");
  });

  it("le clair déchiffré n'entre dans aucun cache", () => {
    // Interdit n°8. Le chemin média rend avant toute considération de cache, et sa réponse
    // porte `no-store` pour que le navigateur ne le fasse pas non plus.
    const debut = source.indexOf("function servirMedia");
    const media = source.slice(debut, source.indexOf("self.addEventListener", debut));
    expect(media).not.toContain("caches");
    expect(media).toContain('"cache-control": "no-store"');
    // Et la condition de mise en cache, elle, n'a pas bougé : `/_next/static/` seulement.
    expect(source).toContain('url.pathname.startsWith("/_next/static/")');
  });

  it("les plages demandées sont bornées, jamais devinées", () => {
    // Une requête sans en-tête `Range` ne doit pas faire servir un fichier entier par
    // surprise : le défaut est le premier bloc.
    expect(source).toContain("plageDemandee");
    expect(source).toMatch(/\^bytes=/);
  });
});
