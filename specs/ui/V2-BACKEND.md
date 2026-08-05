# V2-BACKEND.md — Fonctionnalités UI nécessitant une évolution backend

Aucun dev frontend ne modifie l'infrastructure pour ces features. Elles sont conçues côté UI derrière des interfaces stables pour brancher la V2 sans réécriture. Chaque item : besoin produit, blocage V1, esquisse V2.

## V2-01 — Service de graphe social
Demandes d'amis découplées des conversations, statut ami/non-ami fiable, suggestions d'amis. Blocage : aucun concept natif Matrix, la V1 approxime via invitations de salon (E-04). Esquisse : petit service adossé à PostgreSQL (tables users/edges/requests — lean, 3 tables), authentifié via l'OIDC existant ; ne voit que des identités, jamais du contenu.

## V2-02 — Notes de profil synchronisées et chiffrées
Le composant Note doit se synchroniser entre appareils de l'auteur sans clair serveur (E-02). Esquisse : account data chiffré (MSC encrypted account data, ou blob chiffré client déposé via le pipeline média + pointeur en account data). À réévaluer selon l'état des MSC au moment de la V2.

## V2-03 — Messages éphémères par conversation
Option « disappearing messages » 1:1 (E-03, conflit DECISIONS D-02). Esquisse : `m.room.retention` par salon + jobs de purge Synapse + politique média associée. Décision produit préalable obligatoire.

## V2-04 — Liens d'invitation temporaires
Invitation à un groupe ou ajout d'ami par lien externe, avec expiration (E-05). Esquisse : service de tokens signés à durée de vie courte, traduisant token → invitation Matrix, compatible `enable_registration: false` (le lien n'ouvre pas de création de compte en libre-service).

## Règle d'implémentation V1
Les surfaces UI concernées consomment des interfaces (`Contacts`, `ProfileNotes`, `InviteLinks`) définies dans les modules ; l'implémentation V1 est l'approximation documentée en ESCALATIONS.md, la V2 remplace l'adaptateur. Aucune de ces interfaces ne fuit dans les autres modules.
