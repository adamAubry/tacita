# SPEC 11 — Shard UI unique

**App : `apps/web/`. Dépendances : TOUS les packages client (specs 04–10) + spec 03 (clé VAPID). Dernier module intégré (waterfall).**

## Livrable

**Toute l'UI du client tient dans ce seul shard** : PWA installable Next.js 15 (App Router), composants **exclusivement Astryx**, apparence clone de Discord. *(ponytail et impeccable sont des plugins d'agent — un style de codage et un outil d'audit de design —, pas des dépendances du shard : ils n'ont aucune empreinte à l'exécution. Précisé le 05/08/2026.)* Le shard ne contient aucune logique métier : il consomme les APIs des packages 04–10. Toute logique découverte pendant le dev de l'UI remonte dans le package concerné, jamais dans le shard.

## Exigences et critères d'acceptation

### Socle
- **REQ-UI-01** — PWA installable : manifest, icônes, service worker. Le SW cache **uniquement** coquille applicative et assets statiques — jamais de contenu déchiffré, jamais de données utilisateur (cache applicatif pur).
- **REQ-UI-02** — UI exclusivement Astryx : pas de Tailwind, shadcn, Bootstrap, ni CSS-in-JS tiers. **Liste close, ratifiée le 05/08/2026** — le test lit `package.json`, il lui faut des noms, pas une intention. Autorisés : `@astryxdesign/*`, **`@stylexjs/stylex`** — moteur de style d'Astryx lui-même, exception à l'interdit n°1 motivée dans `CLAUDE.md` —, `@tacita/*` (les paquets 04–10 que le shard compose : ils sont le produit, pas une dépendance de style), `next` et `react`/`react-dom`. Refusés : `tailwindcss`, `bootstrap`, `shadcn*`, `styled-components`, `@emotion/*`, et toute dépendance de style qui n'est pas dans la liste des autorisés — l'assertion se fait **par défaut de refus**, sinon la prochaine bibliothèque ajoutée passera au vert faute d'avoir été nommée. Critère supplémentaire : aucun import de `@astryxdesign/core/tailwind-theme.css` dans les sources.
- **REQ-UI-03** — Mode **clair par défaut** et mode sombre (mécanisme de thème Astryx, `ThemeMode = 'system' | 'light' | 'dark'`), persistance du choix en IndexedDB (pas localStorage). Le clair est le thème de référence : c'est le premier des quatre principes non négociables de DESIGN.md, et le sombre en dérive. *(Défaut fixé le 05/08/2026 : `M-A` disait « sombre (défaut) », DESIGN.md « clair ». DESIGN.md fait autorité sur le visuel.)*
- **REQ-UI-04** — Onboarding : login OIDC (redirection fournisseur externe, y compris passkeys gérées par le fournisseur), puis **étape bloquante de clé de récupération** (REQ-COR-06) : impossible d'atteindre les conversations sans backup configuré, clé affichée une fois avec confirmation de sauvegarde.

### Conversations
- **REQ-UI-05** — Liste des conversations (DM et groupes) avec aperçu, compteur de non-lus, et compteur de membres dans l'en-tête de groupe (REQ-MSG-11).
- **REQ-UI-06** — Timeline : ordre fourni par le package (jamais retriée), séparateur de **date affiché à chaque changement de jour**, fusion timeline + outbox (REQ-OBX-05) avec statuts d'envoi et bouton renvoyer sur échec.
- **REQ-UI-07** — Menu **hold** (appui long) sur un message : répondre, copier, modifier, supprimer, épingler — items conditionnés par les droits exposés (REQ-MSG-06). Copie via l'API presse-papiers.
- **REQ-UI-08** — **Swipe gauche** sur un message → répondre (composer pré-rempli avec aperçu du message cité).
- **REQ-UI-09** — **Swipe droit** → révélation des heures d'envoi, avec **zone morte de 20 px au bord gauche** (le swipe depuis le bord déclenche le retour arrière de Safari iOS hors standalone).
- **REQ-UI-10** — Réactions emoji sur les messages ; le picker mentionne (info discrète mais accessible) que les réactions sont visibles en clair (REQ-MSG-05). Messages épinglés consultables ; l'écran d'épinglage documente le non-chiffrement (REQ-MSG-08).
- **REQ-UI-11** — Indicateur « est en train d'écrire » (lecture) et déclenchement throttlé à la saisie (via REQ-MSG-09).
- **REQ-UI-12** — Autocomplétion des mentions à la saisie de `@` (membres + `@everyone`), données de REQ-MSG-10, rendu type Discord.
- **REQ-UI-13** — Accusés : ✓ envoyé, ✓✓ délivré, ✓✓ bleu lu (ou équivalent Astryx). Libellé/aide reprenant REQ-RCP-06 (« délivré » non standard) ; message vers utilisateur masqué : état « envoyé » avec explication accessible (REQ-RCP-08). Réglage « mode masqué » dans les paramètres (REQ-RCP-07).

