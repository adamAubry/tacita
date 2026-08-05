import { Conversation } from "../../../components/conversation/Conversation";

/** Layout Conversation (M-D). Le paramètre de route est l'identifiant du salon. */
export default async function PageConversation({
  params,
}: {
  params: Promise<{ roomId: string }>;
}) {
  // Un `!salon:serveur` passe par l'URL encodé : le rendre tel quel au composant évite
  // que chaque appel de paquet ait à le décoder à son tour.
  const { roomId } = await params;
  return <Conversation roomId={decodeURIComponent(roomId)} />;
}
