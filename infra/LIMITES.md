# Limites assumées — infra (spec 01)

Documentées, jamais masquées (spec 00 — Honnêteté produit).

- **Métadonnées en clair côté serveur.** Le contenu des messages est chiffré
  de bout en bout, mais Synapse et sa base PostgreSQL voient en clair : qui
  parle à qui (membres des salons, DM), quand (horodatage de chaque
  événement), à quelle fréquence, et la taille des pièces jointes (même
  chiffrées, la taille du blob S3 est visible). Un opérateur du serveur —
  légitime ou après compromission — peut reconstruire un graphe social complet
  et un profil d'activité sans jamais lire un message.
- **SSE-S3 (REQ-INF-08) n'est pas une protection de confidentialité.**
  L'opérateur du bucket détient les clés de chiffrement au repos ; ça ne
  protège que contre le vol physique du support de stockage, pas contre
  l'opérateur lui-même. La confidentialité réelle vient uniquement du
  chiffrement client (spec 08) — le bucket ne contient que des blobs opaques.
- **MinIO (dev local) : projet dont le rythme de publication a
  significativement ralenti** (dernière image : septembre 2025). Ne pas
  déployer tel quel en production sans revalidation ; voir `README.md`.
