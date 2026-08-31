import { EcranAppel } from "../../../../components/appel/EcranAppel";

/**
 * Écran d'appel — M-I, REQ-UI-19 / REQ-UIX-38.
 *
 * Une route et non une surcouche de la conversation : le retour du navigateur suffit
 * alors à quitter l'appel, et le même chemin sert au header, au bandeau « rejoindre » et
 * aux boutons d'un profil (REQ-UIX-39).
 */
export default async function PageAppel({
  params,
  searchParams,
}: {
  params: Promise<{ roomId: string }>;
  searchParams: Promise<{ media?: string; rejoindre?: string }>;
}) {
  const { roomId } = await params;
  const { media, rejoindre } = await searchParams;

  return (
    <EcranAppel
      roomId={decodeURIComponent(roomId)}
      // Le paramètre vient de l'URL, donc de n'importe où : tout ce qui n'est pas
      // « audio » est un appel vidéo, plutôt qu'un écran qui refuse de s'ouvrir.
      media={media === "audio" ? "audio" : "video"}
      rejoindre={rejoindre === "1"}
    />
  );
}
