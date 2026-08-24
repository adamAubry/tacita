# Limites assumées — passerelle push (spec 03)

Documentées, jamais masquées (spec 00 — Honnêteté produit).

- **iOS : notifications uniquement si la PWA est ajoutée à l'écran d'accueil.**
  Le Web Push n'est disponible sur iOS que pour une application web installée
  via « Sur l'écran d'accueil ». Un utilisateur qui reste dans **Safari** ne
  recevra **jamais** de notification, quel que soit l'état de la passerelle :
  il n'y a ni contournement ni repli. L'UI doit porter cette contrainte
  explicitement (spec 11) ; ce module ne fait que la documenter.
- **Aucune garantie de livraison.** Pas de file persistante, pas de retry : si
  le push service est indisponible, la notification est perdue. Le message,
  lui, ne l'est pas — il arrive au `/sync` suivant. La notification est un
  confort, pas un canal de transport.
- **La notification ne contient aucun texte.** Le payload transporte
  `event_id` et `room_id` seulement (REQ-PSH-02) : le serveur ne voit jamais
  de clair, donc il ne peut rien mettre dans la notification. L'aperçu affiché
  dépend du déchiffrement local au réveil du service worker ; s'il échoue
  (clés absentes, appareil non vérifié), la notification reste générique.
- **Métadonnées visibles par le push service.** Mozilla, Google ou Apple, selon
  le navigateur, voient l'endpoint sollicité et l'horodatage de chaque push —
  donc la fréquence et les moments d'activité, sans le contenu.
- **Rotation des clés VAPID = réabonnement de tous les clients.** Changer la
  paire invalide toutes les subscriptions existantes. **Elles ne remontent pas
  en `rejected`** — corrigé le 24/08/2026 : le push service répond `403`
  (signature VAPID qui ne correspond pas), et non `404`/`410`. Le pusher reste
  donc en place sur le compte, définitivement muet, sans que rien ne le signale
  côté serveur. C'est le client qui s'en sort : il compare la clé de son
  abonnement à celle servie par `/config` à chaque ouverture, et se réabonne
  quand elles diffèrent (REQ-UI-18). Sur un navigateur qui n'expose pas
  `PushSubscription.options.applicationServerKey`, cette comparaison est
  impossible et l'abonnement est **conservé** : s'y réabonner « dans le doute »
  changerait d'endpoint à chaque ouverture et laisserait un pusher mort derrière
  chaque fois. Après une rotation, ces navigateurs-là ne se rattrapent qu'en
  vidant les données du site.
- **Durée de vie d'un push : 24 heures** (`TTL`), et non les 28 jours par défaut
  de `web-push`. Un appareil éteint plus longtemps ne recevra pas les
  notifications de la période — il retrouvera les messages au `/sync` suivant.
  C'est un choix : un « nouveau message » remis trois semaines plus tard n'est
  plus une notification.
