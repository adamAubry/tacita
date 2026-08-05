# apps/web — le shard UI (spec 11)

PWA Next.js 15 (App Router), composants Astryx. **Aucune logique métier ici** : le shard
compose les APIs des paquets 04–10. Toute logique découverte en écrivant un écran remonte
dans le paquet concerné, jamais dans un composant.

État : **M-A** (fondations), **M-B** (onboarding), **M-C** (accueil), **M-D** (conversation) et **M-E** (média, hors transcodage — voir `ESCALATIONS` § E-10) livrés. Les modules F à I posent leur contenu sur ce squelette.

```sh
pnpm --filter web dev      # http://localhost:3000
pnpm --filter web build
npx vitest run apps/web    # ou `npm test` à la racine
```

## Trois contraintes de construction — sans elles, `next build` échoue

Ce sont des faits, trouvés en cassant le build pendant le spike du 05/08/2026 ; ils sont
au contrat dans `specs/11-ui-shard.md` et `specs/ui/M-A.md`. Pas des préférences de style.

1. **Jamais le barrel `@astryxdesign/core`.** *« unsupported to use "export \*" in a client
   boundary »*. Toujours le sous-chemin. En pratique : **un seul fichier importe Astryx**,
   `components/foundation/primitives.ts`, et tout le reste passe par lui. Un test garde la
   règle — sinon elle se redécouvre au build, longtemps après avoir été enfreinte.
2. **Le `Theme` d'Astryx vit dans un composant `"use client"` à nous** (`app/providers.tsx`).
   Posé dans le layout racine, qui est un composant serveur, il fait échouer le rendu.
3. **Le cœur n'embarque aucune palette** : la nôtre est un `defineTheme`, sans paquet de thème.

## Le thème est la seule copie de DESIGN.md

`components/foundation/theme.ts` est **le seul endroit du dépôt** où une valeur hexadécimale
de DESIGN.md est recopiée. La table de correspondance qui le gouverne — 16 tokens DESIGN.md
vers 79 tokens Astryx — est dans `specs/ui/M-A.md`. Trois points s'y jouent, et aucun ne se
voit à l'œil nu :

- les **40 tokens chromatiques** d'Astryx (`blue`, `pink`, `red`…) sont posés sur les neutres.
  DESIGN.md dit « aucune autre couleur n'existe » : sans ça, un composant en rend un sans que
  personne ne l'ait écrit ;
- `--radius-chat` vaut **28 px** par défaut — « coins très arrondis », interdit explicite ;
- `--color-on-warning` est **inversé**, notre ambre étant sombre là où celui d'Astryx est vif.

Les trois tokens sans logement chez Astryx (`accent-pressed`, `highlight`, `scrim`) sont dans
`tokens.css`.

**Styles des composants composés : styles en ligne et variables CSS du thème.** Pas de StyleX
écrit à la main — l'authoring demanderait de brancher son compilateur dans Next, alors que la
distribution d'Astryx est déjà compilée. Un test refuse toute valeur hexadécimale hors du
fichier de thème.

## Ce qui n'est pas prouvé

Par la règle des deux portes du dépôt, à dire plutôt qu'à supposer :

- **rien n'a été rendu dans un vrai navigateur.** jsdom prouve la logique et la propagation
  des événements ; il ne prouve ni un doigt sur un écran, ni le conflit entre un swipe et le
  défilement, ni la zone morte de Safari iOS (REQ-UI-08/09, module M-D) ;
- **le service worker n'a jamais tourné.** Ce qui est testé est sa *forme* : liste de
  précache sans donnée, et une seule branche d'écriture au cache, étroite. Qu'il se comporte
  ainsi en production reste à vérifier ;
- **le flux OIDC complet n'a jamais été exécuté d'un bout à l'autre.** Le retour du
  fournisseur est testé sur son symptôme — un jeton dans l'URL, retiré de l'historique —
  pas contre un vrai Keycloak, ce qui demanderait un navigateur (interdit n°12) ;
- **le flash de thème au premier rendu est réel** : IndexedDB est asynchrone et l'interdit
  n°2 ferme localStorage. Il ne touche que ceux qui ont choisi l'autre mode que le défaut ;
- **ni vidéo ni vocal ne peuvent être envoyés** — et rien ne le laisse croire : les deux
  demandent un transcodage (Ogg/Opus imposé par D-03, MP4 par D-04) qu'aucune API native
  ne fournit, et dont la dépendance WASM se heurte à la liste close de REQ-UI-02. Photos,
  fichiers, lecture des vocaux reçus et capture photo fonctionnent. Arbitrage PM en
  attente : `specs/ui/ESCALATIONS.md` § E-10 ;
- **l'envoi de pièce jointe n'a pas de barre de progression**, seulement un état : le
  pipeline (spec 08) ne rapporte rien pendant la compression ni le téléversement, et une
  barre serait une animation inventée plutôt qu'une mesure ;
- **ni l'accueil ni la timeline ne sont fenêtrés.** Astryx `0.2.0` n'expose aucune liste
  virtualisée ; les contraintes de M-C et M-D prévoyaient ce cas. Le plafond est réel sur une
  conversation ancienne, pas sur une liste de conversations.

## Où sont les choses

| | |
|---|---|
| `app/` | routes App Router — les 7 layouts, les 4 onglets dans le groupe `(onglets)` |
| `components/foundation/` | M-A : primitives réexportées, thème, navbar, header, états |
| `components/onboarding/` | M-B : session, porte de récupération, éducation iOS, déconnexion |
| `components/accueil/` | M-C : liste de conversations, en-tête, bannière de demandes, création |
| `components/conversation/` | M-D : timeline, message object, hold menu, starter, composer |
| `components/media/` | M-E : vignettes, viewer, vocal, capture, galeries partagées |
| `lib/` | adaptateurs vers les paquets 04–10 et préférences d'interface (IndexedDB) |
| `public/` | manifeste, icônes, service worker |
