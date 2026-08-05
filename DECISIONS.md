# DECISIONS.md — Arbitrages produit tranchés

Décisions PM fermes. Les specs s'y réfèrent par leur ID. Toute remise en cause passe par le PM, pas par un contournement dans le code.

## D-01 — Plafond de l'index de recherche local
**Décision : plafond en nombre d'événements, 200 000, éviction par ancienneté (FIFO).**
Un plafond en octets est difficile à mesurer de façon fiable en IndexedDB ; un compteur d'événements est trivial à tester. 200 000 messages couvrent plusieurs années d'usage personnel. Pas de fenêtre temporelle en plus : un seul critère, un seul chemin de purge (YAGNI).

## D-02 — Politique de rétention serveur
**Décision : rétention illimitée, identique DM et groupes, pour messages et médias.**
L'application remplace les DM Instagram : l'historique complet est une attente produit. La politique est *définie explicitement* dans `homeserver.yaml` pour satisfaire l'exigence « politique de rétention définie » sans supprimer de données. Révisable post-V1 si le coût S3 le justifie. Purger un média casserait les messages qui le référencent.

**Révision 03/08/2026 — la décision est inchangée, le moyen change.** La formulation initiale (« retention activée, pas de purge programmée ») reposait sur une hypothèse fausse, vérifiée dans la doc Synapse v1.155 : `retention.enabled: true` avec `purge_jobs: []` installe un **job de purge quotidien par défaut**, et fait honorer les politiques par salon `m.room.retention` — deux chemins de purge que cette décision proscrit. Le moyen devient : bloc `retention` présent, commenté, **`enabled: false`**. « Politique définie » signifie bloc explicite dans la config, pas fonctionnalité active.

## D-03 — Format de sortie des vocaux
**Décision : Ogg/Opus, format de sortie unique, quel que soit le navigateur d'origine.**
Un format propriétaire MP4/AAC rendrait les vocaux iPhone illisibles par tout client Matrix standard et créerait deux chemins de lecture. Le coût du transcodage est payé une fois, à l'envoi, sur l'appareil de l'auteur.

**Révision 06/08/2026 — la décision est inchangée, le moyen se rouvre (escalade E-10).** Le titre initial disait « transcodage WASM vers Ogg/Opus obligatoire » et laissait croire que le WASM était lié. **C'est le format qui l'est, et lui seul** : le motif écrit ci-dessus ne parle que de lisibilité par les autres clients. Le WASM était le moyen connu au moment de la décision, pas sa fin. Toute implémentation qui produit de l'Ogg/Opus respecte D-03, y compris sans WASM.

**Où vit le transcodage — tranché avec la révision.** Muxeurs et encodeurs prennent des octets et rendent des octets : ils n'ont aucun DOM et vivent dans `packages/media-pipeline`, dont la spec 08 sanctionne déjà le WASM. Le shard ne garde que les appels navigateur (`MediaRecorder`, `WebCodecs`) dans son `MediaEnvironment`. **REQ-UI-02 n'est pas amendée** : on n'ouvre une liste close que lorsqu'il n'existe aucun autre lieu — c'était le cas de `@stylexjs/stylex`, peer dependency d'Astryx ; ce n'est pas le cas d'un codec. Détail et branches dans `specs/ui/ESCALATIONS.md` § E-10.

## D-04 — Seuils de compression adaptative
**Décision : deux profils réseau, détectés via Network Information API (`effectiveType`), profil « bon réseau » par défaut si l'API est absente (Safari).**

| | Bon réseau (wifi, 4g) | Réseau contraint (3g et moins, saveData) |
|---|---|---|
| Image | max 2048 px côté long, qualité 0.8 | max 1280 px, qualité 0.7 |
| Vidéo | 720p, 2.5 Mbps | 480p, 1 Mbps |

Formats de sortie : JPEG (images), MP4/H.264 (vidéos — lisible partout, la vidéo n'a pas la contrainte d'interop Opus). Pas de 3e profil, pas de réglage utilisateur en V1.

## D-05 — Index de recherche et rotation de session Megolm
**Décision : aucune réindexation, incrémental pur.**
L'index stocke du texte déjà déchiffré ; une rotation de session ne change rien aux événements passés, elle ne concerne que le chiffrement des messages futurs. La rotation est donc un non-événement pour l'index. Seul cas d'invalidation : purge D-01 ou déconnexion (wipe complet de l'index avec le reste des données locales).

## D-06 — Stockage local des credentials de session
**Décision : le jeton d'accès est stocké en clair en IndexedDB (base `tacita-session`).**
Le fait qui la motive : `initRustCrypto` tourne sans clé de pickle, donc l'état crypto voisin — clés Megolm comprises — est déjà en clair dans la même IndexedDB. Chiffrer le seul jeton en laissant les clés à côté présenterait une garantie que le module n'offre pas (interdit n°13). **Conséquence assumée, documentée dans `packages/client-core/README.md` : qui a accès au profil du navigateur a accès au compte et à l'historique déchiffrable.** Relever le niveau exige une clé de pickle sur le store crypto *et* un écran de déverrouillage à chaque ouverture — décision produit post-V1, qui touche la spec 11 et mérite sa propre spec ; elle n'est pas prise ici. (Ratifie la décision de séance du 03/08/2026, défaut C4.)

