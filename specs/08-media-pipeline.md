# SPEC 08 — Pipeline média

**Package : `packages/media-pipeline/`. Dépendances : spec 04 (Session, pour upload/download), DECISIONS D-03/D-04. Zéro DOM (les APIs navigateur — canvas, MediaRecorder — sont injectées/mockables).**

## Livrable

**Un seul pipeline d'upload pour tous les types de fichiers** (photos, vidéos, ZIP, PDF, bureautique, vocaux) — aucun canal parallèle. Chaîne : (compression si média) → chiffrement client → upload blob opaque → événement chiffré portant les clés. Et la chaîne inverse au téléchargement.

## Exigences et critères d'acceptation

- **REQ-MED-01** — Chiffrement côté client avant upload : AES-CTR, avec clé, IV et hash SHA-256 transportés dans l'événement chiffré (schéma `EncryptedFile` de la spec Matrix). Le serveur/S3 ne reçoit que des blobs opaques.
- **REQ-MED-02** — Tous les types de fichiers (ZIP, PDF, bureautique inclus) passent par ce même pipeline ; seuls images/vidéos/audio ont une étape de compression/transcodage en amont.
- **REQ-MED-03** — Vignettes générées **côté client** avant upload, chiffrées **séparément** (le serveur ne peut pas redimensionner un blob qu'il ne sait pas déchiffrer). Interdit d'appeler `/_matrix/media/*/thumbnail` sur un média chiffré.
- **REQ-MED-04** — Compression automatique et adaptative images/vidéos avant envoi, seuils DECISIONS D-04 (2 profils réseau, fallback « bon réseau »). Entièrement à développer, aucun mécanisme natif Matrix.
- **REQ-MED-05** — Capture in-app photo/vidéo : l'original **non compressé** est sauvegardé sur l'appareil de l'auteur (File System Access / téléchargement selon support), fonction locale distincte de l'envoi ; le destinataire ne reçoit que la version compressée.
- **REQ-MED-06** — Messages vocaux : Ogg/Opus, convention `m.audio` (avec forme d'onde et durée dans le contenu de l'événement). Le calcul de forme d'onde fait partie du pipeline.
- **REQ-MED-07** — Sortie Ogg/Opus quel que soit ce que produit `MediaRecorder` (DECISIONS D-03), sans quoi les vocaux iPhone sont illisibles par les clients Matrix standards. Trois chemins d'entrée, trois coûts distincts : Ogg/Opus direct (Firefox) → rien à faire ; flux Opus en conteneur WebM (Chrome/Edge) → **remuxage** WebM → Ogg ; MP4/AAC (Safari/iOS) → **encodage** Opus, seul cas qui en demande un. *(Rédaction du 06/08/2026, E-10 : la version initiale imposait « transcodage WASM » sur les trois chemins.)*
- **REQ-MED-08** — Téléchargement : récupération du blob, vérification du hash SHA-256, déchiffrement local. Hash invalide → média rejeté avec erreur explicite.
- **REQ-MED-09** — Compatibilité authenticated media : le module consomme les URLs média selon le comportement consigné par l'infra (spec 01, REQ-INF-12) ; aucune URL média publique n'est supposée.
- **REQ-MED-10** — Aucun contenu média en clair (ni ses clés) dans les logs ou traces d'erreur du module.

## Méthode et contraintes

- WebCrypto pour AES-CTR/SHA-256 ; canvas/OffscreenCanvas pour vignettes et compression image.
- **Encodage dans le shard, empaquetage dans le paquet** (E-10, 06/08/2026). Les APIs qui encodent vivent chez l'utilisateur et entrent par le `MediaEnvironment` injecté : `MediaRecorder` pour l'audio, `WebCodecs` pour la vidéo. Les **muxeurs** — Ogg pour l'audio, MP4 pour la vidéo — sont octets → octets, sans DOM : ils vivent **ici**, dans ce paquet, écrits à la main, sans dépendance. La contrainte « zéro DOM » du paquet est intacte : un muxeur ne touche à rien.
- **Repli WASM, seulement si mesuré nécessaire.** Si `WebCodecs AudioEncoder` n'accepte pas `opus` sur les versions d'iOS ciblées, un encodeur Opus WASM entre — **dans ce paquet, pas dans `apps/web`** (REQ-UI-02 reste close). Un encodeur est octets → octets au même titre qu'un muxeur. Ne pas l'ajouter avant que le spike E-10 l'ait rendu nécessaire.
- Les opérations lourdes (transcodage, compression vidéo) tournent en Web Worker — jamais sur le thread principal.
- Hors scope : UI de capture, galerie, lecteur (spec 11) ; file d'envoi (spec 07 — le pipeline produit un contenu prêt à `enqueue`).

## Objectif mesurable

Suite Vitest, une describe par REQ : REQ-MED-01/08 (round-trip chiffrer → déchiffrer = octets identiques ; blob altéré → rejet par hash) ; REQ-MED-02 (un PDF et une image empruntent le même chemin de code d'upload — spy sur la fonction unique) ; REQ-MED-04 (profil réseau contraint injecté → dimensions/bitrate cibles D-04 dans les paramètres de compression) ; REQ-MED-06/07 (sortie déclarée `audio/ogg`, entrée AAC simulée → passage par le transcodeur). APIs navigateur mockées via l'injection prévue.
