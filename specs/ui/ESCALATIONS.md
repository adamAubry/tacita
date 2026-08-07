# ESCALATIONS.md — Points remontés au PM (Tech Lead Frontend)

**Dix points sur treize sont tranchés** (E-01 à E-09 le 05/08/2026, E-10 le 06/08/2026).
**E-11, E-12 et E-13 sont ouverts**, relevés le 06/08/2026 en livrant M-F, M-G et M-H. Ce
fichier garde la question, la décision et son motif : une décision dont on a perdu le motif
se rediscute tous les six mois.

> **Note de fusion, 06/08/2026.** M-F a été écrite deux fois en parallèle, sur deux
> branches, et les deux ont numéroté leur escalade « E-11 ». Celle de M-H — le lien de
> groupe — est **renumérotée E-13** ; son contenu n'a pas changé d'un mot. Si une trace
> extérieure la cite comme E-11, c'est de cette section qu'elle parle.

Neuf ont été **arbitrés par le PM**. E-09 a été **tranché en périmètre technique et porté à
sa connaissance** ; la distinction est notée dans sa section, parce qu'elle change qui peut
le rouvrir.

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
| E-10 | Transcodage vidéo et Opus vs liste close de REQ-UI-02 | **Arbitré** — D-03 lie le format ; muxeurs et repli WASM dans `packages/media-pipeline` | `DECISIONS.md` D-03 retitrée et révisée ; `specs/08-media-pipeline.md` — REQ-MED-07 et § Méthode. **REQ-UI-02 inchangée** |
| E-11 | `PowerSearch` ne notifie pas la frappe : REQ-UIX-22 ne peut pas être « au fil de la frappe » | **Tranché le 07/08/2026** — voie A (contrat aligné sur la primitive), B en parallèle, C refusée | `specs/ui/M-F.md` — **REQ-UIX-22 amendée**. Aucun code repris |
| E-12 | Photo de profil : le pipeline chiffre tout, un avatar Matrix doit être public | **Tranché le 07/08/2026** — voie A : chemin public **nommé** dans le pipeline, site d'appel unique testé | `specs/08-media-pipeline.md` — **REQ-MED-11** (nouvelle) ; `specs/11-ui-shard.md` — REQ-UI-20 amendée. **Interdit n°11 inchangé** |
| E-13 | Un lien de groupe résout un `roomId` que le porteur ne peut pas rejoindre | **Tranché le 07/08/2026** — voie A : `knock`. Le porteur frappe, un membre confirme | `specs/05-messaging.md` — **REQ-MSG-20** (nouvelle) ; `specs/12-invite-tokens.md` — REQ-INV-06/13/15/16 amendées |
| E-14 | La version d'Element Call déployée n'est épinglée nulle part : le paramètre audio/vidéo de REQ-UIX-38 n'a pas pu être relu | **Tranché le 07/08/2026** — on épingle, comme le reste du compose | `specs/02-rtc-backend.md` — **REQ-RTC-08** (nouvelle). REQ-UIX-38 **non modifiée** |

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

**Arbitré par le PM le 06/08/2026.** Il ne se tranchait pas en périmètre technique, à la
différence d'E-09 : il opposait deux specs ratifiées. La question et son analyse sont
conservées ci-dessous ; la décision est à la fin.

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
voie C. *(Conservées telles que posées ; les réponses sont plus bas.)*

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

## L'arbitrage — PM, 06/08/2026

### Q1 → le **format**

D-03 lie Ogg/Opus en sortie, rien d'autre. Le motif écrit sous la décision ne parle que de
lisibilité par les autres clients ; le WASM y était le moyen connu à la date, pas la fin.
Une implémentation sans WASM respecte D-03 mot pour mot. **D-03 est retitrée** — « Format
de sortie des vocaux » — pour que cette lecture n'ait pas à être refaite dans six mois.

### Q2 → la **voie C**, mais pas là où elle était placée