## D-07 — Résolution de `SERVER_NAME` et frontière dev/prod
**Décision : en production, `SERVER_NAME` résout publiquement et porte un certificat réel (Let's Encrypt). Le magasin de confiance de l'image Synapse n'est jamais modifié.**
Le certificat réel est déjà exigé par ailleurs (REQ-INF-10 : contexte sécurisé pour la PWA et getUserMedia) ; un split-horizon DNS ajouterait de la configuration sans gain de confidentialité (les métadonnées sont déjà une limite assumée, REQ-INF-13). Les trois causes du 503 OIDC (escalade du 03/08/2026) sont donc **locales au dev** — un déploiement sans hairpin NAT utilise les deux leviers déjà livrés, alias réseau sur le proxy et `SYNAPSE_IP_RANGE_WHITELIST`, qui sont de la configuration de déploiement documentée, pas des artefacts de dev. `infra/README.md` doit porter la vérification de pré-vol : depuis le conteneur Synapse, la découverte OIDC (`https://${SERVER_NAME}/auth/realms/tacita/.well-known/…`) répond 200 avant toute création de compte.
**Corollaire ferme, qui fait jurisprudence : aucun besoin de développement ne modifie un artefact de production.** Les écarts dev/prod vivent dans des overlays explicites (`infra/smoke/`, patron `rtc/`) — y compris la confiance du certificat de dev, qui s'installe par montage + `update-ca-certificates` au démarrage dans l'overlay, jamais dans le Dockerfile.

## D-08 — Modèle de confiance des appareils (partage des clés Megolm)
**Décision : la confiance se porte sur l'identité cross-signing, pas sur une vérification manuelle par appareil.**
Les clés Megolm sont partagées avec les appareils **signés par l'identité cross-signing de leur propriétaire**, et avec eux seuls. REQ-COR-06 rend ce bootstrap obligatoire à l'inscription : tout appareil légitime est signé. Un appareil injecté côté serveur, sans les secrets de l'utilisateur, ne porte pas cette signature et ne reçoit rien — la protection que REQ-INF-11 existe pour fournir est préservée, ce que le TOFU par appareil (défaut Element) aurait cédé. Une réinitialisation d'identité **bloque l'envoi vers cet utilisateur jusqu'à confirmation explicite dans l'UI** — pas un avertissement ignorable.
**Ce que la décision refuse :** la rédaction initiale de REQ-COR-07 (vérification manuelle par appareil), garantie plus forte sur le papier, mais qu'aucune spec n'outillait : le produit livré n'aurait pas permis à deux personnes de se parler. Une garantie qui empêche le produit d'exister n'en est pas une (interdit n°13, dans les deux sens). **Ce que la décision cède, documenté côté utilisateur :** la compromission complète du compte d'un correspondant (ses secrets cross-signing) rend ses signatures menteuses ; la parade — épingler l'identité par vérification interactive SAS/QR — est le chemin de relèvement, spec dédiée post-V1.

## D-09 — Modèle social V1 : comment on se relie à quelqu'un
**Décision : le lien social passe par les mécanismes Matrix natifs, sauf l'invitation par lien, qui obtient un service dédié.** *(Tranchée le 05/08/2026 — escalades E-02, E-03, E-04, E-05 ; le détail et les motifs sont dans `specs/ui/ESCALATIONS.md`.)*

**« Ami » = DM existant.** Une demande d'ami est une invitation de salon DM native (accepter = join, refuser = leave) ; bloquer se fait par `m.ignored_user_list` ; retirer un ami, en quittant le DM. **Pas de service de graphe social** : il verrait qui parle à qui pour rendre un service que le natif rend déjà. Les suggestions d'amis n'ont donc **aucune source de données** et l'écran ne prétend pas le contraire.

**La note privée sur un profil reste locale à l'appareil**, en IndexedDB, jamais synchronisée, avec le libellé « visible uniquement sur cet appareil ». L'account data Matrix est en clair côté serveur : synchroniser une note sur un correspondant y déposerait exactement le genre de contenu que le principe directeur protège. La note suit l'appareil, pas l'utilisateur — et c'est définitif, pas une étape.

**Pas de messages éphémères.** Ils contrediraient D-02 et exigeraient des purges serveur. L'option n'apparaît pas dans l'UI, pas même grisée : une option grisée est une promesse non tenue affichée (interdit n°13).

**L'invitation par lien obtient un service de tokens côté serveur** — `specs/12-invite-tokens.md`. C'est la seule pièce non native, parce qu'aucun mécanisme Matrix ne porte un lien partageable à durée de vie bornée. **Son cadre est étroit et il est écrit : un utilisateur existant ajoute un autre utilisateur existant.** Tout ce qui en sort a un comportement défini et un message honnête — jamais une erreur technique, jamais une inscription que `enable_registration: false` interdit. **Ce que la décision cède, à documenter côté utilisateur :** un composant serveur de plus apprend qui invite qui. C'est de la métadonnée, jamais du contenu, et elle rejoint la limite déjà assumée par REQ-INF-13.
