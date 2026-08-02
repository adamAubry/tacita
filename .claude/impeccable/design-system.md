# impeccable — design-system.md

> NB : impeccable n'a pas été évalué à la rédaction. Si le plugin attend d'autres noms de fichiers ou un frontmatter spécifique, adapter la forme selon sa doc — le contenu ci-dessous reste la référence.

## Système de design

- **Astryx UI est la seule source de composants et de styles.** Interdits : Tailwind, shadcn, Bootstrap, CSS-in-JS tiers, styles inline hors valeurs dynamiques (position d'un swipe, progression d'un upload).
- Référence visuelle : **clone de Discord** — sidebar de conversations, timeline centrale, densité et hiérarchie comparables — avec les tokens Astryx, pas les couleurs Discord.
- **Thèmes sombre et clair** via le mécanisme de thème Astryx exclusivement : aucune couleur codée en dur, tokens uniquement. Tout composant doit être correct dans les deux thèmes.
- Fond d'écran de conversation personnalisable (image du user) : le texte des messages doit rester lisible sur fond arbitraire (bulles opaques ou voile, dans le vocabulaire Astryx).
- Densité mobile-first : cibles tactiles ≥ 44 px, composer accessible au pouce, safe-areas iOS respectées (env(safe-area-inset-*)) en mode standalone.
- États obligatoires pour toute vue de données : chargement, vide, erreur, hors ligne. Une vue sans ces quatre états est incomplète.
