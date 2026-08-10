import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it } from "vitest";

import { MODE_DEFAUT } from "../app/providers";
import { PALETTE as COULEURS_DESIGN } from "../components/foundation/palette";
import { FAMILLES_CHROMATIQUES, tacitaTheme } from "../components/foundation/theme";
import { ecrireTheme, lireTheme } from "../lib/preferences";
import { sourcesLivrees, sansCommentaires } from "./sources";

const tokens = tacitaTheme.tokens as Record<string, string>;
/** `defineTheme` résout un couple clair/sombre en une valeur `light-dark()`. */
const couple = ({ clair, sombre }: { clair: string; sombre: string }) => `light-dark(${clair}, ${sombre})`;

describe("REQ-UI-03 — le thème porte les valeurs de DESIGN.md, et rien d'autre", () => {
  const { bg, surface, surfaceRaised, hairline, text, textMuted, accent, accentSoft, danger, warning } =
    COULEURS_DESIGN;

  it("chaque token mappé porte la valeur de la table de M-A", () => {
    expect(tokens["--color-background-body"]).toBe(couple(bg));
    expect(tokens["--color-background-surface"]).toBe(couple(surface));
    expect(tokens["--color-background-popover"]).toBe(couple(surfaceRaised));
    expect(tokens["--color-border"]).toBe(couple(hairline));
    expect(tokens["--color-text-primary"]).toBe(couple(text));
    expect(tokens["--color-text-secondary"]).toBe(couple(textMuted));
    expect(tokens["--color-accent"]).toBe(couple(accent));
    expect(tokens["--color-accent-muted"]).toBe(couple(accentSoft));
    expect(tokens["--color-error"]).toBe(couple(danger));
    expect(tokens["--color-warning"]).toBe(couple(warning));
  });

  it("`success` est l'accent : DESIGN.md refuse un second vert", () => {
    expect(tokens["--color-success"]).toBe(tokens["--color-accent"]);
    expect(tokens["--color-success-muted"]).toBe(tokens["--color-accent-muted"]);
  });

  it("`disabled` réutilise le muet plutôt qu'un gris de plus", () => {
    expect(tokens["--color-text-disabled"]).toBe(couple(textMuted));
    expect(tokens["--color-icon-disabled"]).toBe(couple(textMuted));
  });

  /**
   * Le défaut d'Astryx suppose un jaune vif et met du texte sombre dessus. Notre ambre
   * est sombre en clair : sans inversion, le texte d'avertissement est illisible —
   * précisément là où on documente une limite connue (interdit n°13).
   */
  it("le texte sur avertissement est inversé par rapport au défaut d'Astryx", () => {
    expect(tokens["--color-on-warning"]).toBe(couple(COULEURS_DESIGN.surWarning));
  });

  /**
   * Le test que le PM a demandé nommément : un contrôle qui ne vérifierait que l'accent
   * laisserait passer les quarante autres, et le bleu sortirait écran par écran.
   */
  it("les quarante tokens chromatiques sont posés sur les neutres", () => {
    expect(FAMILLES_CHROMATIQUES).toHaveLength(10);
    for (const famille of FAMILLES_CHROMATIQUES) {
      expect(tokens[`--color-background-${famille}`], famille).toBe(couple(surface));
      expect(tokens[`--color-border-${famille}`], famille).toBe(couple(hairline));
      expect(tokens[`--color-icon-${famille}`], famille).toBe(couple(textMuted));
      expect(tokens[`--color-text-${famille}`], famille).toBe(couple(textMuted));
    }
  });

  it("aucune couleur hors palette ne subsiste dans les anneaux inset", () => {
    // Quatre ombres d'Astryx portent des couleurs en dur, dont un bleu : même piège que
    // les familles chromatiques, et il ne se voit qu'au focus ou à la sélection.
    for (const nom of ["hover", "selected", "success", "warning", "error"]) {
      expect(tokens[`--shadow-inset-${nom}`], nom).toMatch(/var\(--color-/);
    }
  });

  it("la géométrie suit DESIGN.md — et `--radius-chat` n'est plus 28px", () => {
    expect(tokens["--radius-element"]).toBe("6px"); // contrôles
    expect(tokens["--radius-container"]).toBe("10px"); // cartes, modals
    expect(tokens["--radius-chat"]).toBe("12px");
    expect(tokens["--radius-chat"]).not.toBe("28px"); // « coins très arrondis », interdit
  });

  it("deux graisses seulement, et la règle est mécanique", () => {
    // Un composant qui demande `medium` ou `bold` retombe sur 400 et 600 : il ne peut
    // plus sortir de la palette typographique, même en le voulant.
    expect(tokens["--font-weight-medium"]).toBe("400");
    expect(tokens["--font-weight-bold"]).toBe("600");
  });

  /**
   * La table de typographie de DESIGN.md, sur les tokens qu'Astryx rend **réellement**.
   *
   * Les `--font-size-*` seuls ne suffisaient pas : les styles de `Text` lisent une
   * seconde famille (`--text-<style>-*`), dérivée une fois pour toutes de l'échelle par
   * défaut d'Astryx, ancrée sur 14 px. Tout le texte de l'app sortait un cran trop petit,
   * et les titres d'écran en 29 px graisse 400 au lieu de 22/28 en 600. Ce test regarde
   * la famille qui décide.
   */
  it("les styles de texte portent les tailles de la table de DESIGN.md", () => {
    // display 22/28/600 — et la graisse, que le défaut d'Astryx laissait à 400.
    expect(tokens["--text-display-3-size"]).toBe("1.375rem");
    expect(tokens["--text-display-3-weight"]).toBe("var(--font-weight-bold)");
    expect(tokens["--text-heading-3-size"]).toBe("1.0625rem"); // title 17
    expect(tokens["--text-body-size"]).toBe("0.9375rem"); // body 15
    expect(tokens["--text-supporting-size"]).toBe("0.8125rem"); // secondary 13
    expect(tokens["--text-label-size"]).toBe("0.9375rem"); // libellés et boutons
    expect(tokens["--text-code-size"]).toBe("0.9375rem"); // mono, au corps du texte
    // Les interlignes de la table, au pixel : 28/22, 24/17, 20/15, 18/13.
    for (const [style, rapport] of [
      ["display-3", 28 / 22],
      ["heading-3", 24 / 17],
      ["body", 20 / 15],
      ["supporting", 18 / 13],
    ] as const) {
      expect(Number(tokens[`--text-${style}-leading`]), style).toBeCloseTo(rapport, 3);
    }
  });

  /**
   * DESIGN.md : « contraste AA vérifié pour chaque paire ». Le texte posé **sur** une
   * couleur pleine est le seul endroit où la palette peut se contredire sans que rien ne
   * le montre — et c'est ce qui était arrivé : blanc sur l'accent sombre (#4FBD96, un vert
   * pâle) tombait à 2,3:1, sur tous les boutons primaires du thème sombre.
   */
  it("le texte posé sur une couleur pleine tient le seuil AA, dans les deux modes", () => {
    const luminance = (hexa: string) => {
      const canal = (i: number) => Number.parseInt(hexa.slice(1 + i * 2, 3 + i * 2), 16) / 255;
      const [r, v, b] = [0, 1, 2].map((i) => {
        const c = canal(i);
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      }) as [number, number, number];
      return 0.2126 * r + 0.7152 * v + 0.0722 * b;
    };
    const contraste = (a: string, b: string) => {
      const [clair, sombre] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
      return (clair + 0.05) / (sombre + 0.05);
    };

    for (const mode of ["clair", "sombre"] as const) {
      for (const [texte, fond] of [
        ["surAccent", "accent"],
        ["surWarning", "warning"],
      ] as const) {
        const ratio = contraste(COULEURS_DESIGN[texte][mode], COULEURS_DESIGN[fond][mode]);
        expect(ratio, `${texte} sur ${fond} en ${mode}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("la pile de polices est celle de DESIGN.md, sans webfont", () => {
    expect(tokens["--font-family-body"]).toMatch(/^system-ui,/);
    expect(tokens["--font-family-code"]).toMatch(/^ui-monospace,/);
    for (const cle of ["--font-family-body", "--font-family-heading", "--font-family-code"]) {
      expect(tokens[cle]).not.toMatch(/url\(|@import/);
    }
  });

  /**
   * DESIGN.md : « aucune valeur hexadécimale dans le code des composants ».
   *
   * Les quatre longueurs, pas seulement six : l'audit impeccable du 07/08/2026 a trouvé
   * un `#000` dans un masque de `ProfileCard`, que la version à `{6}` laissait passer.
   * La forme courte est précisément celle qu'on écrit sans y penser.
   *
   * Commentaires retirés, comme partout ailleurs (`tests/sources.ts`) : « les interdits
   * portent sur ce que le shard exécute, pas sur ce qu'il explique ». Un commentaire qui
   * cite la valeur bannie pour dire de ne pas l'écrire n'est pas une couleur en dur.
   */
  it("aucune couleur en dur hors du fichier de thème", () => {
    for (const { chemin, code } of sourcesLivrees()) {
      if (chemin.endsWith("/palette.ts")) continue;
      expect(sansCommentaires(code).match(/#[0-9a-fA-F]{3,8}\b/g), chemin).toBeNull();
    }
  });
});

describe("REQ-UI-03 — le choix de thème est persisté en IndexedDB", () => {
  it("le défaut est le clair, thème de référence de DESIGN.md", () => {
    expect(MODE_DEFAUT).toBe("light");
  });

  it("un choix écrit se relit à la session suivante", async () => {
    const indexedDB = new IDBFactory();
    expect(await lireTheme(indexedDB)).toBeUndefined();

    await ecrireTheme(indexedDB, "dark");
    expect(await lireTheme(indexedDB)).toBe("dark");

    await ecrireTheme(indexedDB, "system");
    expect(await lireTheme(indexedDB)).toBe("system");
  });

  it("une valeur inattendue en base ne casse pas l'app, elle est ignorée", async () => {
    const indexedDB = new IDBFactory();
    await ecrireTheme(indexedDB, "dark");
    // Ce que laisserait une version future ou une base bricolée à la main.
    const base = await new Promise<IDBDatabase>((resolve) => {
      const requete = indexedDB.open("tacita-ui", 1);
      requete.onsuccess = () => resolve(requete.result);
    });
    const transaction = base.transaction("preferences", "readwrite");
    transaction.objectStore("preferences").put("néon", "theme");
    await new Promise((resolve) => {
      transaction.oncomplete = resolve;
    });
    base.close();

    expect(await lireTheme(indexedDB)).toBeUndefined();
  });

  it("le stockage est IndexedDB, jamais localStorage (interdit n°2)", () => {
    // Commentaires retirés : le module de persistance cite l'interdit qu'il respecte.
    for (const { chemin, code } of sourcesLivrees()) {
      expect(sansCommentaires(code), chemin).not.toMatch(/localStorage|sessionStorage/);
    }
  });
});
