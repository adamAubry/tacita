# SPEC 00 — Conventions transversales

S'applique à tous les modules. Chaque spec de module (01 à 11) est un contrat autonome : un développeur doit pouvoir la réaliser sans lire les autres, hors dépendances déclarées en tête de spec.

## Architecture générale

Monorepo pnpm workspaces. Le client est découpé en **packages headless** (logique métier, zéro DOM, zéro composant) et **un unique shard UI** (spec 11) qui les consomme. Les services serveur sont des packages indépendants.

```
packages/
  client-core/        # spec 04 — session, crypto, store, sync
  messaging/          # spec 05 — domaine messages
  receipts/           # spec 06 — accusés 3 niveaux
  outbox/             # spec 07 — file d'envoi persistante
  media-pipeline/     # spec 08 — chiffrement/compression média
  search/             # spec 09 — index local Orama
  calls/              # spec 10 — intégration Element Call
apps/
  web/                # spec 11 — LE shard UI (Next.js 15 + Astryx)
  push-gateway/       # spec 03 — passerelle Web Push
infra/                # specs 01 et 02 — config-as-code Synapse, LiveKit, proxy
```

Règle de dépendance : `apps/web` dépend des packages ; les packages ne dépendent jamais de `apps/web` ni entre eux sauf déclaration explicite dans leur spec. Tout échange passe par les interfaces TypeScript exportées, décrites dans chaque spec.

## Identifiants d'exigence

Chaque exigence porte un ID `REQ-<PREFIXE>-<NN>` défini dans sa spec (ex. `REQ-MSG-04`). **Chaque test Vitest nomme l'exigence qu'il couvre** dans son `describe` ou `it` :

```ts
describe("REQ-MSG-04 — réponse via m.in_reply_to", () => { ... })
```

Une exigence sans test nommé n'est pas couverte ; un test sans ID d'exigence est rejeté en revue.

## Tests

- Framework unique : **Vitest**. **Playwright interdit.** Composants UI testés via Vitest + Testing Library (environnement jsdom/happy-dom), gestes simulés par événements pointer.
- Un module est « terminé » quand : 100 % de ses REQ ont au moins un test nommé qui passe, et `pnpm test` est vert sur le package.
- La config infra (specs 01–02) est testée aussi : les tests parsent les fichiers YAML rendus et assertent les valeurs critiques.

## Workflow

- Waterfall jusqu'au ship : les specs 01–10 se développent en parallèle, la 11 s'intègre en dernier. CI/CD après le ship uniquement.
- Dev par blocs : un bloc = une ou plusieurs REQ ; un commit n'est autorisé que si les tests du bloc passent.
- **Hooks de pré-commit bloquants dès le premier commit** (husky + lint-staged) : lint, typecheck, tests du package modifié. Non désactivables (`--no-verify` proscrit par convention d'équipe).

## Interdits globaux (rappel, détaillés dans CLAUDE.md)

Tailwind/shadcn/Bootstrap/CSS-in-JS tiers ; localStorage/sessionStorage pour données utilisateur ; endpoint `/search` de Synapse ; libolm ; endpoint thumbnail serveur sur média chiffré ; tri par `origin_server_ts` ; client RTC maison ; contenu déchiffré dans cache SW, payloads push, logs, télémétrie, traces d'erreur — y compris en dev.

## Honnêteté produit

Aucune fonctionnalité n'est présentée (UI ou doc) avec une garantie qu'elle n'offre pas. Chaque spec liste ses limites assumées ; elles sont documentées, jamais masquées. Exemples imposés : réactions en clair, reçu « délivré » non chiffré et non standard, `m.room.pinned_events` non chiffré, métadonnées visibles serveur.

## Précaution versions

Les défauts Synapse varient selon les versions : lire la config de la version déployée, ne pas supposer. Les MSC MatrixRTC ne sont pas stabilisés : toute valeur littérale (préfixes d'événements, state keys) doit être relue dans la doc courante d'Element Call avant usage. Le comportement de l'authenticated media a changé récemment : à vérifier dans la version déployée (spec 01).
