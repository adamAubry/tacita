# DECISIONS.md — Arbitrages produit tranchés

Décisions PM fermes. Les specs s'y réfèrent par leur ID. Toute remise en cause passe par le PM, pas par un contournement dans le code.

**D-01 à D-11 sont fermes.** Une entrée peut aussi porter, **et seulement si elle le dit en tête**, des notes de conception non normatives et des points **ouverts, non tranchés** — il n'y en a plus au 20/08/2026, D-11 ayant été tranchée le jour même. Rien dans le code ne peut se réclamer d'un point ouvert tant qu'il n'est pas tranché : une note de conception n'est pas une exigence, et aucun test ne la nomme. *(Ajouté le 20/08/2026, avec D-10 et D-11.)*

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

**Portée précisée le 20/08/2026 — E-20.** D-03 porte sur les **messages vocaux** (`m.audio`), et sur eux seuls. La **piste audio d'une vidéo** n'entre pas dans son périmètre : elle est gouvernée par D-04, et son format est l'AAC-LC (spec 08, REQ-MED-13). Écrit ici parce que rien ne le disait, et qu'« AAC » lu à côté de « D-03 » passe pour une violation.

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
- **Piste audio.** Le format et ses bornes vivent ici ; l'obligation, son unique repli honnête — partir muet, en le disant — et l'interdiction de tout autre repli vivent dans REQ-MED-13. **D-03 n'est pas concernée**, voir la précision de portée ajoutée ci-dessus.

**Source déjà conforme aux cibles ⇒ remuxage seul, pas de réencodage (E-18).** Réencoder ce qui respecte déjà les plafonds coûte une génération de perte et une attente, sans rien rendre. Le remuxage, lui, reste dû : le passthrough brut du fichier source ferait sortir du pipeline un conteneur que rien n'a normalisé, ce que REQ-MED-05 amendée continue d'interdire.

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

## D-10 — Refonte du pipeline vidéo : ce qui est amendé, et ce qui ne l'est pas
**Tranchée le 20/08/2026.** Les specs sont amendées **avant** l'implémentation, qui sera écrite contre elles. Aucun code, aucun test, aucune configuration n'a été touché par cette passe — c'est la condition qui rend l'exercice utile : une spec amendée après coup ne fait que ratifier ce qui est déjà écrit.

| # | Amendement | E-xx | Où |
|---|---|---|---|
| 1 | « Muxeurs sans dépendance » s'ouvre au **démuxage et au muxage de conteneur**, sous régime d'épinglage (règle 5). E-10 intacte, « zéro DOM » intacte, aucune bibliothèque nommée | E-17 | `specs/08` § Méthode |
| 2 | Portée de « le destinataire ne reçoit que la version compressée » : **le chemin de capture in-app**. La propriété protégée devient le **conteneur normalisé unique en sortie** ; remuxage conforme, passthrough brut interdit | E-18 | `specs/08` REQ-MED-05 |
| 3 | Source déjà conforme aux cibles ⇒ **remuxage seul**. Conséquence UI : message d'échec de compression dédié, distinct de l'absence de bouton | E-18 | `specs/08` REQ-MED-04, D-04 |
| 4 | **REQ-MED-12** — liste close des types rendus, vidéo **et** image, par défaut de refus ; `application/octet-stream` cesse d'être un repli ; support du codec vérifié avant d'afficher un lecteur | E-19 | `specs/08` |
| 5 | **REQ-MED-13** — piste audio AAC-LC ; muet assumé et dit plutôt qu'un conteneur non éprouvé. **D-03 mise hors sujet explicitement** | E-20 | `specs/08`, D-03, D-04 |
| 6 | **REQ-MED-14** — orientation préservée. Elle ne l'était que par accident du canvas | — | `specs/08` |
| 7 | **REQ-MED-08 reformulée en principe** : aucun octet servi, rendu ou écrit sans vérification réussie ; hash global et hachage par blocs énumérés comme mécanismes conformes. Note sur l'intégrité par transitivité via l'enveloppe Megolm | E-23 | `specs/08` |
| 8 | **REQ-MED-15** — deux plafonds de taille en réception, et le schéma « vérification globale puis déchiffrement par tranches » déclaré conforme | — | `specs/08` |
| 9 | **REQ-MED-16** — cache de ciphertext, inscrit au registre de wipe (REQ-COR-10) | E-21 | `specs/08` |
| 10 | **REQ-OBX-10 et REQ-MED-17** — la reprise de téléversement appartient à la file ; le pipeline expose une étape idempotente et ne retente pas seul. **Les deux portées amendées dans la même passe** | E-22 | `specs/07`, `specs/08` |
| 11 | Cibles d'encodage : hauteur bornée par la source, profil High avec repli mesuré, débit variable, image clé inchangée | — | D-04 |

