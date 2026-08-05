# ESCALATIONS.md — Points remontés au PM (Tech Lead Frontend)

**Neuf points sur dix sont tranchés (05/08/2026) ; E-10 est ouvert.** Ce fichier garde la
question, la décision et son motif : une décision dont on a perdu le motif se rediscute
tous les six mois.

Les huit premiers ont été **arbitrés par le PM**. Le neuvième a été **tranché en périmètre
technique et porté à sa connaissance** — la distinction est notée dans sa section, parce
qu'elle change qui peut le rouvrir. **E-10 attend un arbitrage** : il oppose deux specs
ratifiées, ce que la spec 00 réserve explicitement au PM.

Ce qui est **contraignant** vit ailleurs — `DECISIONS.md` § D-09 pour le modèle social,
`specs/` pour les exigences amendées. Ici, c'est la trace. En cas de contradiction, le
contrat gagne.

| # | Sujet | Décision | Ce qu'elle crée |
|---|---|---|---|
| E-01 | Filtres de recherche vs schéma d'index | **Filtres retenus**, schéma étendu | `specs/09-search.md` amendée — REQ-SRC-11 |
| E-02 | Note privée synchronisée | **Proposition retenue** — locale à l'appareil, définitif | `DECISIONS.md` D-09 |
| E-03 | Messages éphémères | **Abandonné** | `DECISIONS.md` D-09 |
| E-04 | Modèle « amis » | **Proposition V1 retenue**, définitif | `DECISIONS.md` D-09 |
| E-05 | Liens d'invitation | **Service de tokens construit**, pas de repli deep link | `specs/12-invite-tokens.md` (nouvelle) |
| E-06 | Exigences REQ-UIX-01..40 | **Ratifiées** | rien — les tests les nomment |
| E-07 | Layout d'appel | **Confirmé** : pas de client RTC maison | rien |
| E-08 | Focus RTC annoncé sans SFU | **Proposition retenue** — annonce conditionnelle | `specs/02-rtc-backend.md` amendée |
| E-09 | Ordre de la liste de conversations | **Tranché en périmètre**, PM informé — récence du dernier message | `specs/05-messaging.md` — REQ-MSG-13 et sa réserve |
| E-10 | Transcodage vidéo et Opus vs liste close de REQ-UI-02 | **Ouvert — deux questions au PM** | vidéo et vocaux non envoyables tant qu'il n'est pas tranché |

---

## E-01 — Filtres de recherche vs schéma d'index (spec 09)

**La question.** Le wireframe demande des filtres (mentions `@me`, personne, conversation,
type de contenu, dates avant/après, exclusion des groupes). Le schéma d'index de la spec 09 est
volontairement minimal (`eventId`, `roomId`, `sender`, deux horodatages, corps texte) : les
facettes « mentionne quelqu'un » et « type de contenu » n'existent pas. Contredit le YAGNI
assumé de la spec 09.

**Décision.** Les filtres sont un besoin réel, pas une hypothèse — le YAGNI ne s'applique donc
pas. **Le schéma est étendu proprement**, avec `mentions: string[]` et `msgtype` alimentés au
déchiffrement. **Aucun contournement** : pas de tokens derrière un flag, pas de recherche
plein-texte sur `@displayname` faisant semblant d'être un filtre. Les principes de la spec 09
ne bougent pas d'un pouce — index 100 % local, zéro appel réseau, plafond D-01, `wipe()` à la
déconnexion, aucun texte indexé dans les logs.

**Le point de vigilance, explicité en amendant la spec :** `mentions` dérive du corps
déchiffré. C'est donc du **contenu déchiffré**, soumis à l'interdit n°8 au même titre que le
corps — jamais dans le cache du service worker, les payloads push, les logs ou la télémétrie.
Étendre un schéma d'index, c'est étendre la surface de ce qu'il ne faut pas laisser fuiter.

**Impact module.** `M-F` : les filtres entrent en périmètre V1, la mention « derrière flag »
disparaît. `specs/09-search.md` REQ-SRC-11.

---

## E-02 — Note privée sur profil : synchronisée vs zéro clair serveur

