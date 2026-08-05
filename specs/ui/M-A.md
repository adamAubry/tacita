# M-A — Fondations : shell, thème, navigation, états

**Dépendances : aucune. Premier module ; inclut le spike Astryx/ponytail/impeccable d'une journée (SPEC 11) — tout blocage remonte au PM avant contournement.**

## Livrable

Le squelette applicatif complet sur lequel tous les autres modules se posent : routes App Router des 7 layouts (vides), thème, navbar, header, primitives d'état (vide/chargement/erreur/hors ligne), PWA. Conforme à DESIGN.md (tokens, jamais de couleur en dur).

## Exigences

- **REQ-UI-01** — PWA installable : manifest, icônes, service worker limité coquille + assets statiques, zéro donnée utilisateur en cache.
- **REQ-UI-02** — Astryx exclusif ; lint + test package.json (aucune dépendance interdite).
- **REQ-UI-03** — Thèmes sombre (défaut) et clair via le mécanisme Astryx, tokens de DESIGN.md ; persistance du choix en IndexedDB.
- **REQ-UIX-01** — Navbar (composant 4) : `@astryxdesign/core/NavIcon` × 4 (Accueil, Recherche, Mentions, Profil), fixée en bas, icônes seules, bouton actif légèrement surélevé (feedback UX). Navigation sans rechargement.
- **REQ-UIX-02** — Layout header (composant 6) : `@astryxdesign/core/Toolbar`, titre centré, retour à gauche (historique de navigation, pas de route codée en dur).
- **REQ-UIX-03** — Placeholder (composant 20) : état vide soigné et centré — illustration/icône + texte expliquant pourquoi c'est vide + action suivante si pertinente. Un seul composant paramétrable pour toute l'app.
- **REQ-UIX-04** — Primitives Skeleton pour tout contenu en attente de données (consommées par C, D, F, G) ; et bandeau d'état de connexion (REQ-UI-17, partie bandeau) branché sur l'état de sync de la Session.
- **REQ-UIX-05** — Primitives partagées : Component selector (composant 1, `SegmentedControl` fond fondu), Dropdown menu (composant 2, icône à gauche), Buttons list (composant 7), base Search bar (composant 8, `PowerSearch` sans tokens — les tokens sont configurés par M-F), modal/bottom-sheet standard.

## Contraintes

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
