# M-D — Conversation (layout conversation, cœur de l'app)

**Dépendances : M-A, M-E (lecteurs média), packages messaging (05), receipts (06), outbox (07), média (08).**

## Livrable

L'écran de messagerie : header avec appels, timeline Discord-style, composer Instagram-style. Le module le plus important — la qualité UX prime sur tout le reste.

## Exigences

### Timeline
- **REQ-UI-06** — Ordre strictement celui du package (jamais retrié) ; fusion timeline + outbox avec statuts et bouton renvoyer ; **Date separator** (composant 13) à chaque changement de jour : `———— 05 août ————`, tout message sous un séparateur démarre un nouveau groupe. **La conversation s'ouvre sur son dernier message**, et un message reçu pendant qu'on est en bas y maintient — jamais quand on relit le passé plus haut, ni quand on est arrivé par une ancre de recherche. *(Ajouté le 21/08/2026 : rien ne positionnait la zone défilante, qui s'ouvrait donc sur le message le plus **ancien** de la fenêtre chargée.)*
- **REQ-UIX-12** — **Message object** (composant 11), regroupement Discord : avatar + nom rendus si (premier message de la conversation) ou (message précédent d'un autre auteur) ou (> 5 min depuis le dernier message du même auteur sans activité intermédiaire) ; sinon le message s'appende sans en-tête. Un seul composant, l'en-tête est une prop calculée par une fonction pure `shouldShowHeader(prev, msg)`. Skeletons en attente de données.
- **REQ-UIX-13** — **Conversation starter** (composant 10) : rendu comme premier élément de la timeline, aligné à gauche comme les messages ; avatar en grand (plus grande occurrence de l'app), nom + user id (styles distincts), phrase de contexte ; boutons : 1:1 « Bloquer | Retirer l'ami », groupe « Muter | Quitter » (actions via interfaces M-G/M-H).
- **REQ-UI-21** — **Remontée d'historique** : approcher du haut de la timeline demande la suite au serveur (`OrderedTimeline.paginate`, REQ-COR-13), jusqu'au début du salon. La position de lecture est conservée à l'insertion en tête — sans compensation, l'insertion repousse le contenu et relance aussitôt une demande, ce qui est une boucle et non un chargement. Une requête en vol n'est pas doublée, et la fin de l'historique arrête définitivement les demandes.
- **REQ-UI-13** — Reçus sur le dernier message envoyé : ✓ envoyé, ✓✓ délivré, ✓✓ accentué lu ; aide contextuelle reprenant « délivré = extension non standard » ; destinataire masqué → reste « envoyé » avec explication accessible.

### Gestes
- **REQ-UI-07 / REQ-UIX-14** — Hold menu (composant 12) : rangée d'emojis de réaction en haut (+ picker complet, avec mention discrète « réactions visibles en clair », REQ-UI-10), puis actions : répondre, copier, modifier, supprimer, épingler — conditionnées aux droits (REQ-MSG-06).
- **REQ-UI-08** — Swipe **gauche** sur un message → répondre (composer pré-rempli avec aperçu cité). **La réponse envoyée porte la citation dans la timeline** — filet à gauche, auteur et extrait sur une ligne tronquée —, et l'aperçu nomme la **nature** d'une pièce jointe (« Photo », « Vidéo », « Message vocal », nom du document) plutôt que son `body`, qui n'est qu'un nom de fichier. Un message cité hors de la fenêtre chargée se dit tel quel, sans aller-retour serveur. *(Ajouté le 21/08/2026 : la relation était posée à l'envoi et rendue nulle part, et le bandeau du composer citait « IMG_4417.HEIC » pour une photo.)* **Le geste lui-même** : l'appui long s'annule dès que le doigt bouge — sans quoi un glissement tranquille franchit les 500 ms en chemin, le hold menu s'ouvre par-dessus et avale la fin du geste — et le message suit le doigt pendant le glissement, faute de quoi rien ne dit que le geste a été pris. ⚠ Divergence wireframe : « swiping on the right to reply » contredit la SPEC 11 (gauche = répondre, droit = heures). **La SPEC 11 fait autorité** ; divergence signalée au concepteur via le PM.
- **REQ-UI-09** — Swipe droit → révélation des heures, zone morte de 20 px au bord gauche.

### Composer
- **REQ-UIX-15** — Conversation input (composant 9, `@astryxdesign/core/Chat`) : bouton fichiers à gauche ; à droite vocal et envoyer ; envoi optimiste (local echo + outbox) ; enregistrement vocal avec états enregistrement/aperçu/annulation (pipeline spec 08).
- **REQ-UI-11** — Typing : indicateur en lecture ; émission throttlée déléguée au package (jamais par frappe).
- **REQ-UI-12** — Autocomplétion `@` (membres + `@everyone`), rendu type Discord, données REQ-MSG-10.

## Contraintes

- Scroll performant sur long historique (virtualisation ou fenêtrage — même arbitrage spike que M-C) ; position de scroll préservée en navigation.
- Fond d'écran personnalisé (M-H) : la timeline pose un voile (token `scrim` de DESIGN.md) garantissant la lisibilité.
- Hors ligne : consultation + composition (outbox) fonctionnelles (REQ-UI-17).

## Hors scope

Galeries et viewers plein écran (M-E) ; layout info (M-H) ; logique d'appel (M-I — M-D rend seulement les deux boutons du header et route).

## Objectif mesurable

Vitest + Testing Library : REQ-UIX-12 (table de cas sur `shouldShowHeader` : interruption, 5 min, changement de jour) ; REQ-UI-06 (messages à cheval sur minuit → séparateur) ; REQ-UI-08/09 (séquences pointer, y compris départ à x < 20 px → rien) ; REQ-UI-13 (transitions sent→delivered→read rendues ; masqué → sent stable) ; REQ-UIX-13 (starter premier élément, boutons selon type de salon) ; REQ-UI-06 (arrivée → position en bas) ; REQ-UI-21 (défilement près du haut → une seule remontée ; fin d'historique → plus aucune demande ; hauteur compensée à l'insertion).
