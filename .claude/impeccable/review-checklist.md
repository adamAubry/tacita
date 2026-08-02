# impeccable — review-checklist.md

Checklist appliquée à chaque revue de code UI. Un point non conforme = revue refusée.

## Confidentialité (non négociable)

- [ ] Aucun contenu déchiffré dans : cache du service worker, payload de notification, logs, télémétrie, traces d'erreur — y compris code de dev/debug.
- [ ] Aucune donnée utilisateur en localStorage/sessionStorage ; IndexedDB uniquement.
- [ ] Aucun appel à /search Synapse ni à /_matrix/media/*/thumbnail.
- [ ] Aucune promesse UI supérieure aux garanties réelles : « délivré » présenté comme extension non standard ; réactions et épinglés signalés en clair ; périmètre de recherche « historique téléchargé » affiché.

## Conformité stack

- [ ] Composants et styles 100 % Astryx ; aucune dépendance Tailwind/shadcn/Bootstrap/CSS-in-JS n'apparaît dans package.json.
- [ ] Aucune logique métier dans apps/web : tout passe par les interfaces des packages (specs 04–10).
- [ ] Ordre de timeline jamais retrié localement ; jamais de tri par origin_server_ts.

## Qualité

- [ ] Chaque test nomme son exigence (describe "REQ-XXX-NN — ...") ; Vitest uniquement.
- [ ] Les deux thèmes vérifiés ; états chargement/vide/erreur/hors ligne présents.
- [ ] Gestes conformes à interactions.md (zone morte 20 px incluse) et doublés d'un équivalent accessible.
