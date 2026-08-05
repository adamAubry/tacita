# SPEC 11 — Shard UI unique

**App : `apps/web/`. Dépendances : TOUS les packages client (specs 04–10) + spec 03 (clé VAPID). Dernier module intégré (waterfall).**

## Livrable

**Toute l'UI du client tient dans ce seul shard** : PWA installable Next.js 15 (App Router, plugin ponytail), composants **exclusivement Astryx** (plugin impeccable), apparence clone de Discord. Le shard ne contient aucune logique métier : il consomme les APIs des packages 04–10. Toute logique découverte pendant le dev de l'UI remonte dans le package concerné, jamais dans le shard.

## Exigences et critères d'acceptation

### Socle
- **REQ-UI-01** — PWA installable : manifest, icônes, service worker. Le SW cache **uniquement** coquille applicative et assets statiques — jamais de contenu déchiffré, jamais de données utilisateur (cache applicatif pur).
- **REQ-UI-02** — UI exclusivement Astryx : pas de Tailwind, shadcn, Bootstrap, ni CSS-in-JS tiers. **Liste close, ratifiée le 05/08/2026** — le test lit `package.json`, il lui faut des noms, pas une intention. Autorisés : `@astryxdesign/*` (cœur, paquet de thème) et **`@stylexjs/stylex`**, moteur de style d'Astryx lui-même (exception à l'interdit n°1, motivée dans `docs/SPIKE-OUTILLAGE.md`). Refusés : `tailwindcss`, `bootstrap`, `shadcn*`, `styled-components`, `@emotion/*`, et toute dépendance de style qui n'est pas dans la liste des autorisés — l'assertion se fait **par défaut de refus**, sinon la prochaine bibliothèque ajoutée passera au vert faute d'avoir été nommée. Critère supplémentaire : aucun import de `@astryxdesign/core/tailwind-theme.css` dans les sources.
- **REQ-UI-03** — Mode sombre et clair (mécanisme de thème Astryx), persistance du choix en IndexedDB (pas localStorage).
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
- **REQ-UI-20** — Personnalisation : photo de profil (via pipeline média), fond d'écran de conversation choisi dans la galerie du user (stocké localement en IndexedDB, non synchronisé — YAGNI).

## Méthode et contraintes

- Gestes tactiles implémentés sur événements pointer (testables en jsdom). **Le spike de validation a été fait le 05/08/2026 — `docs/SPIKE-OUTILLAGE.md`** : les événements pointer traversent Astryx intacts, son CSS est un fichier statique sans appel réseau, et REQ-UI-01/08/09 sont réalisables tels qu'écrits. Des trois outils, seul Astryx s'exécute chez l'utilisateur ; ponytail et impeccable sont des plugins d'agent, sans empreinte à l'exécution. Toute incompatibilité **découverte depuis** remonte au PM avant qu'un contournement soit écrit.
- **Trois contraintes de construction, non négociables** (le spike les a trouvées en cassant `next build`) : ne jamais importer depuis le barrel `@astryxdesign/core` — toujours le sous-chemin, `@astryxdesign/core/Toolbar` ; envelopper le `Theme` d'Astryx dans un composant `"use client"` du shard ; installer un paquet de thème (`@astryxdesign/theme-*`), le cœur n'en embarque aucun.
- **Le thème n'est pas connu au premier rendu.** L'interdit n°2 ferme localStorage et IndexedDB est asynchrone : un utilisateur en mode clair verra un flash sombre. Assumé, et documenté plutôt que contourné par un stockage synchrone — le défaut sombre de REQ-UI-03 en limite la portée.
- Aucune donnée utilisateur hors IndexedDB ; aucun contenu déchiffré dans le cache SW, les payloads de notification, les logs, la télémétrie ou les traces d'erreur, y compris en dev.
- Aucune promesse UI supérieure aux garanties réelles (spec 00, honnêteté produit).
- Hors scope : toute logique métier (elle vit dans les packages), CI/CD.

## Objectif mesurable

Suite Vitest + Testing Library (packages 04–10 mockés à leurs interfaces), une describe par REQ. Points de contrôle notables : REQ-UI-02 (test lisant package.json : aucune dépendance interdite) ; REQ-UI-06 (deux messages à cheval sur minuit → séparateur de date rendu) ; REQ-UI-08/09 (séquences pointer : swipe gauche → composer en mode réponse ; swipe partant à x<20px → aucune révélation d'heures) ; REQ-UI-04 (backup non configuré → route conversations inaccessible) ; REQ-UI-01 (liste des routes précachées du SW : zéro entrée de données). Pas de Playwright.
