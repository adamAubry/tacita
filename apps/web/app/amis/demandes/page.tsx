import { LayoutHeader } from "../../../components/foundation/LayoutHeader";
import { Placeholder } from "../../../components/foundation/Placeholder";

/** Layout Friend request — livré par M-G. */
export default function Demandes() {
  return (
    <>
      <LayoutHeader titre="Demandes" />
      <Placeholder titre="Aucune demande" explication="Les invitations reçues apparaîtront ici." />
    </>
  );
}
