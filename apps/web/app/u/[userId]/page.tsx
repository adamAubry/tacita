import { EcranProfil } from "../../../components/profil/EcranProfil";

/** Layout Profile — celui de quelqu'un d'autre (M-G). */
export default async function PageProfilAutrui({
  params,
}: {
  params: Promise<{ userId: string }>;
}) {
  // Un `@nom:serveur` passe par l'URL encodé ; on le décode ici, une seule fois.
  const { userId } = await params;
  return <EcranProfil userId={decodeURIComponent(userId)} />;
}
