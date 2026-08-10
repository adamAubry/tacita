# M-G — Social : profils, amis, demandes, note

**Dépendances : M-A, M-E (galeries pour Activity), packages client-core/messaging, spec 12 (service de liens d'invitation). Escalades E-02, E-04, E-05 tranchées le 05/08/2026 — voir `DECISIONS.md` D-09 : « ami » = DM natif, note privée locale à l'appareil et non synchronisée, liens d'invitation servis par la spec 12, **dont le service est livré** (`apps/invite-tokens/`, son README donne les quatre routes). L'interface `Contacts` reste, par découplage.**

## Livrable

Layouts Profile (soi / autrui), Add-friends, Friend request, et les composants sociaux.

## Exigences

### Profil
- **REQ-UIX-23** — Profile card (composant 21) : avatar en grand fondant vers le fond (dégradé vers transparence) ; **la bannière est le fond de la carte** (REQ-UIX-41), et se dissout elle aussi par le bas ; **le bandeau du haut flotte** — hors du flux, en verre, la bannière visible au travers : retour à gauche, et à droite réglages (soi) ou options relatives à la personne (autrui) précédées, pour autrui, du statut ami/non-ami. *(Amendée le 10/08/2026 : « fond couleur ou photo » ne disait pas d'où venait la photo, et rien dans le projet ne la fournissait ; le bandeau, lui, était dans le flux et repoussait tout l'écran vers le bas.)*
- **REQ-UIX-24** — Profil propre : nom + user id juxtaposés avec styles distincts ; Form edit (composant 22, bouton accentué centré) ouvrant le formulaire de modification (nom d'affichage, photo, bannière — via pipeline, REQ-UI-20) ; navbar avec « Profil » surélevé.
- **REQ-UIX-41** — **Bannière de profil** : image publique portée par le champ étendu de REQ-MSG-21, choisie par le même chemin que la photo (un seul callback de téléversement — REQ-MED-11 n'autorise qu'un site d'appel). Absente → l'aplat `accent-soft`, jamais un vide ni un carré cassé. Elle est **décorative** (`aria-hidden`) : le nom et l'identifiant, juste dessous, disent qui l'on regarde. Elle porte le contraste du bandeau flottant, d'où le verre — voir DESIGN.md § Colors, exception nommée.
- **REQ-UIX-25** — Profil d'autrui, ami : Component selector « Actions | Activity ». Actions = Friends interaction buttons (composant 25 : Message → DM, Appel audio → M-I) puis Note ; Activity = `ConversationCollections` (M-E) sur le DM partagé.
- **REQ-UIX-26** — Profil d'autrui, non-ami : Send invite (composant 26, un grand bouton « Ajouter ») puis Note. Envoi → demande via `Contacts` (V1 : invitation DM).
- **REQ-UIX-27** — Note (composant 23) : note privée libre sous le libellé exact « Note (visible uniquement par vous, sur cet appareil) » — libellé V1 honnête tant que E-02 n'est pas tranché (pas de promesse de sync). Persistée en IndexedDB, enregistrée au registre de wipe.

### Amis
- **REQ-UIX-28** — Add-friends : header, Buttons list de partage d'un lien d'invitation (Web Share API, lien interne V1 — E-05), puis « Ajouter par identifiant » + recherche ; résultats en Friends list (composant 16, variation suggestion : carte cliquable → profil). Suggestions serveur : Placeholder V1 (aucune source, E-04).
- **REQ-UIX-29** — Friend request : liste des demandes (composant 16, variation demande : accepter vert / refuser rouge) via `Contacts` ; Placeholder dédié si aucune demande. Accepter → DM ouvert ; refuser → disparition immédiate (optimiste).
- **REQ-UIX-30** — Bloquer (via starter M-D ou profil) : `m.ignored_user_list` natif, avec confirmation expliquant l'effet réel (ses messages ne s'affichent plus chez vous) — pas de sur-promesse. « Retirer l'ami » = quitter le DM, avec confirmation.

## Contraintes

- Recherche d'utilisateur par identifiant : user directory Matrix (pas de recherche de contenu serveur) ; débouncée.
- La distinction ami/non-ami vient exclusivement de `Contacts` — aucune heuristique locale dispersée.

## Hors scope

Le graphe social dédié — refusé par D-09, pas reporté ; settings (M-H) ; appels (M-I) ; le service de liens lui-même (spec 12), dont ce module n'est que le client.

## Objectif mesurable

Vitest + Testing Library, interfaces mockées : REQ-UIX-25/26 (prop friend → selector Actions/Activity ; non-friend → Send invite ; jamais les deux) ; REQ-UIX-27 (note persistée puis relue ; libellé exact présent) ; REQ-UIX-29 (accept → callback Contacts.accept + navigation DM ; 0 demandes → Placeholder) ; REQ-UIX-30 (bloquer → appel ignore list + texte de confirmation conforme).
