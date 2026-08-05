import { LayoutHeader } from "../../../components/foundation/LayoutHeader";
import { Placeholder } from "../../../components/foundation/Placeholder";

/** Layout Conversation — timeline, composer et gestes sont livrés par M-D. */
export default function Conversation() {
  return (
    <>
      <LayoutHeader titre="Conversation" />
      <Placeholder titre="Conversation" explication="Les messages apparaîtront ici." />
    </>
  );
}
