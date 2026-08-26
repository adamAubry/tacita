import type { CallLogEntry } from "@tacita/calls";

import { dureeAppel, heure } from "../../lib/dates";
import { IconeAppel } from "../foundation/icons";
import { Button, Text } from "../foundation/primitives";

/**
 * **Un appel passé, dans la conversation où il a eu lieu.**
 *
 * Sans cette ligne, un appel non décroché n'avait jamais existé : rien dans le salon,
 * rien dans la liste, aucun moyen de savoir qu'on avait été appelé ni de rappeler. C'est
 * la trace que toute messagerie qui appelle laisse, et la seule chose qu'on cherche après
 * coup.
 *
 * La forme est celle du séparateur de date (composant 13) — une ligne centrée, discrète,
 * qui situe sans s'annoncer : un appel terminé est du contexte, pas un message. Un appel
 * manqué gagne son unique action, **rappeler**, parce que c'est exactement ce qu'on veut
 * faire en le lisant. Pas de rouge : DESIGN.md réserve `danger` au destructif, et le mot
 * « manqué » n'a besoin de personne pour se faire comprendre.
 */
export function libelleAppel(appel: CallLogEntry): string {
  if (appel.manque) return `Appel manqué · ${heure(appel.debut)}`;
  // Une fin inconnue — le dernier participant est parti sans le dire, son appartenance a
  // expiré — ne donne aucune durée. En inventer une serait pire que de s'en passer.
  if (appel.fin === undefined) return `Appel · ${heure(appel.debut)}`;
  return `Appel · ${dureeAppel(appel.fin - appel.debut)}`;
}

export function AppelObjet({
  appel,
  onRappeler,
}: {
  appel: CallLogEntry;
  onRappeler: () => void;
}) {
  const libelle = libelleAppel(appel);

  return (
    <div
      role="listitem"
      aria-label={libelle}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: "var(--spacing-2)",
        padding: "var(--spacing-2) var(--spacing-3)",
      }}
    >
      <span aria-hidden="true" style={{ display: "flex", color: "var(--color-text-secondary)" }}>
        {IconeAppel}
      </span>
      <Text type="supporting" color="secondary" hasTabularNumbers>
        {libelle}
      </Text>
      {appel.manque && <Button label="Rappeler" variant="ghost" onClick={onRappeler} />}
    </div>
  );
}
