# M-E — Média : sélection, rendu, capture, galeries

**Dépendances : M-A, package media-pipeline (spec 08). Fournit des composants à M-D, M-G, M-H.**

## Livrable

Tous les composants média partagés : sélection/envoi, affichage dans la timeline, viewers plein écran, vocaux, capture in-app, et les galeries réutilisables (média / épinglés / liens / fichiers).

## Exigences

- **REQ-UI-14** — Envoi photos, vidéos, fichiers (ZIP, PDF, bureautique) via le pipeline unique ; rendu timeline : vignettes déchiffrées (jamais d'appel thumbnail serveur), tuile fichier avec nom/taille/icône type ; progression d'upload et annulation ; lecteur vocal avec forme d'onde et durée.
- **REQ-UI-15** — Capture photo/vidéo in-app : l'original non compressé est sauvegardé sur l'appareil (REQ-MED-05), l'UI distingue explicitement « enregistré sur votre appareil » de « envoyé (version compressée) ».
- **REQ-UIX-16** — Viewer plein écran images/vidéos : zoom, navigation entre médias du salon, bouton sauvegarder ; fermeture par geste vers le bas.
- **REQ-UIX-17** — **Galeries partagées**, un seul composant `ConversationCollections` à 4 onglets (Component selector) : Médias, Épinglés, Liens, Fichiers — consommé par le layout info (M-H) et l'onglet Activity du profil ami (M-G). Sources : filtrage local de l'historique téléchargé (msgtype pour médias/fichiers, détection d'URL dans les corps pour les liens, REQ-MSG-08 pour les épinglés). Périmètre honnête affiché : « contenu de l'historique téléchargé ».
- **REQ-UIX-18** — L'écran Épinglés porte la mention de non-chiffrement de la liste d'épinglage (REQ-UI-10 / REQ-MSG-08).

## Contraintes

- Décodage/déchiffrement hors thread principal quand le pipeline l'expose ; jamais de blob déchiffré écrit hors IndexedDB.
- Galeries en lazy loading par lots ; Placeholder par onglet vide.
- Permissions caméra/micro demandées au moment de l'usage, jamais à l'avance, avec état « refusé » expliqué et rattrapable.

## Hors scope

Compression, chiffrement, transcodage (package spec 08) ; composer (M-D) ; wallpaper (M-H).

## Objectif mesurable

Vitest + Testing Library, pipeline mocké : REQ-UI-14 (vignette rendue depuis blob déchiffré mocké ; aucune URL `/thumbnail` construite — spy réseau) ; REQ-UI-15 (capture → deux libellés distincts rendus) ; REQ-UIX-17 (jeu d'événements mixtes → répartition correcte dans les 4 onglets ; URL dans un texte → onglet Liens) ; REQ-UIX-18 (mention présente).