La proposition logeait implicitement les muxeurs dans le shard. Ce n'est pas leur place, et
c'est ce qui rendait le choix cher : **un muxeur prend des octets et rend des octets — il
n'a aucun DOM.** Il vit dans `packages/media-pipeline`, déjà zéro DOM et déjà porteur du
contrat de format. Pas de paquet nouveau, pas de spec nouvelle, pas de frontière à écrire.
Le shard ne garde que les appels navigateur — `MediaRecorder`, `WebCodecs` — c'est-à-dire
exactement ce que `apps/web/lib/media-env.ts` contient déjà.

**Cela tranche aussi la branche d'échec.** Un encodeur Opus WASM est lui aussi octets →
octets : si le spike ferme la voie C, la dépendance va **au même endroit**, dans
`packages/media-pipeline`, dont la spec 08 sanctionne déjà le WASM et que REQ-UI-02 ne
gouverne pas — son test lit le `package.json` d'`apps/web`. C'est la voie B sans le paquet
en plus. **Le spike ne rouvre donc rien : les deux branches sont décidées d'avance.**

**Voie A refusée, et la jurisprudence est posée :** on n'amende une liste close que
lorsqu'il n'existe **aucun autre lieu**. C'était le cas de `@stylexjs/stylex` — peer
dependency d'Astryx, elle devait être dans ce `package.json`-là et nulle part ailleurs. Un
codec a un autre lieu. Une liste close avec une exception a douze exceptions dans un an.

### Le spike — approuvé, une demi-journée, avec un ordre

1. `MediaRecorder.isTypeSupported('audio/ogg;codecs=opus')` sur Safari **d'abord** : c'est
   la mesure la moins chère, et si elle est vraie la question entière disparaît.
2. Sinon `AudioEncoder.isConfigSupported({ codec: "opus" })`, sur les **trois dernières
   versions majeures d'iOS**, résultat consigné **par version**. Le plancher produit se
   fixe sur ce tableau ; il ne se suppose pas (précaution versions, `CLAUDE.md`).

Le point 2 de la proposition — poids WASM vs lignes de muxeur — est **retiré** : il ne pèse
que si la voie C est fermée, et à ce moment-là il n'y a plus de choix à éclairer. À mesurer
seulement s'il existe deux encodeurs candidats.

#### Résultats du spike — à consigner ici

La sonde est écrite : `infra/smoke/sonde-codecs.html`. Ce n'est ni un test ni un harnais —
l'interdit n°12 ferme le navigateur piloté à la suite de tests, il n'interdit pas d'ouvrir
une page et de lire un résultat. Elle pose les deux questions **dans l'ordre imposé** et
affiche le `userAgent` pour que la ligne recopiée ci-dessous porte sa version.

| Version d'iOS | `isTypeSupported('audio/ogg;codecs=opus')` | `AudioEncoder` opus | `VideoEncoder` H.264 | Mesuré le |
|---|---|---|---|---|
| _à mesurer_ | | | | |
| _à mesurer_ | | | | |
| _à mesurer_ | | | | |

La colonne vidéo n'était pas demandée : l'arbitrage tenait « aucune asymétrie navigateur »
pour acquis sur ce point. La prémisse est raisonnable — `VideoEncoder` est livré par les
trois moteurs — et c'est précisément pour ça qu'elle se mesure en même temps, puisque la
sonde est déjà sur l'appareil. Le shard, lui, ne l'attend pas : il interroge la même API au
montage et ne propose la vidéo que là où elle répond oui.

**Rien n'est rempli, et rien ne doit l'être de mémoire.** Ces trois lignes demandent trois
appareils ou trois simulateurs ; aucun n'est accessible depuis l'environnement de
développement, et supposer une réponse ici reviendrait exactement à ce que la précaution
versions interdit. Le plancher produit se fixe sur ce tableau une fois rempli.

### Ordre de travail, et la porte de sortie produit