### Média et capture
- **REQ-UI-14** — Envoi de photos, vidéos, fichiers (ZIP, PDF, bureautique) via le pipeline unique (spec 08) ; affichage des vignettes déchiffrées ; lecteur audio des vocaux avec forme d'onde ; enregistrement vocal in-app.
- **REQ-UI-15** — Capture photo/vidéo in-app avec sauvegarde locale de l'original non compressé (REQ-MED-05), UI distinguant clairement « enregistré sur votre appareil » de « envoyé ».

### Recherche, hors ligne, notifications
- **REQ-UI-16** — Barre de recherche globale + recherche par salon (spec 09) ; le périmètre est **explicite en UI** : « Recherche dans l'historique téléchargé » avec les bornes de `stats()` (REQ-SRC-06).
- **REQ-UI-17** — Mode hors ligne : historique consultable sans réseau, bandeau d'état de connexion, composition possible (outbox).
- **REQ-UI-18** — Notifications : abonnement Web Push (clé VAPID, spec 03), réveil SW → récupération de l'événement par son ID → **déchiffrement local** → affichage. Sur iOS hors écran d'accueil : écran d'explication « ajoutez l'app à l'écran d'accueil pour recevoir des notifications » (REQ-PSH-05).

### Appels et personnalisation
- **REQ-UI-19** — Boutons d'appel voix/vidéo intégrant le widget Element Call en iframe (spec 10) ; bandeau « appel en cours — rejoindre » (REQ-CAL-03) ; erreur RtcFociMissing → message d'erreur visible, jamais de bouton inerte (REQ-CAL-02).
- **REQ-UI-20** — Personnalisation : **photo de profil** — téléversée par `uploadPublicProfileImage()` (spec 08, REQ-MED-11), donc **non chiffrée**, avec la phrase qui le dit au moment du choix ; fond d'écran de conversation choisi dans la galerie du user (stocké localement en IndexedDB, non synchronisé — YAGNI). *(Amendée le 07/08/2026 — escalade E-12, voie A. La rédaction précédente disait « via pipeline média » sans trancher le chiffrement, ce qui rendait l'exigence inapplicable : chiffrée, la photo n'est un avatar chez aucun client.)*

## Ce dont le shard hérite

Les sept paquets sont livrés, verts, et **aucun n'importe un autre en production** : c'est le shard qui les compose. Chacun a un `README.md` avec une section « Limites assumées » — les cas où le module ne peut pas tenir ce que l'UI voudrait afficher. À lire avant de dessiner un écran qui promet plus.

| Paquet | Ce qu'il donne | REQ-UI servies |
|---|---|---|
| `@tacita/client-core` | `initSession`, `restoreSession`, `Session` (client, timeline, isEncrypted, recoveryRequired, setupRecoveryKey, identityResetOf, confirmIdentityOf, registerWipe, logout) | 01, 04, 17 |
| `@tacita/messaging` | `sendText`, `reply`, `edit`, `redact`, `react`, `messages`, `subscribe`, `canEdit`, `canRedact`, `createDirectMessage`, `createGroupChat`, `memberCount`, `getPinnedEvents`, `setPinnedEvents`, `parseMentions`, `mentionCandidates`, `createTypingIndicator`, `conversations`, `invitations`, `setFavourite`, `openDirectMessage`, `subscribeConversations`, `acceptInvitation`, `leaveConversation`, `ignoredUsers`, `ignoreUser`, `unignoreUser`, `profileOf`, `updateProfile`, `searchUsers`, `Profile` | 05–12 |
| `@tacita/outbox` | `createOutbox`, `Outbox` (enqueue/retry/remove/pending/subscribe), `OutboxEntry`, `NOT_ENCRYPTED` | 06, 17 |
| `@tacita/receipts` | `createReceipts`, `ReceiptStatus`, `DELIVERED`, `deliveryUnknowable` | 13 |
| `@tacita/media-pipeline` | `uploadAttachment`, `downloadAttachment`, `saveOriginal`, `waveform`, `AttachmentContent` | 14, 15 |
| `@tacita/search` | `createSearch`, `Search`, `SearchHit`, `SearchStats`, `SearchFilters`, `ROOM_MENTION` | 16 |
| `@tacita/calls` | `discoverFocus`, `buildCallWidget`, `CallWidgetDriver`, `activeCall`, `hangupLocal` | 19 |

