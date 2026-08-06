import { LayoutHeader } from "../../../components/foundation/LayoutHeader";
import { Placeholder } from "../../../components/foundation/Placeholder";

/**
 * Layout Profile, variante « autrui » — livré par M-G (REQ-UIX-25/26).
 *
 * La route existe dès maintenant parce que M-H y mène : le bouton « Profil » des
 * informations d'un DM (REQ-UIX-33) doit atterrir quelque part, et une route absente
 * rendrait un 404 là où le wireframe promet un écran.
 */
export default async function PageProfil({ params }: { params: Promise<{ userId: string }> }) {
  const { userId } = await params;

  return (
    <>
      <LayoutHeader titre="Profil" />
      <Placeholder
        titre={decodeURIComponent(userId)}
        explication="Le profil, la note et les contenus partagés arrivent avec le module social."
      />
    </>
  );
}
