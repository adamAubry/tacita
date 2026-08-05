import { LayoutHeader } from "../../../components/foundation/LayoutHeader";
import { Placeholder } from "../../../components/foundation/Placeholder";

/** Layout Add-friends — livré par M-G (identifiant Matrix direct, et lien de la spec 12). */
export default function AjouterUnAmi() {
  return (
    <>
      <LayoutHeader titre="Ajouter" />
      <Placeholder
        titre="Ajouter quelqu'un"
        explication="Par son identifiant Matrix, ou par un lien d'invitation."
      />
    </>
  );
}
