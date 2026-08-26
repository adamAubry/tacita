# DECISIONS.md — Arbitrages produit tranchés

Décisions PM fermes. Les specs s'y réfèrent par leur ID. Toute remise en cause passe par le PM, pas par un contournement dans le code.

**D-01 à D-15 sont fermes.** Une entrée peut aussi porter, **et seulement si elle le dit en tête**, des notes de conception non normatives et des points **ouverts, non tranchés** — il n'y en a plus au 20/08/2026, D-11 ayant été tranchée le jour même. Rien dans le code ne peut se réclamer d'un point ouvert tant qu'il n'est pas tranché : une note de conception n'est pas une exigence, et aucun test ne la nomme. *(Ajouté le 20/08/2026, avec D-10 et D-11.)*

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

**Où vit le transcodage — tranché avec la révision.** Muxeurs et encodeurs prennent des octets et rendent des octets : ils n'ont aucun DOM et vivent dans `packages/media-pipeline`, dont le contrat sanctionne déjà le WASM. Le shard ne garde que les appels navigateur (`MediaRecorder`, `WebCodecs`) dans son `MediaEnvironment`. ** n'est pas amendée** : on n'ouvre une liste close que lorsqu'il n'existe aucun autre lieu — c'était le cas de `@stylexjs/stylex`, peer dependency d'Astryx ; ce n'est pas le cas d'un codec. Détail et branches en E- E-10.

**Portée précisée le 20/08/2026 — E-20.** D-03 porte sur les **messages vocaux** (`m.audio`), et sur eux seuls. La **piste audio d'une vidéo** n'entre pas dans son périmètre : elle est gouvernée par D-04, et son format est l'AAC-LC (). Écrit ici parce que rien ne le disait, et qu'« AAC » lu à côté de « D-03 » passe pour une violation.

## D-04 — Seuils de compression adaptative
**Décision : deux profils réseau, détectés via Network Information API (`effectiveType`), profil « bon réseau » par défaut si l'API est absente (Safari).**

| | Bon réseau (wifi, 4g) | Réseau contraint (3g et moins, saveData) |
|---|---|---|
| Image | max 2048 px côté long, qualité 0.8 | max 1280 px, qualité 0.7 |
| Vidéo | 720p, 2.5 Mbps | 480p, 1 Mbps |

Formats de sortie : JPEG (images), MP4/H.264 (vidéos — lisible partout, la vidéo n'a pas la contrainte d'interop Opus). Pas de 3e profil, pas de réglage utilisateur en V1.

**Révision 20/08/2026 — les cibles vidéo se précisent, et la vidéo gagne une piste audio (E-18, E-20).** Les deux profils et leur détection ne changent pas ; la ligne « Vidéo » du tableau se lit désormais ainsi :

| Vidéo | Bon réseau | Réseau contraint |
|---|---|---|
| Hauteur | `min(hauteur source, 720)` | `min(hauteur source, 480)` |
| Débit | ~2,5 Mbit/s, **mode variable** | ~1 Mbit/s, mode variable |
| Profil H.264 | **High**, repli Main puis Baseline | idem |
| Image clé | toutes les 2 s (inchangé) | idem |
| Piste audio | AAC-LC, 128 kbit/s stéréo / 96 kbit/s mono, 44,1 ou 48 kHz | idem |

Quatre motifs, un par ligne modifiée :

- **La hauteur est bornée par la source.** « 720p » se lisait comme une cible et non comme un plafond : une source 480p était *agrandie* — plus grosse, plus moche, plus lente à produire. `min(source, plafond)` est ce que la décision voulait dire, et ce que le tableau dit maintenant.
- **Profil High plutôt que Baseline.** Baseline interdit CABAC et les B-frames : 15 à 25 % de débit perdu à qualité perçue égale. L'échelle de repli — High, puis Main, puis Baseline — est retenue à la **première configuration supportée**, mesurée et non supposée. *(Conséquence d'implémentation à ne pas manquer : les B-frames impliquent des horodatages de présentation différents de ceux de décodage, donc une table `ctts` dans le conteneur.)*
- **Débit variable.** Un débit fixe gaspille sur une source statique et sature sur du mouvement rapide.
- **Piste audio.** Le format et ses bornes vivent ici ; l'obligation, son unique repli honnête — partir muet, en le disant — et l'interdiction de tout autre repli vivent dans. **D-03 n'est pas concernée**, voir la précision de portée ajoutée ci-dessus.