Un service en plus, non importable — c'est une API HTTP sous `/invite/` : **`apps/invite-tokens/`** (spec 12). Il résout un token en identifiant **et s'arrête là** ; c'est le shard qui invite ensuite, par le chemin natif de D-09.

Deux points qui se paient cher s'ils sont ignorés :

- **`NOT_ENCRYPTED` s'importe depuis `@tacita/outbox`, jamais ne se recopie.** C'est l'`errcode` d'une entrée bloquée par REQ-OBX-09 (salon non chiffré), et l'UI doit le distinguer d'un échec réseau : le premier ne se réessaie pas. Une chaîne recopiée n'est plus un contrat.
- **Rien ne se dérive du crypto dans le shard.** Si vous vous surprenez à appeler `session.client.getCrypto()`, c'est qu'un membre manque à la spec 04 — demandez-le plutôt que de le contourner. C'est exactement ce qui s'est passé pour `identityResetOf` et `confirmIdentityOf`.

## Méthode et contraintes

- Gestes tactiles implémentés sur événements pointer (testables en jsdom). **Le spike de validation a été fait le 05/08/2026** : les événements pointer traversent Astryx intacts, son CSS est un fichier statique sans appel réseau, et REQ-UI-01/08/09 sont réalisables tels qu'écrits. Des trois outils, seul Astryx s'exécute chez l'utilisateur ; ponytail et impeccable sont des plugins d'agent, sans empreinte à l'exécution (`CLAUDE.md`, « Prudence outillage »). Toute incompatibilité **découverte depuis** remonte au PM avant qu'un contournement soit écrit.
- **Trois contraintes de construction, non négociables** (le spike les a trouvées en cassant `next build`) : ne jamais importer depuis le barrel `@astryxdesign/core` — toujours le sous-chemin, `@astryxdesign/core/Toolbar` ; envelopper le `Theme` d'Astryx dans un composant `"use client"` du shard ; fournir une palette, le cœur n'en embarque aucune — un `defineTheme` du shard suffit, sans paquet de thème.
- **Le thème n'est pas connu au premier rendu.** L'interdit n°2 ferme localStorage et IndexedDB est asynchrone : un utilisateur qui a choisi le sombre verra un flash clair au premier rendu. Assumé, et documenté plutôt que contourné par un stockage synchrone.
- Aucune donnée utilisateur hors IndexedDB ; aucun contenu déchiffré dans le cache SW, les payloads de notification, les logs, la télémétrie ou les traces d'erreur, y compris en dev.
- Aucune promesse UI supérieure aux garanties réelles (spec 00, honnêteté produit).
- Hors scope : toute logique métier (elle vit dans les packages), CI/CD.

## Objectif mesurable

Suite Vitest + Testing Library (packages 04–10 mockés à leurs interfaces), une describe par REQ. Points de contrôle notables : REQ-UI-02 (test lisant package.json : aucune dépendance interdite) ; REQ-UI-06 (deux messages à cheval sur minuit → séparateur de date rendu) ; REQ-UI-08/09 (séquences pointer : swipe gauche → composer en mode réponse ; swipe partant à x<20px → aucune révélation d'heures) ; REQ-UI-04 (backup non configuré → route conversations inaccessible) ; REQ-UI-01 (liste des routes précachées du SW : zéro entrée de données). Pas de Playwright.
