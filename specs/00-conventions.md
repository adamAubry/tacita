# SPEC 00 — Conventions transversales

S'applique à tous les modules. Chaque spec de module (01 à 11) est un contrat autonome : un développeur doit pouvoir la réaliser sans lire les autres, hors dépendances déclarées en tête de spec.

> **Ce fichier ne porte plus les règles de comportement** (11/08/2026). Le protocole de test, les six règles de jurisprudence et la liste d'escalade vivent désormais dans `CLAUDE.md`, seul fichier chargé automatiquement à chaque session. Ils étaient ici, corrects et bien écrits, et n'ont rien empêché — ce fichier était désigné « à lire en premier » et ne l'était pas. Déplacés, pas copiés : un fait, une maison. Reste ici ce qui décrit la **structure** du dépôt et non la conduite à tenir.

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

Le protocole complet est dans `CLAUDE.md` § Tests — ce qui prouve quoi (framework, `asSession()`, sites de compilation des jonctions, moteur `--experimental-strip-types`, angle mort de jsdom) et § Boucle de développement (portée d'un run, porte de commit).

Ce qui relève de la structure et reste ici : **chaque module porte ses tests dans son propre paquet**, et la config infra (specs 01–02) est testée au même titre que le code — les tests parsent les fichiers YAML rendus et assertent les valeurs critiques.

## Séquencement

Waterfall jusqu'au ship : les specs 01–10 se développent en parallèle, la 11 s'intègre en dernier. CI/CD après le ship uniquement.

## Honnêteté produit

Aucune fonctionnalité n'est présentée (UI ou doc) avec une garantie qu'elle n'offre pas. **Chaque spec liste ses limites assumées** ; elles sont documentées, jamais masquées. Exemples imposés : réactions en clair, reçu « délivré » non chiffré et non standard, `m.room.pinned_events` non chiffré, métadonnées visibles serveur.

C'est l'application de l'interdit n°13 et de la règle 5 de `CLAUDE.md` à l'échelle d'une spec : la limite se déclare dans le contrat, pas seulement dans l'écran.

## Cas d'école, pour mémoire

Les règles qu'ils ont produites sont dans `CLAUDE.md` § Sept règles ; ce qui suit est la trace des incidents, qu'on ne recopie pas là-bas pour ne pas l'alourdir.

- **Règle 1 (jonctions)** — une passation que deux specs mentionnent sans que ni l'une ni l'autre ne la possède n'est vérifiée par rien.
- **Règle 3 (substituts)** — la spec 08 promettait « un contenu prêt à `enqueue` » (spec 07) et c'était faux : `AttachmentContent` était une `interface`, non assignable au `Record<string, unknown>` d'`enqueue`. Aucun test ne pouvait le voir, aucun paquet ne dépendant des deux.
- **`asSession()`** — six paquets utilisaient `as unknown as Session` avant la règle.
- **Règle 7 (valeur non lue)** — E-08, E-13, E-14 côté runtimes externes ; `opacity: var()` en style inline côté présentation.
