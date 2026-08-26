import { jourSeparateur } from "../../lib/dates";
import { Text } from "../foundation/primitives";

/**
 * Date separator (composant 13).
 *
 * DESIGN.md en fait « l'élévation zéro incarnée » : filet — caption — filet, centré.
 * Pas de pilule, pas de fond, pas d'ombre — le séparateur situe, il ne s'annonce pas.
 */
export function DateSeparator({ horodatage }: { horodatage: number }) {
  const filet = { flex: 1, height: 1, background: "var(--color-border)" };

  return (
    <div
      role="separator"
      aria-label={jourSeparateur(horodatage)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--spacing-3)",
        padding: "var(--spacing-4) var(--spacing-3) var(--spacing-2)",
      }}
    >
      <span style={filet} />
      <Text type="supporting" color="secondary" hasTabularNumbers>
        {jourSeparateur(horodatage)}
      </Text>
      <span style={filet} />
    </div>
  );
}
