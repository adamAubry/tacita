/**
 * Le point d'entrée du worker de recherche, côté shard.
 *
 * Il ne fait que réexporter celui du paquet (spec 09) : c'est un fichier **local** parce
 * que `new Worker(new URL(…, import.meta.url))` est résolu par le bundler à partir d'un
 * chemin de fichier, pas d'un spécificateur de paquet. Une ligne ici évite d'inventer une
 * configuration webpack.
 *
 * Le module s'auto-branche sur `self` quand il est chargé comme worker — rien à appeler.
 */
import "@tacita/search/worker";