**Source déjà conforme aux cibles ⇒ remuxage seul, pas de réencodage (E-18).** Réencoder ce qui respecte déjà les plafonds coûte une génération de perte et une attente, sans rien rendre. Le remuxage, lui, reste dû : le passthrough brut du fichier source ferait sortir du pipeline un conteneur que rien n'a normalisé, ce que amendée continue d'interdire.

## D-05 — Index de recherche et rotation de session Megolm
**Décision : aucune réindexation, incrémental pur.**
L'index stocke du texte déjà déchiffré ; une rotation de session ne change rien aux événements passés, elle ne concerne que le chiffrement des messages futurs. La rotation est donc un non-événement pour l'index. Seul cas d'invalidation : purge D-01 ou déconnexion (wipe complet de l'index avec le reste des données locales).

## D-06 — Stockage local des credentials de session
**Décision : le jeton d'accès est stocké en clair en IndexedDB (base `tacita-session`).**
Le fait qui la motive : `initRustCrypto` tourne sans clé de pickle, donc l'état crypto voisin — clés Megolm comprises — est déjà en clair dans la même IndexedDB. Chiffrer le seul jeton en laissant les clés à côté présenterait une garantie que le module n'offre pas (interdit n°13). **Conséquence assumée, documentée dans `packages/client-core/README.md` : qui a accès au profil du navigateur a accès au compte et à l'historique déchiffrable.** Relever le niveau exige une clé de pickle sur le store crypto *et* un écran de déverrouillage à chaque ouverture — décision produit post-V1, qui touche `apps/web` et mérite sa propre spec ; elle n'est pas prise ici. (Ratifie la décision de séance du 03/08/2026, défaut C4.)

