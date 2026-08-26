import type { Constat, Etat, Verification } from "./contrat.ts";

/**
 * Le rendu est une fonction pure : elle prend des constats et rend du texte. Aucun
 * `console.log` ici — c'est ce qui permet de l'asserter au caractère près dans un test,
 * plutôt que de capturer une sortie standard.
 */

const SYMBOLE: Record<Etat, string> = { ok: "✓", attention: "⚠", casse: "✗", attente: "·" };

const ESC = "\u001b";
const COULEUR: Record<Etat, string> = {
  ok: `${ESC}[32m`,
  attention: `${ESC}[33m`,
  casse: `${ESC}[31m`,
  attente: `${ESC}[2m`,
};
const NEUTRE = `${ESC}[0m`;
const ESTOMPE = `${ESC}[2m`;

/**
 * Pas de couleur quand la sortie n'est pas un terminal, ou quand `NO_COLOR` est posée.
 * Et la couleur ne porte jamais l'information seule : le symbole la porte aussi.
 */
export function couleursActives(env: NodeJS.ProcessEnv, estUnTerminal: boolean): boolean {
  return estUnTerminal && env["NO_COLOR"] === undefined && env["TERM"] !== "dumb";
}

export function rendre(
  constats: readonly Constat[],
  verifications: readonly Verification[],
  couleurs: boolean,
): string {
  const phaseDe = new Map(verifications.map((v) => [v.nom, v.phase]));
  const teinter = (etat: Etat, texte: string) =>
    couleurs ? `${COULEUR[etat]}${texte}${NEUTRE}` : texte;
  const estomper = (texte: string) => (couleurs ? `${ESTOMPE}${texte}${NEUTRE}` : texte);

  /**
   * La colonne se dimensionne sur le plus long nom présent : figée, un nom qui
   * l'atteint exactement colle sa valeur — ce que la première exécution réelle a
   * montré sur `SYNAPSE_IP_RANGE_WHITELIST`, qui fait pile la largeur choisie.
   */
  const largeur = Math.max(...constats.map((c) => c.nom.length)) + 2;

  const lignes: string[] = ["", "Tacita — diagnostic", ""];

  /**
   * On groupe par phase au lieu de suivre l'ordre des constats : sans ça, une
   * vérification qui revient à une phase déjà vue réaffiche son titre. Les phases
   * sortent dans l'ordre où les vérifications les déclarent.
   */
  const phases = [...new Set(verifications.map((v) => v.phase))];
  let premiere = true;
  for (const phase of phases) {
    const duGroupe = constats.filter((c) => phaseDe.get(c.nom) === phase);
    if (duGroupe.length === 0) continue;
    if (!premiere) lignes.push("");
    premiere = false;
    lignes.push(phase);
    for (const constat of duGroupe) {
      const nom = constat.nom.padEnd(largeur);
      lignes.push(`  ${teinter(constat.etat, SYMBOLE[constat.etat])}  ${nom}${constat.constat}`);
      if (constat.remede !== undefined && constat.etat !== "ok") {
        lignes.push(estomper(`     └ ${constat.remede}`));
      }
    }
  }

  const compter = (etat: Etat) => constats.filter((c) => c.etat === etat).length;
  const casses = compter("casse");
  const avertissements = compter("attention");
  const attentes = compter("attente");
  const parties = [`${constats.length} vérifications`];
  if (casses > 0) parties.push(`${casses} bloquante${casses > 1 ? "s" : ""}`);
  if (avertissements > 0) parties.push(`${avertissements} avertissement${avertissements > 1 ? "s" : ""}`);
  if (attentes > 0) parties.push(`${attentes} en attente`);

  lignes.push("", parties.join(" · "));
  lignes.push(
    casses === 0
      ? teinter("ok", "Rien ne bloque le démarrage.")
      : teinter("casse", "Corriger les lignes ✗ avant de démarrer la pile."),
  );
  lignes.push("");
  return lignes.join("\n");
}

/** 0 quand rien ne bloque, 1 sinon : un script appelant doit pouvoir s'y fier. */
export function codeDeSortie(constats: readonly Constat[]): number {
  return constats.some((c) => c.etat === "casse") ? 1 : 0;
}
