# M-I — Appels et notifications push

**Dépendances : M-A, packages calls (spec 10) et client-core (04) ; passerelle push (spec 03). Escalation E-07 : l'UI en appel appartient à Element Call.**

## Livrable

Intégration des appels (shell autour du widget Element Call) et chaîne de notifications push côté client.

## Exigences

### Appels
- **REQ-UI-19** — Boutons appel audio / appel vidéo (icônes seules) dans le header de conversation (M-D fournit l'emplacement, M-I le comportement) ; tap → conteneur plein écran embarquant le widget Element Call (`buildCallWidget`, spec 10) ; bandeau persistant « Appel en cours — rejoindre » dans les salons concernés (REQ-CAL-03) ; erreur `RtcFociMissing` → message d'erreur explicite, jamais de bouton inerte.
- **REQ-UIX-38** — Shell d'appel minimal : notre UI ne rend que le conteneur (plein écran, safe-areas) et un bouton de sortie de secours si le widget ne charge pas (timeout → message + retour). Bascule voix↔vidéo, layout vidéo, auto-masquage des menus : **comportements internes d'Element Call, hors périmètre** (E-07). Le point d'entrée « appel audio » vs « appel vidéo » passe les paramètres de lancement correspondants au widget.
- **REQ-UIX-39** — Entrée « Appel audio » des Friends interaction buttons (M-G) → même chemin que le header 1:1.

### Notifications
- **REQ-UI-18** — Abonnement Web Push : clé VAPID récupérée (spec 03), permission demandée au bon moment (après le premier message reçu ou depuis les réglages — jamais au premier lancement) ; réveil SW → payload {event_id, room_id} → récupération et **déchiffrement local** → notification affichée (expéditeur + aperçu déchiffrés localement) ; tap → conversation. Sur refus de permission : état visible dans les réglages avec chemin de rattrapage.
- **REQ-UIX-40** — Le SW de notification ne persiste rien : aucun contenu déchiffré en cache SW, aucun payload loggé (interdits CLAUDE.md) ; si le déchiffrement échoue (clés absentes), notification générique « Nouveau message » sans contenu, sans erreur bruyante.

#### Précisions du 24/08/2026 — quatre retours utilisateurs, quatre causes distinctes

REQ-UI-18 était tenue au sens de sa lettre et fausse au sens de son effet : sur un
appareil réel, la feuille revenait sans fin, le bouton des réglages n'existait pas,
l'activation ne faisait rien, et aucune notification n'arrivait jamais. Les quatre
causes étaient indépendantes ; les quatre garanties ci-dessous les ferment, et chacune
a son test nommé.

1. **Une seule demande, dans la vie de l'appareil.** La proposition est marquée en
   IndexedDB **à l'affichage**, et la permission est relue **à chaque passage** du
   déclencheur, pas une seule fois au montage. Le rattrapage est l'écran de réglages,
   nommé dans la feuille elle-même. (Même jurisprudence que M-B pour l'éducation iOS.)
2. **Chaque état réparable porte une action.** L'écran de réglages rend un bouton pour
   tout état qu'un geste peut faire avancer — y compris permission accordée mais chaîne
   coupée. Seuls `refuse`, `ios-a-installer` et `indisponible` n'en portent pas : là,
   un bouton ne pourrait qu'échouer en silence.
3. **Aucune attente sans fin.** `navigator.serviceWorker.ready` n'échoue pas quand rien
   n'est enregistré : elle attend pour toujours. Tout chemin d'abonnement est borné et
   rend un état terminal, fût-il négatif.
4. **L'abonnement se vérifie et se répare à chaque ouverture.** Les trois maillons —
   permission, `PushSubscription` chiffrée avec la clé VAPID courante, pusher présent
   sur le compte — sont relus ; le pusher n'est cru qu'après relecture au serveur. Une
   subscription tournée, une clé VAPID régénérée ou un pusher supprimé après un 410 se
   rattrapent sans que l'utilisateur ait rien à faire. L'écran de réglages **affiche les
   trois maillons séparément** : c'est la seule observabilité disponible, aucun de ces
   maillons n'existant sur un poste de développement.

Deux contraintes de plate-forme, mesurées et non déduites, tenues par le service worker :
`renotify: true` avec le `tag` — sans lui, le deuxième message d'une conversation
remplace le premier **en silence**, ce qui est indiscernable d'une chaîne cassée ; et
`skipWaiting`/`clients.claim`, sans quoi un worker corrigé n'atteint jamais une PWA
installée, qui ne ferme jamais tous ses onglets.

Côté déploiement (spec 01) : l'appel du pusher est le **second** client sortant de
Synapse soumis à `ip_range_blacklist`, après la découverte OIDC. Liste vide ⇒ Synapse
n'appelle jamais la passerelle, et rien ne le dit. Voir `infra/README.md`, § REQ-INF-14.

## Contraintes

- L'iframe Element Call reçoit uniquement les permissions nécessaires (`allow="camera; microphone; fullscreen"`).
- Notifications groupées par conversation (tag) pour éviter l'empilement, **et `renotify`
  pour que le remplacement alerte quand même** — un `tag` seul rend muets tous les
  messages suivants d'une même conversation.

## Hors scope

Infra LiveKit/TURN (spec 02), passerelle (spec 03), logique widget (package 10) ; éducation iOS (M-B).

## Objectif mesurable

Vitest + Testing Library, packages mockés : REQ-UI-19 (RtcFociMissing → message rendu ; état appel actif → bandeau) ; REQ-UIX-38 (timeout de chargement → sortie de secours ; paramètres audio vs vidéo transmis) ; REQ-UI-18 (payload mocké → notification construite à partir de l'événement déchiffré localement — spy sur l'API Notification ; feuille proposée une fois puis jamais, y compris après remontage ; `pushManager` et `getPushers` mockés → pusher écrit quand il manque, jamais quand il est là, réécrit quand l'endpoint a tourné, abonnement refait quand la clé VAPID diffère ; service worker absent → état terminal et non attente ; écran de réglages : une action pour chaque état réparable) ; REQ-UIX-40 (échec de déchiffrement → notification générique ; spy logger/cache : zéro contenu ; `renotify` et `skipWaiting` relus dans le fichier livré).