## D-07 — Résolution de `SERVER_NAME` et frontière dev/prod
**Décision : en production, `SERVER_NAME` résout publiquement et porte un certificat réel (Let's Encrypt). Le magasin de confiance de l'image Synapse n'est jamais modifié.**
Le certificat réel est déjà exigé par ailleurs (contexte sécurisé pour la PWA et getUserMedia) ; un split-horizon DNS ajouterait de la configuration sans gain de confidentialité (les métadonnées sont déjà une limite assumée). Les trois causes du 503 OIDC (escalade du 03/08/2026) sont donc **locales au dev** — un déploiement sans hairpin NAT utilise les deux leviers déjà livrés, alias réseau sur le proxy et `SYNAPSE_IP_RANGE_WHITELIST`, qui sont de la configuration de déploiement documentée, pas des artefacts de dev. `infra/README.md` doit porter la vérification de pré-vol : depuis le conteneur Synapse, la découverte OIDC (`https://${SERVER_NAME}/auth/realms/tacita/.well-known/…`) répond 200 avant toute création de compte.
**Corollaire ferme, qui fait jurisprudence : aucun besoin de développement ne modifie un artefact de production.** Les écarts dev/prod vivent dans des overlays explicites (`infra/smoke/`, patron `rtc/`) — y compris la confiance du certificat de dev, qui s'installe par montage + `update-ca-certificates` au démarrage dans l'overlay, jamais dans le Dockerfile.

## D-08 — Modèle de confiance des appareils (partage des clés Megolm)
**Décision : la confiance se porte sur l'identité cross-signing, pas sur une vérification manuelle par appareil.**
Les clés Megolm sont partagées avec les appareils **signés par l'identité cross-signing de leur propriétaire**, et avec eux seuls. rend ce bootstrap obligatoire à l'inscription : tout appareil légitime est signé. Un appareil injecté côté serveur, sans les secrets de l'utilisateur, ne porte pas cette signature et ne reçoit rien — la protection que existe pour fournir est préservée, ce que le TOFU par appareil (défaut Element) aurait cédé. Une réinitialisation d'identité **bloque l'envoi vers cet utilisateur jusqu'à confirmation explicite dans l'UI** — pas un avertissement ignorable.
**Ce que la décision refuse :** la rédaction initiale (vérification manuelle par appareil), garantie plus forte sur le papier, mais qu'aucun contrat n'outillait : le produit livré n'aurait pas permis à deux personnes de se parler. Une garantie qui empêche le produit d'exister n'en est pas une (interdit n°13, dans les deux sens). **Ce que la décision cède, documenté côté utilisateur :** la compromission complète du compte d'un correspondant (ses secrets cross-signing) rend ses signatures menteuses ; la parade — épingler l'identité par vérification interactive SAS/QR — est le chemin de relèvement, spec dédiée post-V1.

## D-09 — Modèle social V1 : comment on se relie à quelqu'un
**Décision : le lien social passe par les mécanismes Matrix natifs, sauf l'invitation par lien, qui obtient un service dédié.** *(Tranchée le 05/08/2026 — escalades E-02, E-03, E-04, E-05 ; le détail et les motifs sont dans ces escalades.)*

**« Ami » = DM existant.** Une demande d'ami est une invitation de salon DM native (accepter = join, refuser = leave) ; bloquer se fait par `m.ignored_user_list` ; retirer un ami, en quittant le DM. **Pas de service de graphe social** : il verrait qui parle à qui pour rendre un service que le natif rend déjà. Les suggestions d'amis n'ont donc **aucune source de données** et l'écran ne prétend pas le contraire.

**La note privée sur un profil reste locale à l'appareil**, en IndexedDB, jamais synchronisée, avec le libellé « visible uniquement sur cet appareil ». L'account data Matrix est en clair côté serveur : synchroniser une note sur un correspondant y déposerait exactement le genre de contenu que le principe directeur protège. La note suit l'appareil, pas l'utilisateur — et c'est définitif, pas une étape.

**Pas de messages éphémères.** Ils contrediraient D-02 et exigeraient des purges serveur. L'option n'apparaît pas dans l'UI, pas même grisée : une option grisée est une promesse non tenue affichée (interdit n°13).

**L'invitation par lien obtient un service de tokens côté serveur** — `apps/invite-tokens`. C'est la seule pièce non native, parce qu'aucun mécanisme Matrix ne porte un lien partageable à durée de vie bornée. **Son cadre est étroit et il est écrit : un utilisateur existant ajoute un autre utilisateur existant.** Tout ce qui en sort a un comportement défini et un message honnête — jamais une erreur technique, jamais une inscription que `enable_registration: false` interdit. **Ce que la décision cède, à documenter côté utilisateur :** un composant serveur de plus apprend qui invite qui. C'est de la métadonnée, jamais du contenu, et elle rejoint la limite déjà assumée par.

## D-10 — Refonte du pipeline vidéo : ce qui est amendé, et ce qui ne l'est pas
**Tranchée le 20/08/2026.** Les contrats sont amendés **avant** l'implémentation, qui sera écrite contre eux. Aucun code, aucun test, aucune configuration n'a été touché par cette passe — c'est la condition qui rend l'exercice utile : un contrat amendé après coup ne fait que ratifier ce qui est déjà écrit.

| # | Amendement | E-xx | Où |
|---|---|---|---|
| 1 | « Muxeurs sans dépendance » s'ouvre au **démuxage et au muxage de conteneur**, sous régime d'épinglage (règle 5). E-10 intacte, « zéro DOM » intacte, aucune bibliothèque nommée | E-17 | `@tacita/media-pipeline` § Méthode |
| 2 | Portée de « le destinataire ne reçoit que la version compressée » : **le chemin de capture in-app**. La propriété protégée devient le **conteneur normalisé unique en sortie** ; remuxage conforme, passthrough brut interdit | E-18 | `@tacita/media-pipeline` |
| 3 | Source déjà conforme aux cibles ⇒ **remuxage seul**. Conséquence UI : message d'échec de compression dédié, distinct de l'absence de bouton | E-18 | `@tacita/media-pipeline`, D-04 |
| 4 | liste close des types rendus, vidéo **et** image, par défaut de refus ; `application/octet-stream` cesse d'être un repli ; support du codec vérifié avant d'afficher un lecteur | E-19 | `@tacita/media-pipeline` |
| 5 | piste audio AAC-LC ; muet assumé et dit plutôt qu'un conteneur non éprouvé. **D-03 mise hors sujet explicitement** | E-20 | `@tacita/media-pipeline`, D-03, D-04 |
| 6 | orientation préservée. Elle ne l'était que par accident du canvas | — | `@tacita/media-pipeline` |
| 7 | **Reformulée en principe** : aucun octet servi, rendu ou écrit sans vérification réussie ; hash global et hachage par blocs énumérés comme mécanismes conformes. Note sur l'intégrité par transitivité via l'enveloppe Megolm | E-23 | `@tacita/media-pipeline` |
| 8 | deux plafonds de taille en réception, et le schéma « vérification globale puis déchiffrement par tranches » déclaré conforme | — | `@tacita/media-pipeline` |
| 9 | cache de ciphertext, inscrit au registre de wipe | E-21 | `@tacita/media-pipeline` |
| 10 | **Reprise de téléversement** — elle appartient à la file ; le pipeline expose une étape idempotente et ne retente pas seul. **Les deux portées amendées dans la même passe** | E-22 | `@tacita/outbox`, `@tacita/media-pipeline` |
| 11 | Cibles d'encodage : hauteur bornée par la source, profil High avec repli mesuré, débit variable, image clé inchangée | — | D-04 |

**Ce que cette passe ne fait pas.** Elle ne nomme aucune bibliothèque, ne tranche pas le padding (D-11), et n'écrit aucune REQ pour le hachage par blocs — dont la phase n'est pas ordonnancée. Les deux notes ci-dessous préparent cette phase ; ce sont des **notes de conception, pas des exigences**, et aucun test ne les nomme.

### Note de conception — bornes du service worker (préparation du hachage par blocs)

Il n'y a **qu'un service worker par scope** : celui qui servirait les médias **sera** celui du push, donc réveillé hors de toute page. La borne ne peut pas être architecturale — on ne peut pas « avoir un autre SW » —, elle doit être structurelle et vérifiable. À écrire le moment venu, sous cette forme :

- table des clés en portée module, **en mémoire**, vide au démarrage à froid ;
- alimentée **uniquement** par `postMessage` depuis un client vivant ;
- jamais persistée, et **jamais de `caches.put` d'une réponse déchiffrée** (interdit n°8) ;
- purgée à la terminaison du worker ;
- URL virtuelle non devinable, liée à la durée de vie de la page ;
- le handler `push` **ne lit jamais** cette table.

Et le test qui rend la borne réelle, sans lequel elle n'est qu'un commentaire : **SW démarré à froid par un push ⇒ table vide ⇒ aucune requête média servie tant qu'aucun client n'a posté de clé.**

### Note de conception — champ propriétaire des hashes par blocs

Le champ portant la liste des hashes est namespacé **`org.tacita.*`**, documenté comme nôtre, et **jamais présenté comme du Matrix natif** — même discipline que l'accusé « délivré » (interdit n°9). `hashes.sha256` standard est **conservé en parallèle**. Double chemin en réception : champ présent ⇒ progressif ; absent ⇒ chemin legacy inchangé, donc aucune régression avec Element.

### Note instruite — persistance de l'outbox et clés de fichier (question posée avec E-22)

Si la file reprend un téléversement après redémarrage, le chiffré doit être persisté, et la clé AES du fichier vit dans le contenu de l'événement en attente. La question posée était : ce store est-il chiffré au repos, et crée-t-on un chemin où clé et chiffré coexistent hors de l'enveloppe Megolm ?

**Les faits, relevés dans le code et les specs.** `OutboxEntry.content` est stocké **tel quel** en IndexedDB (`packages/outbox/src/entry.ts`), sans chiffrement au repos : un `m.video` en attente porte donc déjà `file.key` en clair, aujourd'hui, indépendamment de toute reprise de téléversement.

**C'est déjà arbitré, et l'arbitrage est D-06.** `initRustCrypto` tourne sans clé de pickle : les **clés Megolm** sont déjà en clair dans la même IndexedDB, et D-06 en tire la conséquence en toutes lettres — « qui a accès au profil du navigateur a accès au compte et à l'historique déchiffrable ». Une clé de fichier posée à côté d'elles n'ajoute rien au modèle de menace ; persister le chiffré non plus. Le même raisonnement vaut pour l'intégrité, qui est le point sensible de la note de : un attaquant local capable de réécrire le store détient déjà les clés Megolm, donc peut forger l'événement entier — il n'a aucun besoin de substituer un média.

**Ce qui déplacerait la conclusion** est nommé par D-06 et reste post-V1 : une clé de pickle sur le store crypto **plus** un écran de déverrouillage à chaque ouverture. Le jour où cette décision sera prise, le store de la file et le cache de ciphertext devront entrer dans le même périmètre — sans quoi on chiffrerait la serrure en laissant la porte.

## D-11 — Padding de taille des blobs médias (E-24)
**Décision : on ne pade pas. La conséquence documentaire est due, et elle est écrite.** *(Tranchée le 20/08/2026, après instruction. L'entrée est restée ouverte le temps que le dossier soit constitué ; le paragraphe « ce qui manque pour trancher » ci-dessous a été suivi jusqu'au bout, et sa réponse est ici.)*

**Le motif tient en une phrase : la concession existait déjà.** D-09 accorde explicitement à un opérateur de serveur — légitime ou après compromission — le graphe social complet et le profil d'activité : qui parle à qui, quand, à quelle fréquence. Le poids d'une pièce jointe appartient au même ensemble, et le dépôt le documentait déjà nommément. Pader les médias sans rouvrir protégerait la durée d'une vidéo devant un observateur à qui l'on donne déjà la liste de ses correspondants et le rythme de ses échanges : ce serait payer quelques pour cent de bande passante pour fermer une fenêtre dans un mur qui n'en a pas.

**Ce qui est dû en échange, et qui est fait** : la documentation cesse de laisser entendre que le serveur n'apprend rien. Le fait à écrire n'était pas « la taille est visible » — il l'était déjà — mais son **inférence** : à débit quasi constant, taille ÷ débit ≈ durée. Cacher `duration` dans l'événement chiffré ne cache donc pas la durée, et personne ne l'avait écrit. Interdit n°13, règle 5 : tenir la promesse ou la retirer.

**Ce qui rouvrirait la décision, et dans quel ordre.** Si le modèle de menace devait inclure un opérateur qui fait de l'analyse de trafic, **c'est qu'il faudrait rouvrir d'abord** : le padding des médias n'en serait qu'une pièce, et la poser seule laisserait l'essentiel du signal. Deux points à ne pas perdre ce jour-là — le padding doit tomber **à l'intérieur de la zone hachée**, avec troncature après vérification, ce qui demande désormais de rouvrir le hachage par blocs (livré le 20/08/2026) et non d'ajouter une couche ; et la **vignette est un second blob** dont la taille et l'horodatage corrèlent avec le premier.

<details>
<summary>Le dossier d'instruction, conservé</summary>


**Le fait.** AES-CTR ne pade pas : la taille du chiffré est celle du clair à l'octet près. À débit quasi constant, taille ÷ débit ≈ durée. On cache donc la durée dans l'événement chiffré et on la redonne par canal latéral.

**Options, avec leur coût.**

| Option | Ce qu'elle laisse fuir | Ce qu'elle coûte |
|---|---|---|
| Buckets de 256 KiB | granularité réduite, inférence pas supprimée | ~128 KiB par fichier en moyenne, quelques % de bande passante |
| Puissances de 2 | quasi rien | jusqu'à 100 % de surcoût — inacceptable en mobile |
| Ne rien faire | taille, donc durée, compte de médias, rythme d'échange | rien |

**La conséquence documentaire est inconditionnelle.** Si le choix est « ne rien faire », la documentation doit cesser de laisser entendre que le serveur n'apprend rien — tenir la promesse ou la retirer (interdit n°13). *À verser au dossier : le dépôt documente **déjà** la fuite, et nommément la taille des pièces jointes (« même chiffrées, la taille du blob S3 est visible »). L'option « ne rien faire » ne demande donc pas d'écrire une limite nouvelle — seulement de vérifier que le principe directeur de `CLAUDE.md` et `@tacita/media-pipeline` ne promettent pas plus que ce qui est concédé.*

**Deux points à ne pas perdre si le choix est de pader.** Le padding doit tomber **à l'intérieur de la zone hachée**, avec troncature **après** vérification — il se conçoit donc **avec** le hachage par blocs, jamais après, sous peine de dessiner le découpage deux fois. Et la **vignette est un second blob** dont la taille et l'horodatage corrèlent avec le premier : un padding qui ne couvrirait que le média principal laisserait passer l'essentiel du signal.

**Ce qui manquait pour trancher** : le modèle de menace, et lui seul. La question n'était pas technique — les trois options sont implémentables — mais produit : **inclut-on un opérateur de serveur qui fait de l'analyse de trafic dans ce contre quoi Tacita protège ?** D-09 et concèdent déjà le graphe social et le profil d'activité à cet opérateur. Cette concession tient : c'est la réponse, et elle est en tête de section.

</details>

---

## D-12 — La clé de récupération garde le changement de mot de passe, côté serveur

**Décision : oui, et le serveur voit donc la clé.** *(Tranchée le 25/08/2026, après instruction. Elle amende le principe directeur de `CLAUDE.md`, qui pointe ici.)*

**Ce qui est décidé.** L'authentification passe à Synapse natif (login + mot de passe, Keycloak supprimé — réécrite). Le changement de mot de passe est gardé par la **clé de récupération**, et par elle seule : ni le mot de passe courant, ni aucun autre facteur ne l'autorise. La vérification est **serveur**, donc opposable à tout client.

**Ce que ça coûte, et qui est le fond de l'arbitrage.** La clé transite en clair vers le serveur à chaque changement. Elle n'ouvre pas un message : elle ouvre le magasin. Un serveur qui la capte déchiffre tout l'historique du compte, passé et à venir. Trois précisions qui ne sont pas des détails :

- **Non stocké n'est pas non vu.** Le module vérifie puis jette ; un serveur hostile, compromis ou trop bavard dans ses journaux garde ce qui lui est passé sous les yeux.
- **L'exposition ne se rattrape pas.** Le seul chemin de remplacement écrit ici — `setupRecoveryKey({ reinitialiser: true })` — remplace aussi la sauvegarde et l'identité, et rend illisible ce qui était chiffré sous l'ancienne clé. Une rotation non destructive est concevable, elle n'existe pas. Après incident : garder une clé exposée, ou perdre son historique.
- **Le modèle de menace se déplace.** Avant, un serveur compromis voyait les métadonnées et le trafic à venir, jamais l'historique. Désormais, une seule requête captée lui ouvre tout.

**Pourquoi c'est tenable ici.** Déploiement auto-hébergé : l'opérateur est l'auteur du produit ou son cercle. C'est la seule raison pour laquelle la concession passe.

**Pourquoi la forme est celle-là et pas un stage UIA.** Vérifié dans l'image Synapse v1.155.0 : `password_enabled_for_login` et `password_enabled_for_reauth` ne se séparent pas — `enabled: true` donne les deux, `false` aucun, `only_for_reauth` l'inverse de ce qu'on veut. Un stage UIA maison serait donc offert **à côté** de `m.login.password`, qui resterait acceptable : le garde serait décoratif. Un module ne contourne rien, `get_supported_login_types` filtre `m.login.password` par le même drapeau. La forme retenue est donc : `POST /_matrix/client/v3/account/password` bloqué au proxy, et un endpoint de module qui exige la clé.

**Ce qui rouvre la décision, avant toute autre** : héberger pour des tiers. L'opérateur cesse alors d'être celui qui accepte le risque, et c'est lui qui le porte pour d'autres. Le repli est le garde côté client (`secretStorage.checkKey`, local, la clé ne sort pas) — une règle du produit et non du serveur, à écrire comme telle.


---

## D-13 — L'inscription est ouverte, sans code d'invitation

**Décision : `registration_requires_token` est retiré. N'importe qui peut créer un compte depuis l'app, avec un identifiant et un mot de passe.** *(Tranchée le 25/08/2026, après instruction, quelques heures après D-12 qui avait ouvert l'inscription en la gardant.)*

**Ce qui est décidé.** Créer un compte ne demande plus rien d'autre que les deux champs de l'écran de connexion : plus de code d'invitation, plus d'étape hors de l'app, plus de dépendance à un opérateur qui émet le jeton. `registration_requires_token` disparaît de `homeserver.yaml.tmpl`, le paramètre `jetonInscription` disparaît de `creerCompte`, le troisième champ disparaît de l'écran.

**Ce que ça coûte, et qui est le fond de l'arbitrage.** Le garde n'était pas décoratif, et son retrait ouvre exactement deux choses :

- **La création de comptes en masse.** Ni e-mail ni captcha ne sont activés sur ce déploiement, et aucun ne le sera par cette décision : rien, côté serveur, ne distingue plus un inscrit d'un script. Le seul frein restant est le rate limiting de, desserré à 10× les défauts — c'est-à-dire l'inverse d'un frein.
- **L'annuaire, à qui veut.** laisse tout compte local énumérer les autres par préfixe. Le jeton était ce qui tenait cette porte : sans lui, la liste des utilisateurs du serveur est à la portée de quiconque prend trente secondes pour s'inscrire.

**Pourquoi c'est tenable ici.** Le même motif que D-12, et il n'y en a pas d'autre : déploiement auto-hébergé, cercle restreint, opérateur qui est l'auteur du produit. Le coût d'un compte indésirable est qu'on le désactive à la main ; il n'y a pas de modération à l'échelle à tenir.

**Ce qui rouvre la décision, avant toute autre chose** : la première vague de comptes non désirés, ou l'ouverture du déploiement au-delà du cercle. Deux replis, dans cet ordre de préférence — remettre `registration_requires_token` (le chemin est intact, seul le champ de l'écran est à reposer, et le test de s'en apercevra tout de suite), ou fermer l'annuaire en revenant sur. Le second ne remplace pas le premier : il ferme la conséquence, pas la cause.

**Ce que la décision ne change pas.** Le service de liens d'invitation reste ce qu'il est — un lien pour **se relier** à quelqu'un, jamais pour créer un compte. Les deux n'ont jamais été le même objet, et le sont encore moins maintenant : est amendée en conséquence.


---

## D-14 — La clé de récupération ouvre une session, quand le mot de passe est perdu

**Décision : oui, et la clé devient donc un facteur d'authentification à elle seule.** *(Tranchée le 25/08/2026, après instruction, le même jour que D-12 et D-13 — et c'est D-12 qui rend celle-ci nécessaire.)*

**Le trou que ça ferme.** D-12 a fait de la clé de récupération le seul garde du changement de mot de passe, et fermé `POST /account/password` au proxy. Ce déploiement n'a ni e-mail, ni SSO, ni question de sécurité. Conséquence non vue au moment de trancher D-12 : **un mot de passe oublié faisait un compte mort**, définitivement, alors que son titulaire avait en poche la clé qui aurait dû le sauver. On lui demandait de garder précieusement un secret qui ne pouvait rien pour lui.

**Ce qui est décidé.** L'écran de connexion porte une troisième voie, sous « Mot de passe oublié ? » : identifiant plus clé de récupération. Le module Synapse de D-12 gagne une seconde route, `POST /_synapse/client/tacita/login_recovery`, **non authentifiée**. Elle vérifie la clé contre le descripteur de secret storage du compte — la même vérification que D-12, le même code — et rend un **jeton de connexion à usage unique**, échangé par le chemin natif `m.login.token`. Le module ne fabrique aucun jeton d'accès : c'est Synapse qui ouvre la session, crée l'appareil, applique ses limites et journalise.

**Ce que ça coûte, et qui est le fond de l'arbitrage.** La clé cesse d'être un secret qui *déchiffre* pour devenir un secret qui *ouvre*.

- **Avant, la clé seule ne donnait rien.** Il fallait déjà une session pour avoir quelque chose à déchiffrer. Deux secrets étaient nécessaires pour prendre un compte : le mot de passe et la clé. **Désormais un seul suffit** — et c'est celui qu'on demande à l'utilisateur d'écrire quelque part.
- **La porte est ouverte à Internet.** C'est le seul endpoint du déploiement qui authentifie sans jeton. Une clé de 256 bits ne s'énumère pas, mais l'endpoint est limité en débit par IP (le limiteur de connexion du serveur) — un endpoint d'authentification qui ne compte pas ses échecs ne peut pas voir qu'on l'essaie.
- **Le refus est indifférencié.** Compte inconnu, désactivé, sans clé, clé fausse : une seule réponse. Distinguer donnerait un oracle de comptes à qui interroge, et ouvre déjà bien assez l'annuaire.
- **Un compte désactivé ne se rouvre pas.** D-13 fait de la désactivation la réponse à un compte indésirable ; sans cette vérification, cette réponse-là se contournerait avec un secret que le compte détient déjà.

**Pourquoi c'est tenable ici.** Le même motif que D-12 et D-13, et il ne s'étend pas plus loin : déploiement auto-hébergé, cercle restreint. Et l'alternative n'en était pas une — un compte mort par mot de passe oublié est une perte certaine de tout l'historique, contre un risque qui suppose que la clé ait fuité.

**Ce que ça oblige à dire, et où c'est dit.** « Gardez votre clé comme votre mot de passe » cesse d'être un conseil de prudence : c'est la seule chose qui protège le compte. L'écran de secours le dit avant le geste (« une mesure exceptionnelle »), et « Limites connues » le dit avant qu'on en dépende — son entrée D-12 a été réécrite pour ça, et non doublée.

**Ce qui rouvre la décision, avant toute autre chose** : héberger pour des tiers, comme pour D-12. Deux replis existent alors, dans cet ordre — exiger un second facteur sur cette route, ou la retirer et rétablir un vrai chemin de réinitialisation (e-mail), ce qui suppose de rouvrir D-12.


---

## D-15 — La clé de récupération est dérivée du mot de passe

**Décision : oui. Se connecter avec son identifiant et son mot de passe suffit, sur n'importe quel appareil.** *(Tranchée le 25/08/2026, après un défaut vécu : « je me connecte et j'ai un écran "entrez votre clé de récupération" ».)*