**La question.** Le wireframe (composant 23) exige une note synchronisée entre les appareils de
l'auteur. Le mécanisme naturel — l'account data Matrix — est **en clair côté serveur**, ce qui
viole le principe directeur.

**Décision.** La proposition V1 devient le **produit final** : note locale en IndexedDB, non
synchronisée, avec un libellé honnête — « visible uniquement sur cet appareil ». Ce n'est plus
une dégradation temporaire en attendant une V2 : c'est le comportement retenu. La note suit
l'appareil, pas l'utilisateur.

**Motif.** Une note privée sur un correspondant est exactement le genre de contenu que le
principe directeur protège. Le chemin V2 (account data chiffré) coûterait une dépendance à des
MSC non stabilisés pour un confort ; le libellé honnête coûte une phrase.

**Impact module.** `M-G`. Le backlog `V2-BACKEND.md` est supprimé — il n'y a plus de V2 à prévoir.

---

## E-03 — Messages éphémères

**La question.** L'option « disappearing messages » (composant 15, 1:1) contredit D-02
(rétention illimitée) et exigerait des purges serveur.

**Décision.** **Abandonnée.** Ni en V1, ni au backlog. L'option n'apparaît pas dans l'UI — et
surtout pas en grisé : une option grisée est une promesse non tenue affichée, ce que
l'interdit n°13 proscrit.

**Impact module.** `M-H` (options de conversation). Retiré du backlog V2, qui disparaît avec ses quatre items.

---

## E-04 — Modèle « amis » : aucun concept natif Matrix

**La question.** Ajout d'amis, demandes, statut ami/non-ami, suggestions — Matrix n'a pas de
graphe social.

**Décision.** La proposition V1 devient le **produit final** :

| Notion produit | Mécanisme Matrix |
|---|---|
| « ami » | un DM existant |
| « demande d'ami » | invitation de salon DM native (accepter = join, refuser = leave) |
| « bloquer » | `m.ignored_user_list` natif |
| « retirer l'ami » | quitter le DM |
| « suggestions d'amis » | **aucune source de données**, l'écran ne ment pas |

**Motif.** Un service de graphe social dédié serait un composant serveur de plus qui voit qui
parle à qui — alors que le mécanisme natif rend le même service produit. Les suggestions sont
la seule fonction réellement perdue, et elle n'a pas de source honnête.

**Conséquence de conception maintenue.** L'UI se code contre une interface `Contacts`, pour que
la substitution reste possible sans réécriture. Ce n'est plus un pari sur une V2 : c'est du
découplage ordinaire.

**Impact module.** `M-G`. Le graphe social dédié est refusé, pas reporté.

---

## E-05 — Liens d'invitation et ajout d'ami par lien

**La question.** Les liens temporaires exigent un service de tokens côté serveur, en friction
avec `enable_registration: false`.

**Décision.** **Le service de tokens est construit.** Pas de repli deep link, pas de report
en V2.

**Le cadre de la fonctionnalité est explicite : un utilisateur existant ajoute un autre
utilisateur existant.** Tout le reste est hors cadre — et « hors cadre » ne veut pas dire
« non traité » : chaque scénario qui sort du cadre doit avoir un comportement défini et un
message honnête. Un lien ouvert par quelqu'un sans compte ne doit pas afficher une erreur
technique, et il ne doit surtout pas ouvrir une inscription que `enable_registration: false`
interdit.

**Ce que ça crée :** `specs/12-invite-tokens.md`, qui porte le contrat du service, la liste
des scénarios hors cadre et leur comportement attendu, et la limite assumée nouvelle — **un
service de plus qui apprend qui invite qui**.

**Impact module.** `M-G` (émission et réception d'un lien d'ajout d'ami), `M-H` (liens
d'invitation de groupe). Ce n'est plus un item de backlog : c'est de la V1.

---

## E-06 — Ratification des exigences REQ-UIX-01..40

**Décision.** **Ratifiées telles quelles.** Les exigences issues du wireframe entrent au
contrat au même titre que les REQ-UI de la SPEC 11. Le préfixe `REQ-UIX` est conservé — il dit
d'où vient l'exigence, ce qui reste une information utile, pas un statut provisoire.

Les tests les nomment, la règle de `specs/00-conventions.md` s'applique sans changement : une
exigence sans test nommé n'est pas couverte.

---

## E-07 — Layout d'appel : propriété d'Element Call

**Décision.** **Confirmée.** Les comportements internes à l'appel (bascule voix↔vidéo, menu
auto-masqué, vidéo maximisée) vivent dans le widget Element Call. Interdit n°7 : pas de client
RTC maison, point final.

