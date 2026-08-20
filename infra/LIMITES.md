# Limites assumées — infra (spec 01)

Documentées, jamais masquées (spec 00 — Honnêteté produit).

- **Métadonnées en clair côté serveur.** Le contenu des messages est chiffré
  de bout en bout, mais Synapse et sa base PostgreSQL voient en clair : qui
  parle à qui (membres des salons, DM), quand (horodatage de chaque
  événement), à quelle fréquence, et la taille des pièces jointes (même
  chiffrées, la taille du blob S3 est visible). Un opérateur du serveur —
  légitime ou après compromission — peut reconstruire un graphe social complet
  et un profil d'activité sans jamais lire un message.
- **La taille d'un média dit sa durée** *(ajouté le 20/08/2026, D-11)*. AES-CTR
  ne pade pas : le chiffré fait exactement le poids du clair, à l'octet près. À
  débit quasi constant — ce que produit le pipeline (D-04) —, taille ÷ débit
  ≈ durée. La durée d'une vidéo ou d'un vocal est donc **déductible du seul
  blob**, alors qu'elle est rangée dans l'événement chiffré. Le nombre de
  médias et le rythme des envois se lisent de la même façon. **Décision D-11 :
  on ne pade pas**, parce que cet opérateur détient déjà le graphe social et le
  profil d'activité ci-dessus ; fermer cette fenêtre-là seule ne changerait pas
  ce qu'il sait. Rouvrir la question passe par cette limite-ci d'abord, pas par
  le pipeline média.
- **SSE-S3 (REQ-INF-08) n'est pas une protection de confidentialité.**
  L'opérateur du bucket détient les clés de chiffrement au repos ; ça ne
  protège que contre le vol physique du support de stockage, pas contre
  l'opérateur lui-même. La confidentialité réelle vient uniquement du
  chiffrement client (spec 08) — le bucket ne contient que des blobs opaques.
- **MinIO (dev local) : projet dont le rythme de publication a
  significativement ralenti** (dernière image : septembre 2025). Ne pas
  déployer tel quel en production sans revalidation ; voir `README.md`.
