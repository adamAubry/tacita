# apps/web — le shard UI

PWA Next.js 15 (App Router), composants Astryx. **Aucune logique métier ici** : le shard
compose les APIs des paquets 04–10. Toute logique découverte en écrivant un écran remonte
dans le paquet concerné, jamais dans un composant.

État : les neuf modules du shard sont posés — fondations, onboarding, accueil, conversation, média (hors transcodage), recherche et mentions, social, réglages, appels et push. Reste l'intégration finale : navigation croisée, passe de cohérence visuelle.

```sh
cp .env.example .env.local # les trois URLs, dérivées de SERVER_NAME (infra/.env)
pnpm --filter web dev      # http://localhost:3000
pnpm --filter web build
npx vitest run apps/web    # ou `npm test` à la racine
```

`.env.local` est ignoré par git : chaque environnement garde le sien. Avant le premier
`dev`, le nom doit résoudre depuis le **navigateur** — `infra/README.md`, section
« Résoudre le nom depuis l'hôte » (le cas WSL2 y est traité). Sans ça la redirection
vers l'OIDC est correcte et part vers un nom qui ne mène nulle part.

## Trois contraintes de construction — sans elles, `next build` échoue

Ce sont des faits, trouvés en cassant le build pendant le spike du 05/08/2026 ; ils sont
au contrat. Pas des préférences de style.

1. **Jamais le barrel `@astryxdesign/core`.** *« unsupported to use "export \*" in a client
   boundary »*. Toujours le sous-chemin. En pratique : **un seul fichier importe Astryx**,
   `components/foundation/primitives.ts`, et tout le reste passe par lui. Un test garde la
   règle — sinon elle se redécouvre au build, longtemps après avoir été enfreinte.
2. **Le `Theme` d'Astryx vit dans un composant `"use client"` à nous** (`app/providers.tsx`).
   Posé dans le layout racine, qui est un composant serveur, il fait échouer le rendu.
3. **Le cœur n'embarque aucune palette** : la nôtre est un `defineTheme`, sans paquet de thème.

## Le thème est la seule source des couleurs

`components/foundation/theme.ts` est **le seul endroit du dépôt** où une valeur hexadécimale
est écrite. La table de correspondance qui le gouverne — 16 tokens de marque
vers 79 tokens Astryx — vit dans ce fichier. Trois points s'y jouent, et aucun ne se
voit à l'œil nu :

- les **40 tokens chromatiques** d'Astryx (`blue`, `pink`, `red`…) sont posés sur les neutres.
  Le système dit « aucune autre couleur n'existe » : sans ça, un composant en rend un sans que
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
  défilement, ni la zone morte de Safari iOS ;
- **le service worker n'a jamais tourné dans un navigateur.** Ses gestionnaires `push` et
  `notificationclick` sont, eux, exercés : la suite évalue **le fichier livré** avec un
  `self` fourni, et vérifie la notification construite comme celle qui reste générique.
  Le reste est testé sur sa *forme* : liste de précache sans donnée, une seule branche
  d'écriture au cache, étroite. Que le navigateur l'installe et le réveille comme prévu
  reste à vérifier sur une pile déployée ;
- **une notification arrivée application fermée reste générique.** Les clés Megolm vivent
  dans le store crypto d'une fenêtre : sans fenêtre ouverte, le service worker ne peut rien
  déchiffrer et affiche « Nouveau message ». La limite est écrite dans les limites connues ;
  la lever demanderait la crypto Rust dans le service worker ;
- **aucun appel n'a été passé.** Le shell d'appel est prouvé sur ce qui lui appartient —
  permissions de l'iframe, message de `RtcFociMissing`, sortie de secours au délai,
  paramètre de lancement — avec le paquet 10 mocké. Qu'Element Call démarre, s'authentifie
  auprès du SFU et rende du média demande la pile RTC déployée ;
- **les paramètres d'URL d'Element Call sont relus dans la version épinglée**  :
  `infra/rtc/` fixe la `v0.23.0` par digest, et le point d'entrée part en `intent`. Ce qui
  reste non prouvé, c'est le rendu — voir le point précédent. `skipLobby` n'est jamais
  envoyé : le lobby est le rattrapage d'une intention partie de travers ;
- **le flux OIDC complet n'a jamais été exécuté d'un bout à l'autre.** Le retour du
  fournisseur est testé sur son symptôme — un jeton dans l'URL, retiré de l'historique —
  pas contre un vrai Keycloak, ce qui demanderait un navigateur (interdit n°12) ;
