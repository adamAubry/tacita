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

  it("la pile de polices est celle de DESIGN.md, sans webfont", () => {
    expect(tokens["--font-family-body"]).toMatch(/^system-ui,/);
    expect(tokens["--font-family-code"]).toMatch(/^ui-monospace,/);
    for (const cle of ["--font-family-body", "--font-family-heading", "--font-family-code"]) {
      expect(tokens[cle]).not.toMatch(/url\(|@import/);
    }
  });

  /** DESIGN.md : « aucune valeur hexadécimale dans le code des composants ». */
  it("aucune couleur en dur hors du fichier de thème", () => {
    for (const { chemin, code } of sourcesLivrees()) {
      if (chemin.endsWith("/palette.ts")) continue;
      expect(code.match(/#[0-9a-fA-F]{6}\b/g), chemin).toBeNull();
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
