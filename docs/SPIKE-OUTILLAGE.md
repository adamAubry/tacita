# Spike Astryx / ponytail / impeccable — compte-rendu au PM

Action **A3**, exigée par `specs/11-ui-shard.md` et `specs/ui/M-A.md` en tout début de module.
Fait le 05/08/2026. **Verdict : les trois outils tiennent, et REQ-UI-01, 08 et 09 sont
réalisables tels qu'écrits.** Trois contraintes dures en sortent, deux points à trancher.

## Ce qui a été exécuté, pas lu

Aucune conclusion ci-dessous ne vient d'une documentation : registre npm interrogé, paquets
installés, rendu éprouvé en jsdom, application Next.js 15 réellement construite (webpack **et**
turbopack). Tout est rejouable — c'est ce qui distingue ce compte-rendu d'un avis.

## Les trois outils ne sont pas de la même nature, et ça change tout

| Outil | Ce que c'est réellement | Empreinte à l'exécution |
|---|---|---|
| **Astryx** (`@astryxdesign/core@0.2.0`) | Bibliothèque de composants React de Meta, MIT, React 19 + StyleX | **Elle seule est dans le bundle** |
| **ponytail** | Plugin d'agent (style de codage : la solution la plus simple qui marche) | **Aucune** |
| **impeccable** | Plugin d'agent + CLI de détection d'anti-patterns (`impeccable` sur npm) | **Aucune** |

**Conséquence directe :** la crainte de `CLAUDE.md` — « gestes tactiles, contraintes PWA, rendu
hors ligne non évalués » — ne peut concerner que **Astryx**. Deux des trois outils ne s'exécutent
jamais chez l'utilisateur ; ils ne peuvent être incompatibles avec rien de tout ça.

