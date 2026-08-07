import { EcranAppel } from "../../../../components/appels/EcranAppel";

/**
 * L'écran d'appel (M-I). Une route et non une modale : c'est un plein écran dont on
 * ressort par le retour du navigateur, et un appel doit survivre à un geste de retour
 * mal placé — pas disparaître avec une feuille.
 */
export default async function PageAppel({
  params,
  searchParams,
}: {
  params: Promise<{ roomId: string }>;
  searchParams: Promise<{ video?: string }>;
}) {
  const [{ roomId }, { video }] = await Promise.all([params, searchParams]);
  return <EcranAppel roomId={decodeURIComponent(roomId)} video={video === "1"} />;
}