**Ce qui n'allait pas, et pourquoi ce n'était pas un défaut d'écran.** Chaque connexion Matrix crée un `device_id` neuf. Un appareil neuf n'est pas signé par l'identité de son propriétaire, n'a aucune clé Megolm et ne peut ni lire l'historique ni envoyer quoi que ce soit (D-08). Le mur était donc **honnête** : il disait vrai. Ce qui n'allait pas, c'est qu'il soit **nécessaire** — le produit demandait de retenir un secret de plus alors qu'il venait d'en recevoir un.

**Ce qui est décidé.** La clé de secret storage (4S) n'est plus tirée au hasard : elle est **dérivée du mot de passe du compte** (`m.pbkdf2`, sel et itérations posés dans le descripteur, spec Matrix « Secret storage »). À chaque connexion, le mot de passe saisi redonne la même clé, le client déverrouille en silence, l'appareil se signe. La clé de récupération continue d'exister, d'être affichée à l'inscription et d'ouvrir le compte (D-14) : c'est la même clé, sous sa forme lisible.

**Ce que ça coûte, et qui est le fond de l'arbitrage.** **Le mot de passe protège désormais l'historique chiffré.** Le descripteur 4S est de l'account data — le serveur le lit, sel, `iv` et `mac` compris. Qui le lit peut donc monter une **attaque hors ligne** sur le mot de passe et, s'il est faible, obtenir la clé qui déchiffre tout. Avant, une clé de 256 bits tirée au hasard fermait cette porte. Le plancher est de 8 caractères (module Synapse, écran de changement) : c'est bas, et c'est dit.