**Ce que cette passe ne fait pas.** Elle ne nomme aucune bibliothèque, ne tranche pas le padding (D-11), et n'écrit aucune REQ pour le hachage par blocs — dont la phase n'est pas ordonnancée. Les deux notes ci-dessous préparent cette phase ; ce sont des **notes de conception, pas des exigences**, et aucun test ne les nomme.

### Note de conception — bornes du service worker (préparation du hachage par blocs)

Il n'y a **qu'un service worker par scope** : celui qui servirait les médias **sera** celui du push, donc réveillé hors de toute page. La borne ne peut pas être architecturale — on ne peut pas « avoir un autre SW » —, elle doit être structurelle et vérifiable. À écrire le moment venu, sous cette forme :

- table des clés en portée module, **en mémoire**, vide au démarrage à froid ;
- alimentée **uniquement** par `postMessage` depuis un client vivant ;
- jamais persistée, et **jamais de `caches.put` d'une réponse déchiffrée** (interdit n°8, REQ-UI-01) ;
- purgée à la terminaison du worker ;
- URL virtuelle non devinable, liée à la durée de vie de la page ;
- le handler `push` **ne lit jamais** cette table.

Et le test qui rend la borne réelle, sans lequel elle n'est qu'un commentaire : **SW démarré à froid par un push ⇒ table vide ⇒ aucune requête média servie tant qu'aucun client n'a posté de clé.**

### Note de conception — champ propriétaire des hashes par blocs

Le champ portant la liste des hashes est namespacé **`org.tacita.*`**, documenté comme nôtre, et **jamais présenté comme du Matrix natif** — même discipline que l'accusé « délivré » (interdit n°9). `hashes.sha256` standard est **conservé en parallèle**. Double chemin en réception : champ présent ⇒ progressif ; absent ⇒ chemin legacy inchangé, donc aucune régression avec Element.

### Note instruite — persistance de l'outbox et clés de fichier (question posée avec E-22)

Si la file reprend un téléversement après redémarrage, le chiffré doit être persisté, et la clé AES du fichier vit dans le contenu de l'événement en attente. La question posée était : ce store est-il chiffré au repos, et crée-t-on un chemin où clé et chiffré coexistent hors de l'enveloppe Megolm ?

**Les faits, relevés dans le code et les specs.** `OutboxEntry.content` est stocké **tel quel** en IndexedDB (REQ-OBX-06, `packages/outbox/src/entry.ts`), sans chiffrement au repos : un `m.video` en attente porte donc déjà `file.key` en clair, aujourd'hui, indépendamment de toute reprise de téléversement.

**C'est déjà arbitré, et l'arbitrage est D-06.** `initRustCrypto` tourne sans clé de pickle : les **clés Megolm** sont déjà en clair dans la même IndexedDB, et D-06 en tire la conséquence en toutes lettres — « qui a accès au profil du navigateur a accès au compte et à l'historique déchiffrable ». Une clé de fichier posée à côté d'elles n'ajoute rien au modèle de menace ; persister le chiffré non plus. Le même raisonnement vaut pour l'intégrité, qui est le point sensible de la note de REQ-MED-08 : un attaquant local capable de réécrire le store détient déjà les clés Megolm, donc peut forger l'événement entier — il n'a aucun besoin de substituer un média.

