# CLAUDE.md — Messagerie E2EE auto-hébergée (PWA Matrix)

PWA de messagerie chiffrée de bout en bout remplaçant les DM/groupes Instagram. Synapse + PostgreSQL, client matrix-js-sdk, appels via LiveKit + Element Call en widget. **Principe directeur : le serveur ne voit jamais de contenu en clair.**

## Source de vérité

Spec-driven development : les specs sont exécutables, le code les implémente, jamais l'inverse.

- `specs/00-conventions.md` — architecture, IDs d'exigence, workflow. **Lire en premier.**
- `specs/01..11-*.md` — un contrat par module. Ne travailler que dans le module assigné.
- `DECISIONS.md` — arbitrages produit tranchés (D-01 à D-05). Ne pas les rediscuter dans le code ; escalader au PM.
- `specs/ui/` — découpage frontend du shard UI (modules M-A à M-I, plan, ESCALATIONS.md, V2-BACKEND.md). Pour tout travail dans `apps/web`, le module M-X assigné est le contrat ; la SPEC 11 reste l'autorité fonctionnelle.
- `PRODUCT.md` et `DESIGN.md` (racine) — stratégie produit et système visuel (voir section impeccable).

## Stack imposée

- Next.js 15 App Router (plugin **ponytail**) — uniquement `apps/web`
- **Astryx UI** exclusivement, avec le plugin **impeccable** (voir section dédiée)
- matrix-js-sdk avec crypto Rust (vodozemac) ; monorepo pnpm ; tests **Vitest** uniquement

## Interdits absolus

1. **Pas de Tailwind, shadcn, Bootstrap, ni CSS-in-JS tiers** — Astryx seul.
2. **Pas de localStorage/sessionStorage** pour des données utilisateur — IndexedDB uniquement.
3. **Ne jamais appeler `/search` de Synapse** ni construire de repli dessus (inopérant sur salon chiffré). Recherche 100 % locale (spec 09).
4. **Pas de libolm** (déprécié) — vodozemac via le SDK.
5. **Ne jamais appeler `/_matrix/media/*/thumbnail`** sur média chiffré — vignettes côté client (spec 08).
6. **Ne jamais trier par `origin_server_ts`** — l'ordre canonique est celui du flux `/sync`.
7. **Pas de client RTC maison** — Element Call en widget, point final.
8. **Aucun contenu déchiffré** dans le cache du service worker, les payloads push, les logs, la télémétrie ou les traces d'erreur — y compris en développement.
9. **Ne pas supposer un accusé « délivré » natif** — Matrix ne définit que `m.read` ; le nôtre est une extension (spec 06), jamais présentée comme du Matrix natif.
10. **Ne pas décrire `/sync` comme du WebSocket** — c'est du long-polling HTTP.
11. **Pas de canal d'upload parallèle** — un seul pipeline média pour tous les fichiers (spec 08).
12. **Pas de Playwright.**
13. Aucune fonctionnalité présentée avec une garantie qu'elle n'offre pas — les limites connues se documentent, ne se masquent pas.

## Design et impeccable

Layout officiel du plugin — deux fichiers à la racine, rien dans `.claude/impeccable/` (les anciens `design-system.md`/`interactions.md`/`review-checklist.md` ont été migrés puis supprimés ; leur contenu vit dans DESIGN.md, la SPEC 11 et les modules `specs/ui/`) :

- **`PRODUCT.md`** — stratégie : plateforme, utilisateurs, positionnement, voix, anti-références. À lire avant tout écran nouveau ; les microcopies suivent sa section Voix.
- **`DESIGN.md`** — système visuel maintenu via `/impeccable document`, avec **exactement six sections aux en-têtes figés** (`Overview`, `Colors`, `Typography`, `Elevation`, `Components`, `Do's and Don'ts`) : ne jamais renommer, réordonner, ajouter ou supprimer une section — d'autres outils les parsent. Toute évolution visuelle passe par une modification de DESIGN.md (validée par le Tech Lead), jamais par une valeur en dur dans un composant.

Usage attendu : avant de coder un composant, vérifier son token/style dans DESIGN.md et sa primitive Astryx dans Components ; en revue, tout écart DESIGN.md est bloquant au même titre qu'un test rouge.

## Workflow

- Dev par blocs : un bloc = des REQ ; commit seulement si les tests du bloc passent. Hooks pré-commit bloquants (lint, typecheck, tests) — jamais de `--no-verify`.
- **Chaque test Vitest nomme son exigence** : `describe("REQ-XXX-NN — ...")`. Test sans ID = rejeté en revue.
- Un module est terminé quand toutes ses REQ ont un test nommé vert.
- Valeurs sensibles aux versions (défauts Synapse, préfixes MatrixRTC, authenticated media) : vérifier dans la doc de la version déployée avant usage, ne jamais supposer.

## Prudence outillage

Astryx, ponytail et impeccable n'ont pas été évalués (gestes tactiles, contraintes PWA, rendu hors ligne). Toute incompatibilité constatée : ne pas contourner silencieusement, escalader au PM.