Notre périmètre reste : boutons d'appel, bandeau « appel en cours », conteneur du widget. Toute
exigence de design *à l'intérieur* de l'appel est non actionnable. Si le rendu d'Element Call
ne convient pas, c'est un arbitrage produit — jamais un contournement dev.

---

## E-08 — Le focus RTC est annoncé même quand le SFU est absent

**La question.** `proxy/nginx.conf` publie `org.matrix.msc4143.rtc_foci` sans condition, comme
REQ-RTC-05 l'exige. Mais les backends `/livekit/*` vivent dans l'overlay
`rtc/docker-compose.yml`, séparé. Sur toute pile où l'overlay n'est pas monté — dont la pile de
développement documentée — `discoverFocus()` trouve un focus valide et l'appel échoue en 502 à
la connexion, au lieu du `RtcFociMissing` que REQ-CAL-02 traite en message visible. Deux specs
cohérentes seules, l'incohérence dans la jonction.

**Décision.** **Proposition retenue.** L'annonce devient conditionnelle : REQ-RTC-05 se lit
désormais « expose les `rtc_foci` **quand le RTC est déployé** ». Une pile sans SFU n'annonce
pas de focus, `discoverFocus()` rend `RtcFociMissing`, et l'UI affiche le message que
REQ-CAL-02 exige.

