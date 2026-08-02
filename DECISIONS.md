# DECISIONS.md — Arbitrages produit tranchés

Décisions PM fermes. Les specs s'y réfèrent par leur ID. Toute remise en cause passe par le PM, pas par un contournement dans le code.

## D-01 — Plafond de l'index de recherche local
**Décision : plafond en nombre d'événements, 200 000, éviction par ancienneté (FIFO).**
Un plafond en octets est difficile à mesurer de façon fiable en IndexedDB ; un compteur d'événements est trivial à tester. 200 000 messages couvrent plusieurs années d'usage personnel. Pas de fenêtre temporelle en plus : un seul critère, un seul chemin de purge (YAGNI).

## D-02 — Politique de rétention serveur
**Décision : rétention illimitée, identique DM et groupes, pour messages et médias.**
L'application remplace les DM Instagram : l'historique complet est une attente produit. La politique est *définie explicitement* dans `homeserver.yaml` (retention activée, pas de purge programmée) pour satisfaire l'exigence « politique de rétention définie » sans supprimer de données. Révisable post-V1 si le coût S3 le justifie. Purger un média casserait les messages qui le référencent.

## D-03 — Transcodage vocal iOS
**Décision : transcodage WASM vers Ogg/Opus obligatoire, format de sortie unique.**
Un format propriétaire MP4/AAC rendrait les vocaux iPhone illisibles par tout client Matrix standard et créerait deux chemins de lecture. Le coût WASM est payé une fois, à l'envoi, sur l'appareil de l'auteur.

## D-04 — Seuils de compression adaptative
**Décision : deux profils réseau, détectés via Network Information API (`effectiveType`), profil « bon réseau » par défaut si l'API est absente (Safari).**

| | Bon réseau (wifi, 4g) | Réseau contraint (3g et moins, saveData) |
|---|---|---|
| Image | max 2048 px côté long, qualité 0.8 | max 1280 px, qualité 0.7 |
| Vidéo | 720p, 2.5 Mbps | 480p, 1 Mbps |

Formats de sortie : JPEG (images), MP4/H.264 (vidéos — lisible partout, la vidéo n'a pas la contrainte d'interop Opus). Pas de 3e profil, pas de réglage utilisateur en V1.

## D-05 — Index de recherche et rotation de session Megolm
**Décision : aucune réindexation, incrémental pur.**
L'index stocke du texte déjà déchiffré ; une rotation de session ne change rien aux événements passés, elle ne concerne que le chiffrement des messages futurs. La rotation est donc un non-événement pour l'index. Seul cas d'invalidation : purge D-01 ou déconnexion (wipe complet de l'index avec le reste des données locales).