**Ce qui déplacerait la conclusion** est nommé par D-06 et reste post-V1 : une clé de pickle sur le store crypto **plus** un écran de déverrouillage à chaque ouverture. Le jour où cette décision sera prise, le store de la file et le cache de ciphertext (REQ-MED-16) devront entrer dans le même périmètre — sans quoi on chiffrerait la serrure en laissant la porte.

## D-11 — Padding de taille des blobs médias (E-24)
**Décision : on ne pade pas. La conséquence documentaire est due, et elle est écrite.** *(Tranchée le 20/08/2026, après instruction. L'entrée est restée ouverte le temps que le dossier soit constitué ; le paragraphe « ce qui manque pour trancher » ci-dessous a été suivi jusqu'au bout, et sa réponse est ici.)*

**Le motif tient en une phrase : la concession existait déjà.** REQ-INF-13 et D-09 accordent explicitement à un opérateur de serveur — légitime ou après compromission — le graphe social complet et le profil d'activité : qui parle à qui, quand, à quelle fréquence. Le poids d'une pièce jointe appartient au même ensemble, et `infra/LIMITES.md` le documentait déjà nommément. Pader les médias sans rouvrir REQ-INF-13 protégerait la durée d'une vidéo devant un observateur à qui l'on donne déjà la liste de ses correspondants et le rythme de ses échanges : ce serait payer quelques pour cent de bande passante pour fermer une fenêtre dans un mur qui n'en a pas.

**Ce qui est dû en échange, et qui est fait** : la documentation cesse de laisser entendre que le serveur n'apprend rien. Le fait à écrire n'était pas « la taille est visible » — il l'était déjà — mais son **inférence** : à débit quasi constant, taille ÷ débit ≈ durée. Cacher `duration` dans l'événement chiffré ne cache donc pas la durée, et personne ne l'avait écrit. Interdit n°13, règle 5 : tenir la promesse ou la retirer.

**Ce qui rouvrirait la décision, et dans quel ordre.** Si le modèle de menace devait inclure un opérateur qui fait de l'analyse de trafic, **c'est REQ-INF-13 qu'il faudrait rouvrir d'abord** : le padding des médias n'en serait qu'une pièce, et la poser seule laisserait l'essentiel du signal. Deux points à ne pas perdre ce jour-là — le padding doit tomber **à l'intérieur de la zone hachée**, avec troncature après vérification, ce qui demande désormais de rouvrir le hachage par blocs (REQ-MED-18, livré le 20/08/2026) et non d'ajouter une couche ; et la **vignette est un second blob** dont la taille et l'horodatage corrèlent avec le premier.

<details>
<summary>Le dossier d'instruction, conservé</summary>


**Le fait.** AES-CTR ne pade pas : la taille du chiffré est celle du clair à l'octet près. À débit quasi constant, taille ÷ débit ≈ durée. On cache donc la durée dans l'événement chiffré et on la redonne par canal latéral.

**Options, avec leur coût.**

| Option | Ce qu'elle laisse fuir | Ce qu'elle coûte |
|---|---|---|
| Buckets de 256 KiB | granularité réduite, inférence pas supprimée | ~128 KiB par fichier en moyenne, quelques % de bande passante |
| Puissances de 2 | quasi rien | jusqu'à 100 % de surcoût — inacceptable en mobile |
| Ne rien faire | taille, donc durée, compte de médias, rythme d'échange | rien |

**La conséquence documentaire est inconditionnelle.** Si le choix est « ne rien faire », la documentation doit cesser de laisser entendre que le serveur n'apprend rien — tenir la promesse ou la retirer (interdit n°13). *À verser au dossier : `infra/LIMITES.md` documente **déjà** la fuite, et nommément la taille des pièces jointes (« même chiffrées, la taille du blob S3 est visible »). L'option « ne rien faire » ne demande donc pas d'écrire une limite nouvelle — seulement de vérifier que le principe directeur de `CLAUDE.md` et la spec 08 ne promettent pas plus que ce que `LIMITES.md` concède.*

