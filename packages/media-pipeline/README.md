# @tacita/media-pipeline — pipeline média (spec 08)

**Un seul chemin d'upload** pour tous les fichiers : photo, vidéo, vocal, ZIP, PDF,
bureautique. Chaîne unique — compression si média → chiffrement client → upload d'un blob
opaque → contenu d'événement portant les clés — et son inverse au téléchargement.

```ts
const content = await uploadAttachment(session, env, file); // prêt à enqueue (spec 07)
const bytes = await downloadAttachment(session, env, content.file);
await saveOriginal(env, originalBlob, "IMG_0001.heic"); // REQ-MED-05, hors chemin d'envoi
```

## Ce que le package ne fournit pas

`MediaEnvironment` est l'unique frontière avec le navigateur : le package n'a aucune
dépendance DOM et **n'embarque aucun codec**. Il porte **une** dépendance runtime depuis
le 20/08/2026 — `mp4box@2.4.1`, pour **démuxer** ce qui entre (E-17). Elle ne touche pas
`WebCodecs` et tourne dans Node : c'est ce qui la rendait admissible, et les tests de
`demux.ts` en sont la preuve permanente. Version épinglée, digest au lockfile, CHANGELOG
relu avant tout bump. L'app (spec 11) fournit les
implémentations, et c'est elle qui décide de les faire tourner en Web Worker — le
transcodage vidéo et l'encodage Opus ne doivent jamais toucher le thread principal.

| Adaptateur                      | Implémentation attendue                          |
| ------------------------------- | ------------------------------------------------ |
| `resizeImage`                   | OffscreenCanvas (sert aussi aux vignettes)        |
| `transcodeVideo`, `extractPoster` | WebCodecs, dans un Worker (spec 08 § Méthode)   |
| `transcodeAudio`                | encodeur Opus WASM (REQ-MED-07)                   |
| `decodeAudio`                   | `AudioContext.decodeAudioData`, ramené au mono    |
| `saveViaFilePicker` / `saveViaDownload` | File System Access, sinon téléchargement  |
| `connection`                    | `navigator.connection` (D-04)                     |

Aucun de ces adaptateurs n'a été évalué contre les contraintes PWA réelles (iOS Safari,
mémoire disponible en Worker, WebCodecs derrière un flag). C'est un point à lever avant
la spec 11, pas une hypothèse à valider dans le code de ce package.

## Limites assumées

- **Le serveur voit la taille et la date de chaque pièce jointe.** Le blob est opaque —
  AES-CTR 256, clé et IV jamais transmis au serveur — mais son poids, son horodatage et
  le fait qu'il existe restent lisibles. Métadonnées assumées, cf. `infra/LIMITES.md`.
- **Le nom du fichier ne part pas au serveur** (`includeFilename: false`) : il ne vit que
  dans l'événement chiffré. Un nom de fichier est du contenu.
- **Les vignettes sont chiffrées séparément**, avec leur propre clé : le serveur ne peut
  pas redimensionner ce qu'il ne déchiffre pas, et `/_matrix/media/*/thumbnail` n'est
  jamais appelé sur un média chiffré.
- **La compression est destructive et irréversible pour le destinataire.** Il ne reçoit
  que la version compressée aux seuils D-04 ; l'original non compressé n'existe que sur
  l'appareil de l'auteur, s'il a appelé `saveOriginal`.
- **Deux profils réseau, pas de réglage utilisateur** (D-04). Sans Network Information
  API (Safari), le profil est « bon réseau » : on ne dégrade pas ce qu'on ne mesure pas.
- **Tout accès média passe par les endpoints authentifiés** (`/_matrix/client/v1/media/…`).
  Les anciens endpoints v3 répondent 404 depuis Synapse v1.146 — voir `infra/README.md`,
  REQ-INF-12. Aucune URL média publique n'est supposée nulle part.
- **Le remuxage WebM → Ogg ne réencode rien, et c'est le but.** Le flux Opus que produit
  Chrome est déjà celui qu'on envoie ; seul son conteneur change. Aucune perte, aucun
  encodeur. En revanche, **le chemin Safari/iOS (MP4/AAC) reste ouvert** : lui demande un
  vrai encodage, que `transcodeAudio` porte et que le spike E-10 doit encore situer
  (`WebCodecs` natif, ou encodeur WASM dans ce paquet).
- **On écrit nos conteneurs, on ne lit pas ceux des autres.** Le muxeur MP4 et le muxeur
  Ogg sont écrits ici, parce que ce qu'ils produisent est borné et connu. Le **démuxage**
  d'une source entrante ne l'est pas — listes d'édition, pistes multiples, `moov`
  fragmenté, rotation dans le `tkhd` —, et il passe donc par `mp4box`. La frontière est
  là, et elle a une raison : notre sortie, notre code ; l'entrée du monde, une
  bibliothèque qui l'a déjà rencontré.
- **Le muxeur Ogg et le lecteur WebM sont écrits à la main, et volontairement étroits.**
  Le lecteur ne démuxe pas Matroska : il sort une piste audio Opus et son `OpusHead`, rien
  d'autre. Un bloc lacé le fait lever plutôt que de produire un vocal muet.
- **Un hash invalide rejette le média, sans repli.** Pas de « meilleur effort » : un blob
  altéré n'est pas déchiffré du tout, et l'erreur ne transporte ni clé, ni octets, ni URL.