Firefox ne demande rien ; Chrome/Edge demandent un remuxage **sans inconnue** : à lancer
maintenant, en parallèle du spike. Le muxeur MP4 vidéo ensuite — aucune asymétrie navigateur
là, la vidéo s'allume dès qu'il est écrit, sans condition. Safari selon le spike.

**Le vocal ne s'allume dans l'UI publiée qu'avec les trois chemins couverts.** Une
messagerie où pouvoir répondre en vocal dépend du téléphone d'en face est exactement la
promesse conditionnelle que l'interdit n°13 vise. L'attente ne coûte plus rien côté
arbitrage : plus aucune question n'est ouverte, seule reste l'exécution.

---

## E-11 — `PowerSearch` ne notifie pas la frappe (M-F)

**Relevé le 06/08/2026 au cours de M-F. Tranché le 07/08/2026 : voie A maintenant, voie B
en parallèle, voie C refusée.** Comme annoncé, c'était un arbitrage de rédaction : aucune
ligne de code n'a été reprise, M-F reste vert tel quel.

**La question.** REQ-UI-16 impose `PowerSearch` comme barre de recherche. REQ-UIX-22
demande une « recherche débouncée (300 ms) », dont l'objectif mesurable dit « 20 frappes
→ 1 appel search ». Les deux ne se rejoignent pas sur Astryx `0.2.0` : la primitive
n'expose **aucun moyen d'observer la saisie brute**. Son texte libre traverse un
typeahead et ne devient un token qu'à la validation — `onChange` ne se déclenche qu'à ce
moment-là, et il n'existe ni `onQueryChange`, ni `onInputChange`, ni valeur lisible par
`handleRef` (`PowerSearchHandle` n'expose que `focusTypeahead`/`blurTypeahead`).

Autrement dit : la recherche « au fil de la frappe » n'est pas implémentable **tant que la
barre est `PowerSearch`**. Ce n'est pas une difficulté, c'est une absence d'API.

**Ce que M-F a livré.** Le débounce existe et il est éprouvé — mais il porte sur les
**critères**, pas sur les caractères : `useResultats` coalesce toute rafale de
changements de terme ou de filtres en un seul appel, avec la fenêtre de 300 ms de la
spec. Le test nommé REQ-UIX-22 prouve exactement cela (20 changements → 1 appel, faux
minuteurs), au niveau du hook, qui est le seul endroit où la coalescence est observable
puisque la primitive ne la laisse pas voir.

La fenêtre n'est pas décorative : éditer la valeur d'un token, en ajouter un puis en
retirer un autre produit bien des rafales, et sans elle chacune partirait au worker.

**Ce que l'utilisateur perd.** Il doit valider sa saisie pour voir des résultats, au lieu
de les voir se réduire pendant qu'il tape. C'est un cran en dessous de l'intention de
REQ-UIX-22, et cela se voit à l'usage.

**Trois voies, pour arbitrage :**

- **Voie A — reconnaître la limite dans REQ-UIX-22.** L'exigence dit « débouncée » sans
  promettre « au fil de la frappe » ; son objectif mesurable, lui, parle de frappes. Le
  reformuler en « 20 changements de critères → 1 appel » aligne le contrat sur ce que la
  primitive permet. *Coût :* on renonce à la recherche incrémentale tant qu'Astryx
  n'expose rien — c'est-à-dire peut-être longtemps.
- **Voie B — demander l'API en amont.** Astryx a six semaines et bouge ; un
  `onQueryChange` est une demande légitime et petite. *Coût :* dépendance à un tiers sur
  une version épinglée, sans date. À combiner avec A en attendant.
- **Voie C — une barre à nous pour le champ libre**, `PowerSearch` ne gardant que les
  filtres. *Coût :* recoder ce qu'Astryx livre, ce que DESIGN.md interdit, et deux
  champs de saisie côte à côte là où le wireframe en montre un. **Déconseillé** — la
  jurisprudence d'E-10 vaut ici aussi : on ne contourne pas une primitive parce qu'il lui
  manque une prop.

**Décision (PM).** **Voie A**, et REQ-UIX-22 est amendée : « recherche débouncée (300 ms)
sur les **changements de critères** », objectif mesurable « 20 changements de critères →
1 appel ». La recherche à la validation devient le comportement **contractuel**, pas une
dégradation tolérée — la nuance compte, parce qu'une dégradation tolérée se re-signale à
chaque revue.

**Voie B en parallèle** : la demande d'un `onQueryChange` part en amont. Si elle est
livrée, la recherche incrémentale reviendra comme **nouvelle exigence**, pas comme dette.
**Voie C refusée** — recoder la primitive pour une prop manquante est exactement ce que la
jurisprudence E-10 écarte.

**Livré.** `specs/ui/M-F.md` : REQ-UIX-22 et son objectif mesurable reformulés, avec le
motif daté. Le test porte le même vocabulaire que le contrat — il s'appelait « 20 frappes »
alors qu'il rerendait des critères, ce qui est précisément le décalage que l'escalade
signalait.

**Ce qui reste à faire par un humain :** ouvrir la demande `onQueryChange` chez Astryx. Un
agent n'a pas de compte sur leur suivi ; la trace est ici, l'action est au Tech Lead
(action n° 6 du plan de route).

**Recommandation du Tech Lead : A maintenant, B en parallèle.** Rien ne justifie de
retenir M-F pour cela, et la limite est déjà écrite là où elle se lit — dans la docstring
de `useResultats`, et ici.

**Ce que ce point ne remet pas en cause.** REQ-UIX-22 n'est pas modifiée : l'amender est
un geste de PM. Le débounce, les skeletons, le placeholder « aucun résultat » avec rappel
du périmètre et l'absence totale d'appel réseau sont livrés et testés.

---

## E-12 — La photo de profil n'a pas de chemin non chiffré (M-G) — **ouvert**

**Relevé le 06/08/2026, au cours de M-G.** Le reste du module est livré et vert ; seule
la photo de profil manque, et elle manque **visiblement** — le champ est absent du
formulaire, pas grisé, pas cassé. Même traitement que le vocal en M-E.

**La question.** REQ-UI-20 demande une photo de profil « via pipeline média ». Le
pipeline (spec 08) **chiffre tout ce qu'il téléverse**, et c'est sa raison d'être :
REQ-MED-01 en fait la garantie du principe directeur. Mais un avatar Matrix n'est pas une
pièce jointe :

- il vit dans `m.room.member` et dans le profil du compte, sous forme d'un `mxc://` **nu**,
  sans les clés ni le hash qu'un `EncryptedFile` transporte ;
- le protocole n'offre **aucun canal** pour ces clés sur un avatar de profil ;
- il est lu par tout client Matrix, y compris ceux qui ne sont pas les nôtres.

Un avatar chiffré est donc un avatar que **personne** ne peut afficher — pas même nous
sur un second appareil. Le téléverser quand même produirait un carré cassé partout :
exactement la promesse non tenue que l'interdit n°13 vise.

**Pourquoi je ne l'ai pas contourné.** La sortie évidente — appeler `uploadContent` du
SDK depuis le shard — est fermée par l'interdit n°11 : « pas de canal d'upload parallèle,
un seul pipeline média pour tous les fichiers ». Le contourner en silence pour une seule
image serait précisément le mode de panne que la spec 00 nomme.

**Trois voies, pour arbitrage :**

- **Voie A — un chemin public explicite dans le pipeline**, du genre
  `uploadPublicImage(session, env, file)` : même paquet, même compression, même point
  d'entrée unique, mais **sans chiffrement et nommé pour qu'on ne s'y trompe pas**.
  L'interdit n°11 est respecté (un seul pipeline), et spec 08 gagne une exigence qui dit
  *quand* le non-chiffré est légitime. *Coût :* le pipeline cesse de pouvoir promettre
  « tout ce qui sort d'ici est chiffré » ; la promesse devient conditionnelle, donc
  relisable de travers dans six mois. **C'est la voie que je recommande**, à condition
  que le nom de la fonction porte la condition.
- **Voie B — pas de photo de profil, définitivement.** Les initiales colorées de
  `ConversationAvatar` sont déjà le rendu par défaut, et elles sont cohérentes avec le
  positionnement de PRODUCT.md. *Coût :* on retire une exigence ratifiée, ce qui est un
  geste de PM ; et l'absence d'avatar se remarque face à toutes les messageries.
- **Voie C — avatar local, non synchronisé**, comme le fond d'écran de REQ-UI-20 et la
  note de D-09. *Coût :* il ne suivrait ni les autres appareils ni le regard des autres —
  un avatar que personne d'autre ne voit n'est pas un avatar, c'est un thème.

**Ce que ce point ne remet pas en cause.** REQ-UI-20 n'est pas modifiée, l'interdit n°11
non plus : amender l'un ou l'autre est un geste de PM. Le reste de REQ-UIX-24 est livré —
nom d'affichage modifiable, identifiant affiché, form edit.

**Décision (PM), 07/08/2026 — voie A.** Un avatar chiffré ne s'affiche nulle part : le
chiffrer est une **non-feature**, pas une garantie. Le supprimer (voie B) sacrifie un
attendu universel ; le rendre local (voie C) en fait un thème, pas un avatar. Même
logique que les réactions en clair — on expose, et on le dit.

**Les trois conditions qui rendent la voie A acceptable, et où elles vivent :**

1. **REQ-MED-11** (nouvelle, spec 08) — `uploadPublicProfileImage()`, dans le **même**
   paquet, avec la **même** compression et les mêmes cibles D-04. Ce qui diffère tient en
   une ligne : pas de `encryptAttachment`, un `mxc://` rendu au lieu d'un `EncryptedFile`.
   L'interdit n°11 tient — un seul pipeline —, et le nom porte le mot `Public` ;
2. **un seul site d'appel**, `apps/web/components/profil/EcranProfil.tsx`. Pas une
   consigne de revue : un test structurel du paquet média balaie tout le dépôt et échoue
   au second appelant. « Tout ce qui sort du pipeline est chiffré, **sauf l'unique chemin
   nommé public** » ne vaut que tant qu'« unique » est vérifié par une machine ;
3. **l'honnêteté au moment du choix** — « Votre photo de profil est visible de tous et
   n'est pas chiffrée », dans la feuille où l'on choisit, pas dans un écran de réglages
   qu'on n'ouvrira pas. La ligne est aussi ajoutée aux limites connues (REQ-UIX-32).

**Livré.** `packages/media-pipeline` (REQ-MED-11 + trois tests, dont le balayage de site
d'appel), `specs/08-media-pipeline.md`, `specs/11-ui-shard.md` (REQ-UI-20 amendée : elle
disait « via pipeline média » sans trancher le chiffrement, ce qui la rendait
inapplicable), `ProfilMoi` (champ photo **présent**, plus absent), `EcranProfil` (le site
d'appel), `LimitesConnues`.

**Note de conception.** Le composant ne connaît ni `Session` ni le pipeline : il reçoit
`onPhoto` injecté. C'est ce découplage qui fait qu'il n'existe **qu'un** endroit à
surveiller, et non un par écran qui afficherait un avatar.

---

## E-13 — Un lien de groupe résout un `roomId` que le porteur ne peut pas rejoindre

**Remonté le 06/08/2026, en câblant REQ-UIX-34 (M-H). Ouvert.** Rien n'a été contourné :
l'émission est livrée, la réception ne l'est pas, et la limite est écrite côté utilisateur.

**La question.** La spec 12 pose que le service ne fait aucune action Matrix : il résout un
token et rend `{ kind, issuer, roomId }`, « c'est **le client** qui invite ensuite, par le
chemin natif de D-09 (invitation de salon DM pour un ami, invitation de salon pour un
groupe) ». Le sens `friend` est cohérent — le porteur crée le DM et invite l'émetteur.

Le sens `group` ne l'est pas. Le porteur obtient un `roomId`, et c'est tout ce qu'il obtient :

- il ne peut pas **s'inviter** lui-même, `POST /rooms/:id/invite` demande d'être membre ;
- il ne peut pas **rejoindre** : `createGroupChat` utilise `Preset.PrivateChat`, donc
  `join_rule: invite`, et le serveur refuse le `join` d'un non-invité ;
- l'**émetteur** ne peut pas inviter non plus : il n'apprend jamais qu'une résolution a eu
  lieu — le service n'a aucun canal vers lui, et lui en donner un serait un pouvoir Matrix
  que la ratification n°1 de la spec 12 lui refuse.

Aucune des trois portes n'est ouverte. REQ-INV-13 mentionne pourtant « déjà membre du
salon » comme un cas de succès idempotent, ce qui suppose qu'un premier passage existe.

**Ce que M-H a livré en attendant.** L'émission complète : création d'un lien `group` avec
ses bornes d'usage et de durée, liste des liens actifs avec leur échéance, révocation. Plus
l'avertissement de REQ-INV-15 amendée, posé **au-dessus** du bouton d'émission. La réception
appartient à M-G et n'existe pas encore : rien dans l'UI ne promet qu'un lien émis fera
entrer quelqu'un.

**Les trois voies, et ce qu'elles coûtent.**

**Voie A — la règle d'accès du salon de groupe change.** `join_rule: knock` : le porteur
frappe, un membre laisse entrer. Natif, stable, et le refus reste possible. *Coût :* une
étape humaine de plus, donc un lien qui ne fait plus entrer tout seul — c'est un choix
produit, pas un détail technique. À poser dans `createGroupChat` (spec 05).

**Voie B — `join_rule: restricted` (salons v9+).** Le lien devient une autorisation portée
par l'appartenance à un autre salon. *Coût :* il faut ce « autre salon », que le modèle
social de D-09 n'a pas — on réinventerait un espace, donc un graphe.

**Voie C — le service invite.** Il faudrait lui donner un pouvoir Matrix. *Coût :* la
ratification n°1 de la spec 12 tombe, et avec elle la borne qui limite les dégâts d'une
compromission. Le corollaire écrit dans cette ratification s'applique mot pour mot : « on ne
reprend pas d'un côté ce qu'on a refusé de l'autre. »

**Ce que je recommande, sans le décider :** la voie A. Elle est la seule qui ne coûte ni une
notion produit nouvelle, ni la borne de sécurité ratifiée. Elle change en revanche ce qu'un
lien de groupe *promet*, et cette promesse est au PM.

**Ce que la décision touche.** `specs/12-invite-tokens.md` (REQ-INV-06 et REQ-INV-13, qui
supposent un chemin d'entrée), `specs/05-messaging.md` (`createGroupChat` si voie A), `M-G`
(l'écran de réception), et le test REQ-INV-16 de la spec 12 — son balayage interdit à tout
module hors du service de connaître la route `/resolve`, ce qui devra s'ouvrir au client
de réception le jour où il existe.

**Décision (PM), 07/08/2026 — voie A : `knock`.** B réinvente un graphe refusé en E-04 ;
C rend au service le pouvoir Matrix que la ratification n°1 de la spec 12 lui refuse.
**La promesse produit change et le PM l'assume : un lien de groupe fait frapper à la
porte, un membre confirme l'entrée.** Pour une app de cercles privés, ce sas est cohérent
avec le positionnement — ce n'est pas une régression, c'est le produit.

**La mécanique, telle qu'elle est livrée.**

- **Le sas suit le cycle de vie des liens, pas la création du salon.** `join_rule` passe à
  `knock` à l'émission du premier lien actif et revient à `invite` à la disparition du
  dernier. Pas de knock permanent sur tous les groupes : `createGroupChat` est inchangé
  (spec 05 « inchangée par défaut »). L'alignement se fait **à chaque relecture de la
  liste**, et pas seulement sur les gestes d'émission et de révocation — un lien peut
  expirer tout seul, et personne n'est là ce jour-là pour refermer la porte.
- **Réception** (`/i/<token>`, M-G) : résolution → `friend` : invitation de DM native ;
  `group` : `knock`, puis un **état d'attente terminal et honnête**. L'écran ne promet ni
  délai ni notification qu'on n'émet pas — il dit que personne n'est prévenu
  automatiquement, parce que c'est vrai.
- **Confirmation** : les demandes s'affichent dans les informations du groupe, au-dessus
  des membres — c'est là qu'on regarde quand on gère un groupe, et **n'importe quel
  membre** peut confirmer. Accepter est une `invite` native (REQ-MSG-11) : aucun état
  parallèle à tenir.

**Effet de bord favorable sur REQ-INV-15.** Le service ne voit toujours pas qu'un émetteur
a quitté son groupe — il n'a aucun droit Matrix, et c'est voulu. Mais la conséquence a
changé de nature : le `knock` atterrit chez **les membres restants**. Un lien dont
l'émetteur est parti n'est plus une impasse tant qu'il reste quelqu'un dans le groupe. Le
texte au-dessus du bouton d'émission a été récrit dans ces termes — il disait
« l'invitation échouera », ce qui n'est plus vrai.

**REQ-INV-16, la borne déplacée et non levée.** Son balayage interdisait la route
`/resolve` à **tout** module hors du service — ce qui fermait la porte au client de
réception que la voie A exige. Elle devient « **un seul appelant, nommé** » :
`apps/web/lib/liens-invitation.ts`. Un second échoue au test, et un test de plus vérifie
que le fichier nommé existe encore — sans lui, un renommage désactiverait le balayage en
silence et tout redeviendrait « conforme ».

**Livré.** `packages/messaging` (REQ-MSG-20 : `joinRule`, `setJoinRule`, `knock`,
`knockers` + 6 tests), `specs/05-messaging.md`, `specs/12-invite-tokens.md` (quatre REQ
amendées), `apps/web/lib/liens-invitation.ts` (`resoudre`), `ReceptionLien` + route
`/i/[token]`, `LienInvitation` (bascule + texte), `MembresGroupe` (demandes d'entrée),
et le test REQ-INV-16 rouvert.

**Reste non prouvé.** Aucun `knock` n'a été émis contre un vrai Synapse. La suite prouve
que la bonne règle est écrite, que le bon appel part et que l'UI dit la vérité ; que le
serveur accepte un knock sur un salon passé en `knock`, et que l'invitation qui suit fasse
bien entrer, demande la pile déployée. Le sas dépend aussi d'un droit : basculer
`join_rules` exige le power level d'état. Relevé en écrivant cette trace, et **corrigé
plutôt que documenté** — un membre ordinaire qui émet un lien voit désormais « Ce lien ne
fera entrer personne » avec la marche à suivre, au lieu d'un lien valide qui n'ouvre rien.
C'est la première chose à vérifier sur pile réelle.

---

## E-14 — Le paramètre de lancement audio/vidéo n'est vérifiable contre aucune version

**Remonté le 07/08/2026 pendant M-I. Tranché le jour même : on épingle.**

**La question.** REQ-UIX-38 demande que « appel audio » et « appel vidéo » passent *les
paramètres de lancement correspondants* au widget. CLAUDE.md est explicite sur ce genre de
valeur : « vérifier dans la doc de la version déployée avant usage, ne jamais supposer ».
Or le dépôt n'épinglait **aucune** version d'Element Call — ni image, ni digest : `infra/`
ne connaissait que LiveKit et lk-jwt. Le nom du paramètre ne pouvait qu'être supposé, ce
que la règle interdit. Même classe que E-08 : deux specs correctes séparément,
l'incohérence dans la jonction.

**Décision (PM).** Auto-hébergement intégral oblige : Element Call rejoint l'overlay
`rtc/` avec image épinglée par digest, version et URL consignées. Nouvelle **REQ-RTC-08**,
testée comme les autres valeurs d'infra. `skipLobby` reste absent, le lobby reste le
filet. REQ-UIX-38 inchangée.

**Ce que l'épinglage a révélé, et c'est tout l'intérêt.** Une fois `v0.23.0` épinglée, la
relecture de son `src/UrlParams.ts` a montré que **les deux paramètres que le client
envoyait ne faisaient rien** :

- `video=true|false` — ce paramètre n'existe dans aucune version. Le mécanisme réel est
  `intent`, un enum `UserIntent` : `start_call` (vidéo) et `start_call_voice` (audio),
  tous deux avec `skipLobby: false` ;
- `hideHeader=true` — retiré d'`UrlConfiguration`, remplacé par `header` (`none` /
  `standard` / `app_bar`). Le commentaire d'amont le dit encore rétrocompatible ; le code
  ne le lit plus.

Aucun des deux ne cassait quoi que ce soit. Aucun des deux ne faisait quoi que ce soit non
plus, et rien dans le dépôt ne pouvait le dire. C'est exactement le mode de panne que
l'épinglage ferme.

**Troisième trouvaille, hors périmètre initial :** `matrix_rtc_mode`. Laissé au défaut,
c'est le réglage développeur de **chaque utilisateur** qui décide de la forme des
événements d'appartenance. Sa valeur `matrix_2_0` active les événements *sticky* de
MSC4354 — précisément la divergence que `packages/calls/README.md` annonçait comme
« à surveiller », et sous laquelle `activeCall()` cesserait de voir les participants
**sans erreur bruyante**. La config servie l'épingle à `compatibility`, et REQ-RTC-08 a
un test qui refuse `matrix_2_0`. La divergence a désormais un interrupteur nommé au lieu
d'être une inquiétude en prose.

**Livré.** `infra/rtc/docker-compose.yml` (service `element-call`, digest
`sha256:e352de46…`, v0.23.0 résolue le 07/08/2026), `infra/rtc/element-call.json`,
`infra/rtc/call.conf` + `infra/proxy/call.conf` (le nom d'hôte `call.<domaine>` ; la pile
de base n'en sert aucun, même règle que E-08), `specs/02-rtc-backend.md` REQ-RTC-08,
`infra/rtc/tests/element-call.test.ts`, et `packages/calls` qui envoie maintenant `intent`
et `header`. La marche à suivre au prochain bump est dans `infra/rtc/README.md`.

**Reste non prouvé :** rien de tout ceci n'a tourné. Le digest est réel et vérifié auprès
du registre, la relecture est faite sur la source de la v0.23.0, mais la pile n'a pas été
déployée — le certificat à SAN `call.<domaine>` et le rendu du widget se vérifient sur une
pile réelle.

---

## Décisions prises en propre (design owner, pour information)

- **Avatar** (confusion notée par le concepteur) : en DM, l'avatar de conversation = avatar de l'autre utilisateur ; en groupe = avatar du groupe, distinct des avatars membres. Le composant ConversationAvatar encapsule cette règle en un seul endroit.
- **Navbar** : 4 boutons = Accueil, Recherche, Mentions, Profil. Accueil/Recherche/Mentions partagent le Default layout (2 variations), Profil redirige — cohérent avec le wireframe.
- **Format de date** des aperçus : localisé (`Intl.DateTimeFormat`), pas de format codé en dur (le « 05/17 » du wireframe est un exemple US).
