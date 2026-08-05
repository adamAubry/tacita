# M-A — Fondations : shell, thème, navigation, états

**Dépendances : aucune. Premier module. Le spike Astryx/ponytail/impeccable est fait (05/08/2026) — `docs/SPIKE-OUTILLAGE.md`, à lire avant la première ligne : ses trois contraintes de construction sont reprises ci-dessous, et sans elles `next build` échoue. Tout blocage découvert depuis remonte au PM avant contournement.**

## Livrable

Le squelette applicatif complet sur lequel tous les autres modules se posent : routes App Router des 7 layouts (vides), thème, navbar, header, primitives d'état (vide/chargement/erreur/hors ligne), PWA. Conforme à DESIGN.md (tokens, jamais de couleur en dur).

## Exigences

- **REQ-UI-01** — PWA installable : manifest, icônes, service worker limité coquille + assets statiques, zéro donnée utilisateur en cache.
- **REQ-UI-02** — Astryx exclusif ; lint + test `package.json`, **par défaut de refus** sur la liste close de la SPEC 11 : autorisés `@astryxdesign/*`, `@stylexjs/stylex` (exception ratifiée le 05/08/2026), `@tacita/*`, `next` et `react`/`react-dom` ; tout le reste refusé. Et aucun import de `@astryxdesign/core/tailwind-theme.css`.
- **REQ-UI-03** — Thèmes sombre (défaut) et clair via le mécanisme Astryx (`ThemeMode = 'system' | 'light' | 'dark'`, appliqué par attributs de données), tokens de DESIGN.md ; persistance du choix en IndexedDB. **Le flash au premier rendu est assumé** : sans stockage synchrone — l'interdit n°2 ferme localStorage — le mode n'est pas connu avant l'hydratation. Il ne touche que les utilisateurs qui ont choisi l'autre mode que le défaut ; ne pas le contourner. ⚠️ **Contradiction à trancher par le PM** : cette exigence dit « sombre (défaut) », DESIGN.md dit « Clair par défaut » et en fait un de ses quatre principes non négociables. Le code suit DESIGN.md, autorité sur le visuel ; la SPEC 11 ne se prononce pas.
- **REQ-UIX-01** — Navbar (composant 4) : `@astryxdesign/core/NavIcon` × 4 (Accueil, Recherche, Mentions, Profil), fixée en bas, icônes seules, bouton actif légèrement surélevé (feedback UX). Navigation sans rechargement.
- **REQ-UIX-02** — Layout header (composant 6) : `@astryxdesign/core/Toolbar`, titre centré, retour à gauche (historique de navigation, pas de route codée en dur).
- **REQ-UIX-03** — Placeholder (composant 20) : état vide soigné et centré — illustration/icône + texte expliquant pourquoi c'est vide + action suivante si pertinente. Un seul composant paramétrable pour toute l'app.
- **REQ-UIX-04** — Primitives Skeleton pour tout contenu en attente de données (consommées par C, D, F, G) ; et bandeau d'état de connexion (REQ-UI-17, partie bandeau) branché sur l'état de sync de la Session.
- **REQ-UIX-05** — Primitives partagées : Component selector (composant 1, `SegmentedControl` fond fondu), Dropdown menu (composant 2, icône à gauche), Buttons list (composant 7), base Search bar (composant 8, `PowerSearch` sans tokens — les tokens sont configurés par M-F), modal/bottom-sheet standard.

## Correspondance DESIGN.md → thème Astryx

DESIGN.md définit **16 tokens avec son vocabulaire** ; Astryx en expose **79 de couleur avec
le sien**, plus les familles typographie, rayon, ombre et espacement. La table ci-dessous est
le contrat entre les deux. Elle s'écrit **une fois**, dans un `defineTheme` — les valeurs
acceptent le couple `[clair, sombre]`, exactement la forme du tableau de DESIGN.md.

DESIGN.md reste la source visuelle et garde son vocabulaire ; **cette table est le seul
endroit du dépôt où les deux se rencontrent**, et le seul où une valeur hexadécimale de
DESIGN.md est recopiée.

