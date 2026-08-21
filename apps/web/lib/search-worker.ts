/**
 * Le point d'entrée du worker de recherche, côté shard.
 *
 * Il ne fait que réexporter celui du paquet (spec 09), et donne au shard **une seule
 * forme** de construction de worker : `new Worker(new URL("../../lib/search-worker.ts",
 * import.meta.url))`.
 *
 * *(Rectification du 21/08/2026, mesurée au `next build`.* L'en-tête d'origine disait que
 * le bundler ne résout `new URL()` qu'à partir d'un chemin de fichier, jamais d'un
 * spécificateur de paquet. C'est faux sur la configuration de ce dépôt : webpack résout
 * `@tacita/search/worker` et en émet le même chunk. Ce fichier n'est donc pas un
 * contournement — il n'y a rien à contourner —, seulement l'unique forme retenue.)*
 *
 * Le module s'auto-branche sur `self` quand il est chargé comme worker — rien à appeler.
 */
import "@tacita/search/worker";