- **le flash de thème au premier rendu est réel** : IndexedDB est asynchrone et l'interdit
  n°2 ferme localStorage. Il ne touche que ceux qui ont choisi l'autre mode que le défaut ;
- **l'envoi de vocal attend encore Safari.** Les muxeurs vivent dans
  `@tacita/media-pipeline` : Firefox et Chrome/Edge sont couverts, iOS demande un encodeur
  Opus que le spike doit situer. Le vocal ne s'allumera dans l'UI qu'avec les trois chemins
  couverts — une messagerie où répondre en vocal dépend du téléphone d'en face est la
  promesse conditionnelle que l'interdit n°13 vise ;
- **la vidéo s'envoie là où `WebCodecs` l'encode**, et n'est pas proposée ailleurs : le
  câblage interroge `VideoEncoder.isConfigSupported` au montage. Le transcodage relit la
  vidéo **en temps réel** pour la décoder — une minute de vidéo prend une minute ;
- **l'envoi de pièce jointe n'a pas de barre de progression**, seulement un état : le
  pipeline ne rapporte rien pendant la compression ni le téléversement, et une
  barre serait une animation inventée plutôt qu'une mesure ;
- **la photo de profil est livrée, et elle n'est pas chiffrée**  : un
  avatar Matrix est un `mxc://` nu que tout client doit pouvoir afficher, et le chiffrer en
  ferait un carré cassé partout. Elle passe par `uploadPublicProfileImage()`, **l'unique
  chemin public du pipeline**, dont le site d'appel unique est gardé par un test. L'écran
  le dit au moment du choix ;
- **aucun avatar n'est une image**, pas même celui d'un contact : `ConversationAvatar`
  rend des initiales, la récupération de média authentifié pour les avatars n'étant pas
  branchée ;
- **ni l'accueil ni la timeline ne sont fenêtrés.** Astryx `0.2.0` n'expose aucune liste
  virtualisée ; les contraintes de conception prévoyaient ce cas. Le plafond est réel sur une
  conversation ancienne, pas sur une liste de conversations ;
- **aucune push rule n'a été écrite contre un vrai Synapse.** l'écran de réglages pose les trois niveaux de
  notification par salon avec les règles natives, et la suite prouve *quelles* règles partent ;
  que le serveur les évalue comme prévu — mentions qui passent en « mentions uniquement »,
  rien qui passe en « silencieux » — demande une pile déployée ;
- **aucun `knock` n'a été émis contre un vrai Synapse.** Depuis, un lien de groupe
  ouvre le sas du salon, fait frapper son porteur, et un membre confirme. La suite prouve
  que la bonne règle est écrite, que le bon appel part et que l'UI dit la vérité ; que le
  serveur accepte le knock et que l'invitation qui suit fasse entrer demande une pile
  déployée. À vérifier en premier : la bascule `join_rules` exige un power level d'état,
  et un membre ordinaire qui émet un lien voit un avertissement au lieu d'un lien muet ;
- ~~**un lien d'invitation de groupe s'émet, mais rien ne le consomme encore.**~~ L'écran de
  réception appartient à l'écran social, et le mécanisme d'arrivée dans un salon privé reste ouvert
  L'émission, l'expiration et la révocation, elles, fonctionnent.

## Où sont les choses

| | |
|---|---|
| `app/` | routes App Router — les 7 layouts, les 4 onglets dans le groupe `(onglets)` |
| `components/foundation/` | primitives réexportées, thème, navbar, header, états |
| `components/onboarding/` | session, porte de récupération, éducation iOS, déconnexion |
| `components/accueil/` | liste de conversations, en-tête, bannière de demandes, création |
| `components/conversation/` | timeline, message object, hold menu, starter, composer |
| `components/media/` | vignettes, viewer, vocal, capture, galeries partagées |
| `components/recherche/` | barre et périmètre, recherches récentes, résultats surlignés, onglet Mentions |
| `components/profil/` | profile card, profil propre et d'autrui, note privée locale |
| `components/amis/` | ajout par lien ou annuaire, demandes reçues |
| `components/settings/` | réglages, infos de conversation, options, notifications |
| `lib/` | adaptateurs vers les paquets 04–10 et préférences d'interface (IndexedDB) |
| `public/` | manifeste, icônes, service worker |
