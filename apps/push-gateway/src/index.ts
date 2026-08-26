import webpush from "web-push";
import { createGateway } from "./server.ts";

const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT, PORT = "8008" } = process.env;
if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY || !VAPID_SUBJECT) {
  throw new Error("VAPID_SUBJECT, VAPID_PUBLIC_KEY et VAPID_PRIVATE_KEY sont requis (voir README).");
}

/**
 * La **taille** des clés, et pas seulement leur présence — ajouté le 24/08/2026 après un
 * staging où la passerelle redémarrait en boucle depuis toujours.
 *
 * Le contrôle de présence laissait passer un `.env` resté sur `change-me`. `web-push`
 * refusait alors la clé, mais son message — « Vapid public key should be 65 bytes long
 * when decoded » — parle d'octets décodés, pas de la variable qui les porte ni du fichier
 * où elle vit. Le service ne démarrait pas, `/push/config` répondait 502, et **aucun push
 * n'a jamais pu partir** : la panne était totale, permanente, et son seul symptôme visible
 * était un journal que personne ne lit tant que la pile a l'air debout.
 *
 * Une paire P-256 : 65 octets pour le point public non compressé, 32 pour le scalaire
 * privé. Seule la taille est journalisée, jamais la valeur.
 */
for (const [nom, attendus] of [
  ["VAPID_PUBLIC_KEY", 65],
  ["VAPID_PRIVATE_KEY", 32],
] as const) {
  const octets = Buffer.from(process.env[nom] ?? "", "base64url").length;
  if (octets !== attendus) {
    throw new Error(
      `${nom} n'est pas une clé VAPID valide : ${octets} octets décodés, ${attendus} attendus. ` +
        "Générer la paire — docker run --rm node:22-alpine npx -y web-push generate-vapid-keys — " +
        "puis recopier les deux valeurs telles quelles dans infra/.env, sans guillemets, " +
        "sans espace et sans retour à la ligne.",
    );
  }
}

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
createGateway(VAPID_PUBLIC_KEY).listen(Number(PORT), () => console.info("listening", { port: PORT }));