### Couleurs — ce qui se mappe

| DESIGN.md | Tokens Astryx à poser |
|---|---|
| `bg` | `--color-background-body`, `--color-background-muted` |
| `surface` | `--color-background-surface`, `--color-background-card` |
| `surface-raised` | `--color-background-popover` |
| `hairline` | `--color-border`, `--color-border-emphasized`, `--color-neutral`, `--color-skeleton`, `--color-track` |
| `text` | `--color-text-primary`, `--color-icon-primary`, `--color-background-inverted` |
| `text-muted` | `--color-text-secondary`, `--color-icon-secondary`, **et** `--color-text-disabled`/`--color-icon-disabled` |
| `accent` | `--color-accent`, `--color-icon-accent`, `--color-text-accent`, **et `--color-success`** |
| `accent-soft` | `--color-accent-muted`, `--color-success-muted` |
| `danger` | `--color-error`, `--color-background-error-inverted` ; `--color-error-muted` en `danger` à 20 % |
| `warning` | `--color-warning` ; `--color-warning-muted` en `warning` à 20 % |

Trois décisions portées par cette table, à ne pas défaire sans amender DESIGN.md :

- **`success` = `accent`.** DESIGN.md l'exige (« pas de second vert »). Astryx livre un vert
  d'état distinct ; il est écrasé.
- **`disabled` = `text-muted`.** DESIGN.md ne définit pas de token désactivé et interdit toute
  autre couleur. Inventer un gris serait une couleur de plus ; on réutilise le muet. Cohérent
  avec « pas d'option grisée sans explication » — le désactivé doit rester rare.