**Impact module.** `M-I`. `specs/02-rtc-backend.md` REQ-RTC-05 amendée ; l'implémentation
(annonce portée par l'overlay RTC, test REQ-RTC-05 réaligné) a été implémentée le 05/08/2026 :
`proxy/well-known.conf` sans focus, `rtc/well-known.conf` avec, montés au même chemin.

---

## E-09 — L'ordre de la liste de conversations (M-C)

**Tranché en périmètre technique le 05/08/2026, PM informé.** Ce n'est pas un arbitrage
produit : ni le périmètre, ni une promesse faite à l'utilisateur, ni une décision de
`DECISIONS.md` ne bougent. Le PM peut évidemment le rouvrir — il n'a simplement pas eu à
attendre pour que M-C avance.

**La question.** L'interdit n°6 dit « ne jamais trier par `origin_server_ts` — l'ordre
canonique est celui du flux /sync » (REQ-COR-04, REQ-MSG-12). REQ-UIX-07 demande un tri
« récentes / anciennes » sur la liste de conversations. Les deux ne peuvent pas être vrais
au pied de la lettre : **/sync ne définit aucun ordre entre salons**. `getRooms()` rend
l'ordre d'insertion du store — au démarrage, l'ordre où IndexedDB les a rechargés, qui n'a
aucun rapport avec l'activité. Le seul signal de récence disponible côté client est
l'horodatage du dernier message, c'est-à-dire `origin_server_ts`.

**La décision.** La liste est ordonnée par récence du dernier message. **Ici seulement** —
`packages/messaging/src/conversations.ts`, une ligne — et jamais à l'intérieur d'un salon.

**Le motif.** L'interdit protège l'ordre **dans** une conversation, où un horodatage
menteur permettrait d'insérer un message au milieu d'un échange déjà lu. Cette protection
reste entière : aucun message n'est retrié, REQ-MSG-12 est inchangée. Le pire cas ici est
une conversation mal placée dans une liste. Et l'horodatage est de toute façon **déjà
affiché** : REQ-UI-05 exige la date localisée du dernier message, qui sort de la même
valeur — la refuser pour trier tout en l'affichant serait incohérent.

**Les deux alternatives, et pourquoi elles coûtent plus qu'elles ne rapportent :**

- *Compter soi-même l'ordre d'arrivée dans /sync.* Ne vaut que pendant que l'app est
  ouverte : après un rechargement, l'historique relu depuis IndexedDB ne porte aucun
  compteur, et la liste repartirait dans un ordre arbitraire. Il faudrait le persister —
  un état de plus à maintenir, à migrer et à effacer à la déconnexion, pour se protéger
  d'un risque cosmétique.
- *Sliding sync (MSC3575)*, où c'est le serveur qui ordonne la liste. Non stabilisé, non
  déployé, et la précaution versions du dépôt l'écarte d'elle-même.

**Ce qui rouvrirait la question :** un ordre de liste fourni par le serveur qui devienne
disponible sur la version déployée. Le remplacement tiendrait dans la même ligne.

---

## E-10 — Le transcodage média n'a nulle part où vivre (M-E)

**Ouvert. Arbitrage PM requis** — contrairement à E-09, celui-ci ne se tranche pas en
périmètre technique : il oppose deux specs ratifiées, et la réponse change une liste que
le PM a lui-même arrêtée.

**La question.** La spec 08 confie au shard l'implémentation du `MediaEnvironment`, et
exige explicitement (§ Méthode) « WebCodecs avec repli WASM (ffmpeg.wasm ou équivalent)
pour la vidéo ; encodeur Opus WASM pour REQ-MED-07 ». La spec 11 (REQ-UI-02, liste close
ratifiée le 05/08/2026) refuse **toute** dépendance d'`apps/web` hors
`@astryxdesign/*`, `@stylexjs/stylex`, `@tacita/*`, `next` et `react`. Les deux specs sont
respectables séparément ; l'espace entre elles ne l'est pas — le mode de panne dominant du
dépôt (spec 00).

**Où le manque se situe exactement.** *(Rédaction du 06/08/2026, corrigeant une première
version de cette section qui disait « aucune API native ne comble le trou » — trop absolu,
et le corriger change les options.)* Le manque n'est pas un bloc, il a trois morceaux
inégaux :

| Chemin | Ce que le navigateur donne | Ce qui manque |
|---|---|---|
| Vocal, Firefox | Ogg/Opus directement (`MediaRecorder`) | **rien** |
| Vocal, Chrome/Edge | flux **Opus**, conteneur WebM | un **remuxage** WebM → Ogg : du conteneur, pas du codec |
| Vocal, Safari/iOS | MP4/**AAC** | un vrai **encodage** Opus — c'est le seul endroit qui en demande un |
| Vidéo, tous | `WebCodecs` encode en H.264/VP9 | un **muxeur** MP4 : là encore du conteneur, pas du codec |

REQ-MED-07 le disait déjà, et je l'avais lu trop vite : « quand MediaRecorder **ne produit
pas** d'Opus (Safari iOS → MP4/AAC) ». L'encodeur WASM n'est nécessaire que sur ce
« quand ». Partout ailleurs, ce qui manque est de la plomberie de conteneur — quelques
centaines de lignes de code ordinaire, sans dépendance.

Reste une inconnue qui **ne se décide pas, elle se mesure** : si `WebCodecs AudioEncoder`
accepte `opus` sur la version de Safari ciblée, le dernier besoin de WASM disparaît. La
précaution versions du dépôt interdit de le supposer dans un sens comme dans l'autre.

**Ce que M-E a livré en attendant.** Tout ce qui ne dépend d'aucun codec :
photos (compression canvas), fichiers, vignettes déchiffrées, viewer, lecteur vocal avec
forme d'onde, capture photo, galeries. **Ce qui manque est absent de l'UI, pas grisé ni
cassé** : pas d'envoi de vidéo, pas d'enregistrement vocal, pas de capture vidéo. Le
`MediaEnvironment` du shard lève un `TranscodageIndisponible` nommé plutôt que de rendre un
blob approximatif — un vocal hors Ogg/Opus est illisible par les clients Matrix standards,
et une vidéo non transcodée partirait au format brut de l'appareil.

## Les deux questions posées au PM

Elles sont distinctes, et la seconde ne se pose que si la première ferme la porte à la
voie C.

### Q1 — D-03 impose-t-elle un **format** ou un **mécanisme** ?

D-03 est titrée « transcodage WASM vers Ogg/Opus obligatoire ». Le motif écrit juste en
dessous ne parle que du format : « un format propriétaire MP4/AAC rendrait les vocaux
iPhone illisibles par tout client Matrix standard et créerait deux chemins de lecture ».
Le WASM y est le moyen de l'époque, pas la fin.

Si D-03 lie le **format** — Ogg/Opus partout, point — alors une implémentation sans WASM la
respecte pleinement. Si elle lie le **mécanisme**, la voie C est fermée d'avance et il ne
reste qu'à choisir où loger la dépendance.

### Q2 — Où une dépendance de transcodage a-t-elle le droit de vivre ?

**Voie A — amender REQ-UI-02** pour admettre les codecs WASM dans `apps/web`. Le motif de
la liste close est de fermer la porte aux systèmes de style **concurrents d'Astryx** ; un
encodeur audio n'en est pas un, et sa rédaction dit d'ailleurs « toute dépendance **de
style** ». *Coût :* la liste est ratifiée et son test refuse par défaut de refus — la
modifier est un geste de PM, et elle perd la netteté qui fait sa valeur (« tout le reste
refusé » devient « tout le reste refusé, sauf »).

**Voie B — un paquet `@tacita/media-codecs`** qui porte l'implémentation navigateur et ses
dépendances WASM. La liste close l'autorise déjà (`@tacita/*`), le shard reste propre, et la
spec 08 — qui sanctionne le WASM — est le bon voisinage. *Coût :* un paquet de plus, une
spec de plus, et une frontière à écrire, puisque la spec 08 promet « zéro DOM » au pipeline
alors que ce paquet-ci en aurait.

**Voie C — aucune dépendance.** `MediaRecorder` et `WebCodecs` pour encoder, deux muxeurs
écrits à la main (Ogg pour l'audio, MP4 pour la vidéo) pour empaqueter. *Coût :* du code de
format binaire à nous, à tester et à maintenir — ennuyeux mais borné, et sans surface de
supply chain. *Condition :* que Safari couvre l'encodage Opus, sans quoi la voie C laisse
les vocaux iPhone sur le carreau et redevient A ou B pour ce seul cas.

## Ce qu'il faut mesurer avant de trancher

Un spike d'une demi-journée répond à la seule inconnue, et il n'appartient pas au PM :

1. `AudioEncoder.isConfigSupported({ codec: "opus" })` sur la version de Safari ciblée,
   iOS compris — c'est ce résultat qui ouvre ou ferme la voie C ;
2. le poids réel des deux paquets WASM candidats, à comparer aux quelques centaines de
   lignes de muxeur, pour que « moins de code » soit une mesure et pas une intuition.

## Recommandation technique

**Q1 : le format.** Le motif écrit de D-03 ne parle que de lisibilité par les autres
clients ; un vocal en Ogg/Opus produit sans WASM tient cette promesse mot pour mot.

**Q2 : la voie C si le spike la valide, la voie B sinon.** C ne touche à aucune décision
ratifiée et n'ajoute aucune dépendance ; B ne touche à aucune décision ratifiée non plus et
place la dépendance là où une spec l'autorise déjà. La voie A est la plus courte à écrire et
la seule qui abîme quelque chose : la liste close ne vaut que tant qu'elle est close.

## Ce que coûte l'attente

Rien ne casse, et rien ne ment : M-E est livré sans les chemins concernés, et l'UI ne les
propose pas. Mais **envoyer un vocal est une fonction attendue d'une messagerie** — c'est
un trou produit visible, pas une finition. Il est le seul de son espèce dans les cinq
modules livrés.

---

## Décisions prises en propre (design owner, pour information)

- **Avatar** (confusion notée par le concepteur) : en DM, l'avatar de conversation = avatar de l'autre utilisateur ; en groupe = avatar du groupe, distinct des avatars membres. Le composant ConversationAvatar encapsule cette règle en un seul endroit.
- **Navbar** : 4 boutons = Accueil, Recherche, Mentions, Profil. Accueil/Recherche/Mentions partagent le Default layout (2 variations), Profil redirige — cohérent avec le wireframe.
- **Format de date** des aperçus : localisé (`Intl.DateTimeFormat`), pas de format codé en dur (le « 05/17 » du wireframe est un exemple US).
