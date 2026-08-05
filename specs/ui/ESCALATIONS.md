# ESCALATIONS.md — Points remontés au PM (Tech Lead Frontend)

Aucun de ces points n'est résolu unilatéralement par les devs. Statut : **en attente d'arbitrage PM** sauf mention contraire. Tant qu'un point n'est pas tranché, la partie d'UI concernée se développe derrière un flag ou selon la proposition V1 indiquée.

## E-01 — Onglet « Mentions » et tokens PowerSearch vs schéma d'index (spec 09)
Le wireframe demande des filtres de recherche (mentions `@me`, personne, conversation, type de contenu, dates avant/après, exclusion des groupes). Le schéma d'index spec 09 est volontairement minimal (eventId, roomId, sender, ts, body) : les facettes « mentionne quelqu'un » et « type de contenu » n'existent pas. C'est une évolution du **package search** (client, pas de backend), mais elle contredit le YAGNI de la spec 09.
**Proposition** : étendre le schéma avec `mentions: string[]` et `msgtype`, alimentés au déchiffrement ; les tokens dates/personne/conversation sont déjà couverts par ts/sender/roomId. En attendant : l'onglet Mentions se développe contre l'interface search actuelle (requête `@displayname` plein texte), tokens avancés derrière flag.

## E-02 — Note privée sur profil : synchronisée vs zéro clair serveur
Le wireframe (composant 23) exige une note synchronisée entre appareils de l'auteur. Le mécanisme naturel (account data Matrix) est **en clair côté serveur** → violation du principe directeur. **Proposition** : V1 note locale (IndexedDB, non synchronisée, libellé honnête « visible uniquement sur cet appareil ») ; V2 via account data chiffré (voir V2-BACKEND). Le wireframe est donc sciemment dégradé en V1.

## E-03 — Messages éphémères vs DECISIONS D-02
L'option « disappearing messages » (composant 15, 1:1) contredit la décision D-02 (rétention illimitée) et exige des purges serveur. **Proposition** : hors V1, backlog V2 ; l'option n'apparaît pas dans l'UI V1 (pas d'option grisée — pas de promesse non tenue).

## E-04 — Modèle « amis » : aucun concept natif Matrix
Ajout d'amis, demandes, statut ami/non-ami, suggestions : Matrix n'a pas de graphe social. **Proposition V1 (à ratifier)** : « ami » = DM existant ; « demande d'ami » = invitation de salon DM native (accepter = join, refuser = leave) ; « bloquer » = `m.ignored_user_list` natif ; « retirer l'ami » = quitter le DM. Suggestions d'amis : **aucune source de données V1**, placeholder. Graphe social complet en V2 (service dédié). L'UI se code contre une interface `Contacts` pour que la V2 remplace l'implémentation sans réécriture.

## E-05 — Liens d'invitation temporaires (groupe) et liens d'ajout d'ami externes
Nécessitent un service de tokens côté serveur, en friction avec `enable_registration: false`. **Proposition** : V1 = partage d'un deep link interne (Web Share API) fonctionnant entre comptes existants ; caractère « temporaire » et onboarding externe en V2.

## E-06 — Ratification des exigences REQ-UIX-01..40
Le découpage frontend introduit des exigences issues du wireframe, préfixées **REQ-UIX** pour ne pas toucher aux REQ-UI de la SPEC 11 (source de vérité, non modifiée). Le PM ratifie ou amende ; les tests les nomment dès maintenant.

## E-07 — Layout d'appel : propriété d'Element Call
Le wireframe note le call layout « todo » (bascule voix↔vidéo, menu auto-masqué, vidéo maximisée). Ces comportements vivent **dans le widget Element Call** — interdiction de client RTC maison. Notre périmètre : boutons d'appel, bandeau « appel en cours », conteneur du widget. Toute exigence de design *à l'intérieur* de l'appel est non actionnable ; si le rendu Element Call ne convient pas, c'est un arbitrage produit, pas un contournement dev.

## Décisions prises en propre (design owner, pour information)
- **Avatar** (confusion notée par le concepteur) : en DM, l'avatar de conversation = avatar de l'autre utilisateur ; en groupe = avatar du groupe, distinct des avatars membres. Le composant ConversationAvatar encapsule cette règle en un seul endroit.
- **Navbar** : 4 boutons = Accueil, Recherche, Mentions, Profil. Accueil/Recherche/Mentions partagent le Default layout (2 variations), Profil redirige — cohérent avec le wireframe.
- **Format de date** des aperçus : localisé (`Intl.DateTimeFormat`), pas de format codé en dur (le « 05/17 » du wireframe est un exemple US).
