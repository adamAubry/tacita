# Limites assumées — infra (spec 01)

Documentées, jamais masquées (spec 00 — Honnêteté produit).

- **Métadonnées en clair côté serveur.** Le contenu des messages est chiffré
  de bout en bout, mais Synapse et sa base PostgreSQL voient en clair : qui
  parle à qui (membres des salons, DM), quand (horodatage de chaque
  événement), à quelle fréquence, et la taille des pièces jointes (même
  chiffrées, la taille du blob S3 est visible). Un opérateur du serveur —
  légitime ou après compromission — peut reconstruire un graphe social complet
  et un profil d'activité sans jamais lire un message.
- **La taille d'un média dit sa durée** *(ajouté le 20/08/2026, D-11)*. AES-CTR
  ne pade pas : le chiffré fait exactement le poids du clair, à l'octet près. À
  débit quasi constant — ce que produit le pipeline (D-04) —, taille ÷ débit
  ≈ durée. La durée d'une vidéo ou d'un vocal est donc **déductible du seul
  blob**, alors qu'elle est rangée dans l'événement chiffré. Le nombre de
  médias et le rythme des envois se lisent de la même façon. **Décision D-11 :
  on ne pade pas**, parce que cet opérateur détient déjà le graphe social et le
  profil d'activité ci-dessus ; fermer cette fenêtre-là seule ne changerait pas
  ce qu'il sait. Rouvrir la question passe par cette limite-ci d'abord, pas par
  le pipeline média.
- **L'annuaire est énumérable par tout compte** *(ajouté le 21/08/2026, REQ-INF-18,
  escalade E-21 tranchée par le PM)*. `search_all_users: true` : une recherche de
  quelques lettres rend **tous** les comptes du serveur dont l'identifiant ou le nom
  d'affichage correspond, sans qu'aucun salon ne soit partagé. Autrement dit, qui a un
  compte peut dresser la liste des autres, nom d'affichage compris, en balayant les
  préfixes. C'est le prix payé pour qu'« ajouter un ami » fonctionne sans connaître par
  cœur l'identifiant exact de la personne, sur un déploiement sans salon public. Ce que
  la limite **ne** couvre pas : aucun contenu de message n'entre dans l'annuaire, qui ne
  porte que des identifiants, des noms d'affichage et des avatars — tous déjà publics au
  sens de Matrix. Rouvrir la question, c'est choisir entre l'énumération et un produit
  où l'on ne se trouve que par lien d'invitation (spec 12).
- **SSE-S3 (REQ-INF-08) n'est pas une protection de confidentialité.**
  L'opérateur du bucket détient les clés de chiffrement au repos ; ça ne
  protège que contre le vol physique du support de stockage, pas contre
  l'opérateur lui-même. La confidentialité réelle vient uniquement du
  chiffrement client (spec 08) — le bucket ne contient que des blobs opaques.
- **MinIO (dev local) : projet dont le rythme de publication a
  significativement ralenti** (dernière image : septembre 2025). Ne pas
  déployer tel quel en production sans revalidation ; voir `README.md`.
- **Changer son mot de passe transmet la clé de récupération au serveur** *(ajouté le
  25/08/2026, D-12)*. Le changement est gardé par la clé, et par elle seule : ni le mot de
  passe courant, ni aucun autre facteur ne l'autorise — une session volée ne peut donc pas
  s'approprier le compte. Le prix est que la vérification est **serveur**, donc que la clé
  y transite en clair à chaque changement. Elle n'ouvre pas un message, elle ouvre le
  magasin : un serveur qui la capte déchiffre tout l'historique du compte, passé et à
  venir. Trois précisions qui ne sont pas des détails. **Non stocké n'est pas non vu** — le
  module vérifie puis jette, mais un serveur hostile, compromis ou trop bavard dans ses
  journaux garde ce qui lui est passé sous les yeux. **L'exposition ne se rattrape pas** :
  le seul chemin de remplacement écrit ici remplace aussi la sauvegarde et l'identité, et
  rend illisible ce qui était chiffré sous l'ancienne clé — après incident, c'est garder
  une clé exposée ou perdre son historique. **Et le modèle de menace se déplace** : avant,
  un serveur compromis voyait les métadonnées et le trafic à venir, jamais l'historique ;
  désormais une seule requête captée lui ouvre tout. Ce qui rend l'arbitrage tenable est
  que ce déploiement est auto-hébergé — l'opérateur est l'auteur du produit ou son cercle.
  **Rouvrir la question passe par là avant toute autre chose** : héberger pour des tiers,
  c'est faire porter le risque à quelqu'un qui ne l'a pas accepté. Le repli est le garde
  côté client (`secretStorage.checkKey`, local, la clé ne sort pas) — une règle du produit
  et non du serveur, à écrire comme telle.
