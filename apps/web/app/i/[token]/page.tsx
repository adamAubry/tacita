import { ReceptionLien } from "../../../components/amis/ReceptionLien";

/**
 * La route que `urlDInvitation` fabrique (). Le chemin est écrit à un
 * seul endroit dans le dépôt — ici il est **imposé par Next**, et un test de M-G vérifie
 * que les deux correspondent.
 *
 * L'URL ne porte que le token : ni émetteur, ni salon, ni nom lisible.
 */
export default async function PageInvitation({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <ReceptionLien token={decodeURIComponent(token)} />;
}