- **`--color-on-warning` doit être inversé.** Le défaut d'Astryx est du texte sombre, parce que
  son `warning` est un jaune vif. Le nôtre est un ambre **sombre** en clair (#9A6A00) et clair
  en sombre : il faut `[#FFFFFF, #1A1D1C]`, sinon le texte d'avertissement est illisible.
  `--color-on-accent` reste blanc, l'accent étant profond dans les deux modes.

### Couleurs — les trois orphelins

`accent-pressed`, `highlight` et `scrim` **n'ont aucun logement chez Astryx**. Ils vivent en
variables Tacita, déclarées au même endroit que le thème et consommées par nos composants
composés uniquement. Là où un composant Astryx a besoin de l'état pressé, il passe par un
`components:` override, pas par une valeur en dur.

Attention au faux ami : `--color-overlay` d'Astryx est le **voile de modale**, pas le `scrim`
de DESIGN.md, qui est un voile de lisibilité **clair** posé sur un fond d'écran personnalisé.
Deux usages, deux valeurs, aucune fusion.

### Les 40 tokens chromatiques — à épingler, sinon ils sortent

Astryx livre dix familles catégorielles (`blue`, `cyan`, `gray`, `green`, `orange`, `pink`,
`purple`, `red`, `teal`, `yellow` × `background`/`border`/`icon`/`text`). DESIGN.md dit
« **aucune autre couleur n'existe** ». **Les quarante sont posés sur les neutres** :
`background-*` → `surface`, `border-*` → `hairline`, `icon-*`/`text-*` → `text-muted`.

Sans cela, un composant qui atteint une famille catégorielle rend du bleu ou du rose sans que
personne ne l'ait écrit — et l'écart DESIGN.md se découvre écran par écran, en revue.

**Même piège dans les ombres :** `--shadow-inset-selected`, `-success`, `-warning` et `-error`
portent des couleurs en dur (dont un bleu `rgba(1,113,227,.5)`). À reposer sur `accent`,
`accent`, `warning` et `danger`.

### Typographie, rayons, ombres, espacement

| Famille | Ce qu'il faut poser |
|---|---|
| Familles | `--font-family-body` et `--font-family-heading` = la pile de DESIGN.md (`system-ui` en tête, absent du défaut Astryx) ; `--font-family-code` = la pile mono (`ui-monospace` en tête) |
| Graisses | **`--font-weight-medium` = 400 et `--font-weight-bold` = 600.** Écraser les deux graisses que DESIGN.md n'a pas rend la règle « deux graisses seulement » mécanique : un composant qui demande *bold* obtient 600, il ne peut plus sortir de la palette typographique |
| Tailles | `base` = 15 px (défaut 14), `sm` = 13, `xs` = 12, `xl` = 22. `--font-size-lg` vaut déjà 17 px — rien à faire pour `title` |
| Rayons | `--radius-element` = 6 (contrôles), `--radius-container` = 10 (cartes, modals), `--radius-page` **et `--radius-chat`** = 12. ⚠️ **Le défaut `--radius-chat` est 28 px** — « coins très arrondis », interdit explicite de DESIGN.md. C'est le composer qui le porte : ne pas l'oublier |
| Ombres | `--shadow-low`/`-med`/`-high` sur les niveaux e2/e3 de DESIGN.md (0 2 8 à 8 %, 0 4 12 à 10 % clair / 40 % sombre). Les défauts sont plus lourds — l'ombre est un murmure |
| Espacement | **Rien à faire.** Astryx est déjà sur une grille de 4 pt (`--spacing-1` = 4px … `--spacing-12` = 48px), elle coïncide avec DESIGN.md |

### Ce que le test doit garder

Une describe `REQ-UI-03` : le thème rendu porte les valeurs de DESIGN.md sur les tokens
mappés ; **aucune famille chromatique ne rend une couleur hors palette** ; `--radius-chat`
ne vaut pas 28 px. Un test de couleur qui ne vérifie que l'accent laisserait passer les
quarante autres.

## Contraintes

- **Les trois contraintes de construction du spike.** Sans elles, `next build` échoue — ce
  sont des faits, pas des préférences :
  1. **jamais le barrel `@astryxdesign/core`** — il casse la compilation (*« unsupported to
     use "export \*" in a client boundary »*). Toujours le sous-chemin :
     `@astryxdesign/core/Toolbar`. C'était déjà la notation des REQ-UIX ; c'est maintenant
     obligatoire ;
  2. **le `Theme` d'Astryx s'enveloppe dans un composant `"use client"` du shard.** Posé
     directement dans le layout racine, il fait échouer le rendu serveur
     (`defineSyntaxTheme` appelé côté serveur) ;
  3. **le cœur n'embarque aucune palette.** Soit un paquet `@astryxdesign/theme-*`, soit
     un `defineTheme` à nous — c'est le second : la table de correspondance ci-dessus
     impose de toute façon presque tous les tokens, et une palette de départ qu'on
     écrase entièrement serait une dépendance pour rien. *(Le compte-rendu du spike
     annonçait un paquet **requis** ; c'était une inférence, pas une mesure. `defineTheme`
     fonctionne sans `extends`, vérifié le 05/08/2026 en construisant l'app.)*
- **Raccorder `apps/web` au `typecheck` de la racine en créant le projet.** Le script de
  `package.json` énumère les projets `tsc -p` un par un : un projet absent de cette liste
  n'est pas typechecké, et les hooks pré-commit passent au vert sans l'avoir lu. Aucun
  garde ne peut le rappeler — `specs/00-conventions.md` rejette les tests sans ID
  d'exigence, et ce point n'en porte pas.
- Chaque primitive rend correctement dans les deux thèmes (test sur les deux).
- Cibles tactiles ≥ 44 px ; safe-areas iOS en standalone.
- Aucun état vide « brut » ailleurs dans l'app : tout passe par REQ-UIX-03.

## Hors scope

Tout contenu d'écran (modules B–I). Toute logique métier.

## Objectif mesurable

Vitest + Testing Library, une describe par REQ : REQ-UI-01 (précache SW sans entrée de données) ; REQ-UI-03 (bascule thème → persistance IndexedDB, réhydratation) ; REQ-UIX-01 (bouton actif porte l'état surélevé ; navigation appelée au tap) ; REQ-UIX-03 (props → illustration + texte + action rendus). Livrable spike : compte-rendu d'une page (compatibilité gestes/PWA/hors ligne d'Astryx) remis au PM.