- **N'importe qui peut créer un compte** *(ajouté le 25/08/2026, D-13)*. `enable_registration:
  true` sans `registration_requires_token`, sans e-mail et sans captcha : la création de
  comptes en masse n'est bornée que par le rate limiting de REQ-INF-05, lui-même desserré
  à 10× les défauts. La conséquence qui compte n'est pas le nombre de comptes mais ce
  qu'un compte donne : l'annuaire énumérable ci-dessus, c'est-à-dire la liste des
  utilisateurs du serveur, à qui prend trente secondes pour s'inscrire. C'est l'arbitrage
  de D-13 et il tient au même motif que D-12 — déploiement auto-hébergé, cercle restreint,
  un compte indésirable se désactive à la main. **Rouvrir la question, c'est remettre
  `registration_requires_token`** — le chemin est intact — plutôt que fermer l'annuaire,
  qui ferme la conséquence et pas la cause.
- **La clé de récupération ouvre le compte à elle seule** *(ajouté le 25/08/2026, D-14)*.
  `POST /_synapse/client/tacita/login_recovery` vérifie la clé et rend un jeton de
  connexion à usage unique : c'est la porte de secours d'un mot de passe perdu, que D-12
  avait fermée sans le vouloir. Elle déplace ce que vaut la clé — avant, la détenir sans
  session ne donnait rien ; désormais elle donne le compte, historique compris, puisque
  c'est aussi elle qui déchiffre. **Un facteur, plus deux.** Ce qui borne la porte :
  limitation de débit par IP (limiteur de connexion du serveur, REQ-INF-05), refus
  indifférencié pour toutes les causes, et un compte désactivé qui ne se rouvre pas — sans
  quoi la désactivation, seule réponse de D-13 à un compte indésirable, se contournerait
  avec un secret que ce compte détient déjà. **Rouvrir la question**, c'est exiger un
  second facteur sur cette route ou rétablir un vrai chemin de réinitialisation, ce qui
  suppose de rouvrir D-12 d'abord.
- **Le mot de passe protège l'historique chiffré** *(ajouté le 25/08/2026, D-15)*. La clé
  de secret storage est dérivée du mot de passe du compte (`m.pbkdf2`), ce qui permet de
  se connecter sur un appareil neuf sans rien saisir d'autre. Le descripteur — sel, `iv`,
  `mac` — est de l'account data, donc lisible par le serveur : **une attaque hors ligne
  sur le mot de passe devient possible**, et un mot de passe faible rend alors la clé qui
  déchiffre tout. Le plancher est de 8 caractères. Avant D-15, une clé de 256 bits tirée
  au hasard fermait cette porte, au prix d'un secret de plus à retenir à chaque connexion.
  Conséquence à connaître aussi : D-12 change le mot de passe **sans re-dériver la clé** —
  après un changement, la connexion silencieuse cesse et l'écran de saisie revient une
  fois par appareil neuf. **Rouvrir la question**, c'est revenir à la clé aléatoire (le
  code la produit encore quand aucune phrase de passe n'est fournie) ou relever le
  plancher de mot de passe.
