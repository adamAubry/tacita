import { EcranRecherche } from "../../../components/recherche/EcranRecherche";

/** Onglet Mentions (M-F) — le champ `mentions` de l'index, jamais un plein-texte. */
export default function Mentions() {
  return <EcranRecherche variation="mentions" />;
}