> ⚠️ **`CLAUDE.md` dit « Next.js 15 App Router (plugin ponytail) ». C'est une erreur de
> catégorie.** ponytail n'est pas un plugin Next.js et n'en a jamais été un. (Le paquet npm
> homonyme, publié en 2019, « Rethinking maintenance of multiple sites », n'a aucun rapport —
> ne pas l'installer par méprise.) La ligne est à corriger.

## Les trois questions du spike

**REQ-UI-08 / 09 — gestes tactiles : réalisables, sans bibliothèque de gestes.** Une séquence
`pointerdown → pointermove → pointerup` traverse un composant Astryx et arrive intacte aux
gestionnaires, coordonnées comprises. Astryx n'intercepte ni ne réécrit ces événements. Le
swipe et la zone morte de 20 px s'écrivent en code à nous, sur événements pointer, testables en
Vitest + jsdom — donc sans Playwright.

**REQ-UI-01 — PWA et hors ligne : réalisables.** Le CSS d'Astryx est un **fichier statique
unique** (130 Ko, émis dans `/_next/static/css/`) : précachable par le service worker, aucun
style à aller chercher au moment du rendu. Le paquet ne fait **aucun appel réseau** — pas de
police distante, pas de sprite d'icônes, les icônes sont du SVG en ligne. La locale `fr-FR` est
livrée dans le paquet.

> Seule exception, à connaître : le hook `useImageMode` (détection clair/sombre d'une image)
> fait un `fetch(src, {mode:'cors'})`. Aucun composant ne l'appelle — c'est un opt-in. **Ne
> jamais l'utiliser sur un média Matrix** : sans en-tête d'authentification il ne peut que
> échouer (REQ-MED-09), et l'appeler serait un accès réseau sur un chemin qui doit rester local.

**REQ-UI-03 — thème : natif, avec une réserve qui n'est pas d'Astryx.** Le mode est
`'system' | 'light' | 'dark'`, appliqué par attributs `data-theme` et variables CSS ; les
palettes vivent dans des paquets séparés (`@astryxdesign/theme-neutral` et une dizaine d'autres).
La réserve vient de nous : **l'interdit n°2 ferme localStorage, et IndexedDB est asynchrone** —
le choix de thème n'est donc pas connu au premier rendu. Il y aura un flash, limité à ceux qui
ont choisi l'autre mode que le défaut. Il n'y a pas de meilleure sortie sans stockage synchrone,
et il ne faut pas en chercher une en violant l'interdit.

> ⚠️ **Quel est le défaut, au fait ?** DESIGN.md en fait un de ses quatre principes non
> négociables — « Clair par défaut » — tandis que REQ-UI-03 de `M-A` dit « sombre (défaut) »,
> et la SPEC 11 ne se prononce pas. Le code suit DESIGN.md, autorité sur le visuel. **À
> trancher par le PM**, c'est une contradiction de specs, pas un choix d'implémentation.

## Trois contraintes dures pour M-A — découvertes en cassant le build

Ce sont des faits de construction, pas des préférences. Sans elles, `next build` **échoue**.

1. **Ne jamais importer depuis `@astryxdesign/core` nu.** Le barrel casse la compilation :
   *« It's currently unsupported to use "export *" in a client boundary »*. Toujours le
   sous-chemin — `@astryxdesign/core/Toolbar`. C'est déjà la notation de M-A ; elle est
   maintenant obligatoire, et pas seulement une convention d'écriture.
2. **Le `Theme` doit être enveloppé dans un composant `"use client"` à nous.** Placé
   directement dans le layout racine, il fait échouer le rendu serveur
   (*« Attempted to call defineSyntaxTheme() from the server »*). 378 des 516 modules d'Astryx
   sont des composants client : le shard sera massivement client, ce qui est cohérent avec un
   client de messagerie, mais doit être assumé plutôt que découvert.
3. **Le cœur n'embarque aucune palette** — il en faut une, mais pas forcément un paquet :
   `defineTheme` fonctionne sans `extends`. *(Corrigé le 05/08/2026 en écrivant M-A : ce
   point disait « un paquet de thème est requis », ce qui était une inférence tirée de
   l'exemple de la documentation, pas une mesure. Le thème de Tacita n'en utilise aucun.)*

Avec ces trois points, la construction passe, en webpack comme en turbopack : `/` à 11,4 Ko,
117 Ko de JS au premier chargement.

## Ce que le PM doit trancher

**1. StyleX et l'interdit n°1.** Astryx exige `@stylexjs/stylex` en peer dependency, et l'appelle
à l'exécution. Est-ce le « CSS-in-JS tiers » que l'interdit n°1 proscrit ? Les faits : c'est le
moteur de style **d'Astryx lui-même**, pas une couche ajoutée par-dessus ; la distribution est
**déjà compilée** (classes atomiques figées, aucun compilateur à brancher dans Next.js) ; il ne
reste à l'exécution qu'une fonction de fusion de classes. Refuser StyleX revient à refuser
Astryx. Ma lecture : l'interdit vise les systèmes de style **concurrents** d'Astryx, et StyleX
n'en est pas un — mais le test de REQ-UI-02 lit `package.json`, il lui faut donc une liste
explicite, et c'est vous qui l'arrêtez.

*Point voisin, sans ambiguïté celui-là :* Astryx livre un `tailwind-theme.css`. **Il ne doit
jamais être importé** — ce serait Tailwind, par la porte de derrière.

**2. Le moteur d'URL d'impeccable utilise puppeteer.** L'interdit n°12 nomme Playwright ; c'est
la même catégorie d'outil. Les moteurs statiques (HTML, CSS, regex) n'ont besoin d'aucun
navigateur. Proposition : n'utiliser qu'eux, et ne jamais lancer `impeccable` sur une URL.

## Ce que ce spike ne prouve pas

Il faut le dire, sinon il vaut ce que valait « la spec 01 est conforme à 100 % » pendant que
personne ne pouvait se connecter.

- **Rien n'a été rendu dans un vrai navigateur.** jsdom prouve que les événements pointer
  traversent Astryx ; il ne prouve pas le comportement d'un doigt sur un écran, ni le conflit
  entre un swipe et le défilement de la liste, ni la zone morte de Safari iOS.
- **Le service worker n'a pas été écrit.** Ce qui est prouvé est que le CSS est un fichier
  statique — donc précachable. Que le précache ne contienne aucune donnée reste à assurer.
- **Element Call en iframe dans une page Astryx n'a pas été essayé** (REQ-UI-19).
- **Astryx a six semaines** (première version le 24/06/2026, actuelle `0.2.0`). Une API en
  `0.x` bouge. Épingler la version exacte, et lire le CHANGELOG avant tout bump — même
  jurisprudence que les digests d'images du compose.
