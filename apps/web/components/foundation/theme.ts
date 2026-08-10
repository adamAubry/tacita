import { PALETTE as D, type Couple } from "./palette";
import { defineTheme, type TokenName, type TokenValue } from "./primitives";

/**
 * REQ-UI-03 — le thème Tacita, seul endroit du dépôt où une valeur de DESIGN.md est
 * recopiée. La table de correspondance qui le gouverne est dans `specs/ui/M-A.md` ;
 * toute évolution visuelle passe par DESIGN.md, jamais par une valeur en dur ailleurs.
 *
 * Les valeurs sont des couples `[clair, sombre]`, exactement la forme du tableau de
 * DESIGN.md — et le clair est le thème de référence, le sombre en dérive.
 */
/** Traduit un couple de DESIGN.md dans la forme qu'attend Astryx. */
const t = ({ clair, sombre }: Couple): TokenValue => [clair, sombre];

/**
 * Les dix familles catégorielles d'Astryx, **posées sur les neutres**. DESIGN.md :
 * « aucune autre couleur n'existe ». Sans cette neutralisation, un composant qui atteint
 * une de ces familles rend du bleu ou du rose sans que personne ne l'ait écrit, et
 * l'écart se découvre écran par écran en revue.
 */
const FAMILLES = ["blue", "cyan", "gray", "green", "orange", "pink", "purple", "red", "teal", "yellow"];

const chromatiquesNeutralisees = Object.fromEntries(
  FAMILLES.flatMap((famille) => [
    [`--color-background-${famille}`, t(D.surface)],
    [`--color-border-${famille}`, t(D.hairline)],
    [`--color-icon-${famille}`, t(D.textMuted)],
    [`--color-text-${famille}`, t(D.textMuted)],
  ]),
  // Les noms sont construits, donc opaques au typage. Le test de REQ-UI-03 vérifie que
  // les quarante sont bien posés — c'est lui qui tient ce que le compilateur lâche ici.
) as Partial<Record<TokenName, TokenValue>>;

