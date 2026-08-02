# impeccable — interactions.md

## Gestes et interactions (référence : spec 11)

- **Appui long (hold)** sur un message → menu contextuel : répondre, copier, modifier, supprimer, épingler. Items conditionnés par les droits ; jamais de menu vide.
- **Swipe gauche** sur un message → mode réponse (composer pré-rempli avec citation).
- **Swipe droit** → révélation des heures d'envoi, avec **zone morte de 20 px au bord gauche** : un geste démarrant à x < 20 px est ignoré (le swipe depuis le bord déclenche le retour arrière de Safari iOS hors standalone).
- Tous les gestes sont implémentés sur **événements pointer** (testables en jsdom/Vitest, pas de Playwright), avec seuils de distance et d'axe pour ne pas capter le scroll vertical.
- Chaque action gestuelle a un équivalent accessible non gestuel (menu, bouton) — clavier et lecteurs d'écran.
- Indicateur « est en train d'écrire » : lecture seule fluide ; l'émission est throttlée par le package messaging, l'UI n'émet jamais par frappe.
- Feedback immédiat systématique : envoi = affichage optimiste avec statut, échec = état visible + bouton renvoyer, jamais d'action silencieusement perdue.

## Contraintes PWA

- Fonctionne installée (standalone) ET dans l'onglet ; les gestes ne doivent pas entrer en conflit avec la navigation navigateur.
- Hors ligne : toute l'UI de consultation reste fonctionnelle ; bandeau d'état de connexion ; jamais d'écran blanc sans réseau.
- iOS : notifications uniquement si ajoutée à l'écran d'accueil — écran d'explication dédié, pas de promesse de notification dans Safari.
