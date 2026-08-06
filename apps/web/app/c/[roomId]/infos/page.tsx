import { InfosConversation } from "../../../../components/settings/InfosConversation";

/** Layout Conversation info — M-H, REQ-UIX-33 à 37. */
export default async function PageInfosConversation({
  params,
}: {
  params: Promise<{ roomId: string }>;
}) {
  const { roomId } = await params;
  return <InfosConversation roomId={decodeURIComponent(roomId)} />;
}