Ce coût est **le même que celui déjà accepté** par D-12 (la clé transite vers le serveur à chaque changement de mot de passe) et par D-14 (la clé seule ouvre le compte). Le modèle de menace de ce déploiement concède l'opérateur ; il ne concède pas un attaquant qui vole l'account data sans être l'opérateur, et c'est cette nuance-là qui se paie ici.

**Ce que ça ne répare pas, et qui reste vrai.** D-12 change le mot de passe **sans re-dériver la clé**. Après un changement, la clé reste celle de l'ancien mot de passe : la connexion silencieuse cesse de fonctionner et l'écran de saisie revient — une fois, sur chaque appareil neuf. Personne n'est enfermé dehors (la clé écrite quelque part continue d'ouvrir, et D-14 aussi), mais la promesse « le mot de passe suffit » a un trou, et il est nommé. **Le boucher demande une re-clé du 4S dans `changerMotDePasse`**, ce qui n'est pas atomique avec le changement côté serveur — c'est pour ça que ce n'est pas fait ici plutôt qu'à moitié.

**Ce qui rouvre la décision** : héberger pour des tiers (comme D-12 et D-14). Le repli est la clé aléatoire — le code la produit encore quand aucune phrase de passe n'est fournie.

**Conséquences tirées le 25/08/2026, après audit.** Trois corrections que D-15 rendait nécessaires et que la décision seule ne portait pas :