**Deux points à ne pas perdre si le choix est de pader.** Le padding doit tomber **à l'intérieur de la zone hachée**, avec troncature **après** vérification — il se conçoit donc **avec** le hachage par blocs, jamais après, sous peine de dessiner le découpage deux fois. Et la **vignette est un second blob** dont la taille et l'horodatage corrèlent avec le premier : un padding qui ne couvrirait que le média principal laisserait passer l'essentiel du signal.

**Ce qui manquait pour trancher** : le modèle de menace, et lui seul. La question n'était pas technique — les trois options sont implémentables — mais produit : **inclut-on un opérateur de serveur qui fait de l'analyse de trafic dans ce contre quoi Tacita protège ?** D-09 et REQ-INF-13 concèdent déjà le graphe social et le profil d'activité à cet opérateur. Cette concession tient : c'est la réponse, et elle est en tête de section.

</details>

---

## D-12 — La clé de récupération garde le changement de mot de passe, côté serveur

**Décision : oui, et le serveur voit donc la clé.** *(Tranchée le 25/08/2026, après instruction. Elle amende le principe directeur de `CLAUDE.md`, qui pointe ici.)*

**Ce qui est décidé.** L'authentification passe à Synapse natif (login + mot de passe, Keycloak supprimé — REQ-INF-09 réécrite). Le changement de mot de passe est gardé par la **clé de récupération**, et par elle seule : ni le mot de passe courant, ni aucun autre facteur ne l'autorise. La vérification est **serveur**, donc opposable à tout client.

**Ce que ça coûte, et qui est le fond de l'arbitrage.** La clé transite en clair vers le serveur à chaque changement. Elle n'ouvre pas un message : elle ouvre le magasin. Un serveur qui la capte déchiffre tout l'historique du compte, passé et à venir. Trois précisions qui ne sont pas des détails :

- **Non stocké n'est pas non vu.** Le module vérifie puis jette ; un serveur hostile, compromis ou trop bavard dans ses journaux garde ce qui lui est passé sous les yeux.
- **L'exposition ne se rattrape pas.** Le seul chemin de remplacement écrit ici — `setupRecoveryKey({ reinitialiser: true })` — remplace aussi la sauvegarde et l'identité, et rend illisible ce qui était chiffré sous l'ancienne clé. Une rotation non destructive est concevable, elle n'existe pas. Après incident : garder une clé exposée, ou perdre son historique.
- **Le modèle de menace se déplace.** Avant, un serveur compromis voyait les métadonnées et le trafic à venir, jamais l'historique. Désormais, une seule requête captée lui ouvre tout.

**Pourquoi c'est tenable ici.** Déploiement auto-hébergé : l'opérateur est l'auteur du produit ou son cercle. C'est la seule raison pour laquelle la concession passe.

**Pourquoi la forme est celle-là et pas un stage UIA.** Vérifié dans l'image Synapse v1.155.0 : `password_enabled_for_login` et `password_enabled_for_reauth` ne se séparent pas — `enabled: true` donne les deux, `false` aucun, `only_for_reauth` l'inverse de ce qu'on veut. Un stage UIA maison serait donc offert **à côté** de `m.login.password`, qui resterait acceptable : le garde serait décoratif. Un module ne contourne rien, `get_supported_login_types` filtre `m.login.password` par le même drapeau. La forme retenue est donc : `POST /_matrix/client/v3/account/password` bloqué au proxy, et un endpoint de module qui exige la clé.

**Ce qui rouvre la décision, avant toute autre** : héberger pour des tiers. L'opérateur cesse alors d'être celui qui accepte le risque, et c'est lui qui le porte pour d'autres. Le repli est le garde côté client (`secretStorage.checkKey`, local, la clé ne sort pas) — une règle du produit et non du serveur, à écrire comme telle.
