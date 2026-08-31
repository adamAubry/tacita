# apps/web — le shard UI (spec 11)

PWA Next.js 15 (App Router), composants Astryx. **Aucune logique métier ici** : le shard
compose les APIs des paquets 04–10. Toute logique découverte en écrivant un écran remonte
dans le paquet concerné, jamais dans un composant.

État : **M-A** (fondations), **M-B** (onboarding), **M-C** (accueil), **M-D** (conversation), **M-E** (média, hors transcodage — voir `ESCALATIONS` § E-10), **M-F** (recherche), **M-H** (réglages et infos de conversation) et **M-I** (appels et push — voir `ESCALATIONS` § E-12) livrés. Reste **M-G** (social).

## Variables d'environnement

Trois valeurs de déploiement, toutes publiques par nature — elles sortent au premier appel
réseau du client. Chacune a un défaut d'exemple, et aucune n'est un secret.

| | |
|---|---|
| `NEXT_PUBLIC_HOMESERVER_URL` | Synapse derrière le proxy TLS. Sert aussi à lire `/push/config` (clé VAPID, spec 03). |
| `NEXT_PUBLIC_ELEMENT_CALL_URL` | Déploiement Element Call chargé en iframe (spec 10). |
| `NEXT_PUBLIC_PUSH_GATEWAY_URL` | URL `notify` de la passerelle, **interne au compose** : c'est Synapse qui l'appelle, jamais le navigateur (`infra/README.md`, REQ-INF-14). |

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
- **le service worker n'a jamais tourné dans un navigateur.** Son *comportement* est
  éprouvé — la suite de M-I charge `public/sw.js` dans un bac à sable et fait tout le
  chemin du réveil push jusqu'à `showNotification`, aperçu déchiffré compris. Ce qui reste
  non prouvé est l'environnement : un vrai réveil par le service push du navigateur, avec
  ses délais et son extinction d'onglets ;
- **aucun appel n'a été passé.** Le shell de M-I est prouvé sur ses quatre chemins (focus
  absent, paramètres transmis, chargement trop long, décrochage au démontage), tous avec le
  paquet 10 mocké. Que le widget Element Call se connecte à un vrai SFU demande la pile RTC
  déployée — et le déploiement Element Call lui-même, qui n'est pas dans le compose ;
- **la notification riche suppose l'application ouverte** (`ESCALATIONS` § E-12) : sans
  onglet, le worker ne peut pas déchiffrer et affiche « Nouveau message ». L'écran de
  réglages le dit ; REQ-UI-18 attend l'arbitrage du PM ;
- **le flux OIDC complet n'a jamais été exécuté d'un bout à l'autre.** Le retour du
  fournisseur est testé sur son symptôme — un jeton dans l'URL, retiré de l'historique —
  pas contre un vrai Keycloak, ce qui demanderait un navigateur (interdit n°12) ;
- **le flash de thème au premier rendu est réel** : IndexedDB est asynchrone et l'interdit
  n°2 ferme localStorage. Il ne touche que ceux qui ont choisi l'autre mode que le défaut ;
- **l'envoi de vocal attend encore Safari.** E-10 est arbitré et les muxeurs vivent dans
  `@tacita/media-pipeline` : Firefox et Chrome/Edge sont couverts, iOS demande un encodeur
  Opus que le spike doit situer. Le vocal ne s'allumera dans l'UI qu'avec les trois chemins
  couverts — une messagerie où répondre en vocal dépend du téléphone d'en face est la
  promesse conditionnelle que l'interdit n°13 vise ;
- **la vidéo s'envoie là où `WebCodecs` l'encode**, et n'est pas proposée ailleurs : le
  câblage interroge `VideoEncoder.isConfigSupported` au montage. Le transcodage relit la
  vidéo **en temps réel** pour la décoder — une minute de vidéo prend une minute ;
- **l'envoi de pièce jointe n'a pas de barre de progression**, seulement un état : le
  pipeline (spec 08) ne rapporte rien pendant la compression ni le téléversement, et une
  barre serait une animation inventée plutôt qu'une mesure ;
- **ni l'accueil ni la timeline ne sont fenêtrés.** Astryx `0.2.0` n'expose aucune liste
  virtualisée ; les contraintes de M-C et M-D prévoyaient ce cas. Le plafond est réel sur une
  conversation ancienne, pas sur une liste de conversations ;
- **aucune push rule n'a été écrite contre un vrai Synapse.** M-H pose les trois niveaux de
  notification par salon avec les règles natives, et la suite prouve *quelles* règles partent ;
  que le serveur les évalue comme prévu — mentions qui passent en « mentions uniquement »,
  rien qui passe en « silencieux » — demande une pile déployée ;
- **un lien d'invitation de groupe s'émet, mais rien ne le consomme encore.** L'écran de
  réception appartient à M-G, et le mécanisme d'arrivée dans un salon privé est remonté au PM
  (`ESCALATIONS` § E-11). L'émission, l'expiration et la révocation, elles, fonctionnent.

## Où sont les choses

| | |
|---|---|
| `app/` | routes App Router — les 7 layouts, les 4 onglets dans le groupe `(onglets)` |
| `components/foundation/` | M-A : primitives réexportées, thème, navbar, header, états |
| `components/onboarding/` | M-B : session, porte de récupération, éducation iOS, déconnexion |
| `components/accueil/` | M-C : liste de conversations, en-tête, bannière de demandes, création |
| `components/conversation/` | M-D : timeline, message object, hold menu, starter, composer |
| `components/media/` | M-E : vignettes, viewer, vocal, capture, galeries partagées |
| `components/recherche/` | M-F : barre à tokens, recherches récentes, résultats, surlignage |
| `components/settings/` | M-H : réglages, infos de conversation, options, notifications |
| `components/appel/` | M-I : boutons d'appel, conteneur du widget Element Call, bandeau « en cours » |
| `components/notifications/` | M-I : invitation à activer le push, pont vers le service worker |
| `lib/` | adaptateurs vers les paquets 04–10 et préférences d'interface (IndexedDB) |
| `public/` | manifeste, icônes, service worker |