- **Un plancher de mot de passe existe enfin** (`minimum_length: 12` côté Synapse). Il n'y en avait aucun à la création de compte — un compte s'est créé avec le mot de passe « a » — alors que D-15 fait de ce mot de passe la clé qui déchiffre l'historique.
- **La réinitialisation de clé est rouverte.** Elle passait par une page de repli SSO que D-12 avait supprimée le matin même : le seul recours d'une clé perdue remontait un 401 brut. Le remplacement d'identité franchit désormais `m.login.password`. C'est ce chemin-là qui rattrape le trou nommé ci-dessus — un mot de passe changé fait cesser la connexion silencieuse, et il faut alors pouvoir refaire une clé.
- **Les appareils se voient et se ferment**. Sans cet écran, la concentration de pouvoir sur le mot de passe n'avait aucune contrepartie : jetons sans expiration, changement de mot de passe qui ne déconnecte rien (D-12), clé qui ouvre une session (D-14). **Ce qui reste ouvert et n'est pas corrigé** : la portée de D-12 telle qu'elle est écrite (« ni le mot de passe courant… n'autorise ») est plus large que ce qu'elle tient depuis D-15, et `rc_login` reste desserré à dix fois les défauts pour un secret qui a changé de valeur.

---

### Le défaut jumeau, corrigé le même jour

Il n'était pas de la même nature et il aurait suffi à produire le même écran, y compris avec la clé en main : `bootstrapCrossSigning` signe l'appareil, et le magasin crypto local garde la vue qu'il avait **avant**. `getDeviceVerificationStatus` — la source de `recoveryState()` — répondait donc « non signé » sur un appareil qui venait de l'être, et la porte se refermait derrière quelqu'un qui venait de tout faire correctement. Un `/keys/query` forcé après signature (et avant, au déverrouillage) le corrige. Mesuré contre un vrai Synapse ; **aucun test sur mocks ne pouvait le voir**, ce qui a valu au dépôt sa première cible de fumée du parcours d'entrée (`infra/smoke/onboarding.smoke.test.ts`, règle 4).