export const tacitaTheme = defineTheme({
  name: "tacita",
  tokens: {
    ...chromatiquesNeutralisees,

    // — Fonds et surfaces
    "--color-background-body": t(D.bg),
    "--color-background-muted": t(D.bg),
    "--color-background-surface": t(D.surface),
    "--color-background-card": t(D.surface),
    "--color-background-popover": t(D.surfaceRaised),
    "--color-background-inverted": t(D.text),

    // — Filets. DESIGN.md : la profondeur s'exprime d'abord par le filet.
    "--color-border": t(D.hairline),
    "--color-border-emphasized": t(D.hairline),
    "--color-neutral": t(D.hairline),
    "--color-skeleton": t(D.hairline),
    "--color-track": t(D.hairline),

    // — Encre
    "--color-text-primary": t(D.text),
    "--color-icon-primary": t(D.text),
    "--color-text-secondary": t(D.textMuted),
    "--color-icon-secondary": t(D.textMuted),
    // DESIGN.md ne définit aucun token désactivé et interdit toute autre couleur :
    // le désactivé réutilise le muet plutôt que d'inventer un gris de plus.
    "--color-text-disabled": t(D.textMuted),
    "--color-icon-disabled": t(D.textMuted),

    // — L'accent, unique. `success` en fait partie : DESIGN.md refuse un second vert.
    "--color-accent": t(D.accent),
    "--color-icon-accent": t(D.accent),
    "--color-text-accent": t(D.accent),
    "--color-accent-muted": t(D.accentSoft),
    "--color-success": t(D.accent),
    "--color-success-muted": t(D.accentSoft),
    "--color-on-accent": t(D.surAccent),
    "--color-on-success": t(D.surAccent),

    // — États. `on-warning` est **inversé** par rapport au défaut d'Astryx, qui suppose
    // un jaune vif : notre ambre est sombre en clair et clair en sombre. Sans ça, le
    // texte d'avertissement est illisible — précisément là où on documente une limite.
    "--color-error": t(D.danger),
    "--color-error-muted": t(D.dangerSoft),
    "--color-background-error-inverted": t(D.danger),
    "--color-on-error": t(D.surAccent),
    "--color-warning": t(D.warning),
    "--color-warning-muted": t(D.warningSoft),
    "--color-on-warning": t(D.surWarning),

    // — Voiles. Celui-ci est le fond de modale d'Astryx, **pas** le `scrim` de
    // DESIGN.md, qui est un voile de lisibilité clair posé sur un fond d'écran
    // personnalisé : deux usages, deux valeurs, aucune fusion (voir tokens.css).
    "--color-overlay": t(D.voileModale),
    "--color-overlay-hover": t(D.voileSurvol),
    "--color-overlay-pressed": t(D.voilePresse),

    // — Typographie. Pile système, aucune webfont (DESIGN.md) ; `system-ui` en tête,
    // absent du défaut d'Astryx.
    "--font-family-body": ['system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", sans-serif'].join(),
    "--font-family-heading": ['system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", sans-serif'].join(),
    "--font-family-code": ['ui-monospace, "SF Mono", Consolas, monospace'].join(),

    // Deux graisses seulement, et la règle est rendue **mécanique** : un composant qui
    // demande `medium` ou `bold` retombe sur 400 et 600, il ne peut plus en sortir.
    "--font-weight-medium": "400",
    "--font-weight-bold": "600",

    // Tailles de DESIGN.md. `--font-size-lg` vaut déjà 17px : rien à poser pour `title`.
    "--font-size-base": "0.9375rem", // body 15
    "--font-size-sm": "0.8125rem", // secondary 13
    "--font-size-xs": "0.75rem", // caption 12
    "--font-size-xl": "1.375rem", // display 22

    /*
     * **La table de DESIGN.md, posée sur les styles qu'Astryx rend réellement.**
     *
     * Les six `--font-size-*` ci-dessus ne suffisaient pas, et c'est le genre d'écart
     * qu'aucun test de jsdom ne voit : les styles de `Text` ne lisent pas ces variables,
     * ils lisent une seconde famille de tokens (`--text-<style>-*`) que le thème dérive
     * **une fois pour toutes** de l'échelle par défaut d'Astryx — ancrée, elle, sur 14 px.
     * Tout le texte de l'app sortait donc un cran en dessous de DESIGN.md : corps à 14 au
     * lieu de 15, secondaire à 12 au lieu de 13, et les titres d'écran (`display-3`) à
     * **29 px graisse 400** là où la table écrit 22/28 en 600 — `ProfileCard` compensait
     * déjà à la main par un `weight="bold"`.
     *
     * Valeurs littérales et non `var(--font-size-*)` : c'est cette indirection qui avait
     * l'air de marcher sans marcher. Mesuré au navigateur le 10/08/2026.
     *
     * Ici et pas dans les composants : DESIGN.md interdit qu'une valeur visuelle vive
     * ailleurs que dans le thème, et huit écrans corrigés un par un divergeraient au neuvième.
     */
    /*
     * display-large 28/32/600 — le nom sur l'écran profil, et lui seul (DESIGN.md, ajouté
     * le 10/08/2026). Un cran au-dessus des titres d'écran parce que ce n'est pas un
     * titre : c'est le sujet de la page. `display-2` est le barreau d'Astryx qui le porte
     * — sans ces trois tokens il retomberait sur l'échelle par défaut de la bibliothèque,
     * ancrée sur 14 px, et rendrait une taille qui n'est écrite nulle part.
     */
    "--text-display-2-size": "1.75rem",
    "--text-display-2-leading": "1.1429", // 32/28
    "--text-display-2-weight": "var(--font-weight-bold)",
    // display 22/28/600 — titres d'écran
    "--text-display-3-size": "1.375rem",
    "--text-display-3-leading": "1.2727", // 28/22
    "--text-display-3-weight": "var(--font-weight-bold)", // 600, la plus lourde des deux
    // title 17/24/600 — titres de layout
    "--text-heading-3-size": "1.0625rem",
    "--text-heading-3-leading": "1.4118", // 24/17
    // body 15/20/400 — messages, contenu courant
    "--text-body-size": "0.9375rem",
    "--text-body-leading": "1.3333", // 20/15
    // secondary 13/18/400 — aperçus, notes, méta
    "--text-supporting-size": "0.8125rem",
    "--text-supporting-leading": "1.3846", // 18/13
    // Libellés et boutons : le corps courant, pas un quatrième pas d'échelle.
    "--text-label-size": "0.9375rem",
    "--text-label-leading": "1.3333",
    // Mono — user ids et clé de récupération, au corps du texte qui les entoure.
    "--text-code-size": "0.9375rem",
    "--text-code-leading": "1.3333",

    // — Géométrie. `--radius-chat` vaut 28px par défaut : des « coins très arrondis »,
    // interdit explicite de DESIGN.md, et c'est le composer qui le porte.
    "--radius-element": "6px",
    "--radius-container": "10px",
    "--radius-page": "12px",
    "--radius-chat": "12px",

    // — Ombres : un murmure, jamais sans filet. Le sombre s'en passe jusqu'à e3.
    "--shadow-low": ["0px 2px 8px rgba(0, 0, 0, 0.08)", "none"],
    "--shadow-med": ["0px 2px 8px rgba(0, 0, 0, 0.08)", "none"],
    "--shadow-high": ["0px 4px 12px rgba(0, 0, 0, 0.10)", "0px 4px 12px rgba(0, 0, 0, 0.40)"],
    // Les quatre anneaux `inset` d'Astryx portent des couleurs en dur — dont un bleu.
    // Même piège que les familles chromatiques, même traitement.
    "--shadow-inset-hover": "inset 0px 0px 0px 2px var(--color-border)",
    "--shadow-inset-selected": "inset 0px 0px 0px 2px var(--color-accent)",
    "--shadow-inset-success": "inset 0px 0px 0px 2px var(--color-accent)",
    "--shadow-inset-warning": "inset 0px 0px 0px 2px var(--color-warning)",
    "--shadow-inset-error": "inset 0px 0px 0px 2px var(--color-error)",

    // L'espacement d'Astryx est déjà la grille de 4pt de DESIGN.md : rien à poser.
  },
});

export const FAMILLES_CHROMATIQUES = FAMILLES;
