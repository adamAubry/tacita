# ESCALATIONS.md — Points remontés au PM (Tech Lead Frontend)

**Les huit points sont tranchés (05/08/2026).** Ce fichier garde la question, la décision et
son motif : une décision dont on a perdu le motif se rediscute tous les six mois.

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

## Décisions prises en propre (design owner, pour information)

- **Avatar** (confusion notée par le concepteur) : en DM, l'avatar de conversation = avatar de l'autre utilisateur ; en groupe = avatar du groupe, distinct des avatars membres. Le composant ConversationAvatar encapsule cette règle en un seul endroit.
- **Navbar** : 4 boutons = Accueil, Recherche, Mentions, Profil. Accueil/Recherche/Mentions partagent le Default layout (2 variations), Profil redirige — cohérent avec le wireframe.
- **Format de date** des aperçus : localisé (`Intl.DateTimeFormat`), pas de format codé en dur (le « 05/17 » du wireframe est un exemple US).
