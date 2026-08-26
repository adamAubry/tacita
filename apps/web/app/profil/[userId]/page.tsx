import { EcranProfil } from "../../../components/profil/EcranProfil";

/**
 * Layout Profile, variante « autrui » (M-G —).
 *
 * L'URL est celle que M-H avait réservée en posant un Placeholder ici : le bouton
 * « Profil » des informations d'un DM y mène déjà, et la garder évite de
 * réécrire un lien qui marche.
 */
export default async function PageProfil({ params }: { params: Promise<{ userId: string }> }) {
  // Un `@nom:serveur` passe par l'URL encodé ; on le décode ici, une seule fois.
  const { userId } = await params;
  return <EcranProfil userId={decodeURIComponent(userId)} />;
}
