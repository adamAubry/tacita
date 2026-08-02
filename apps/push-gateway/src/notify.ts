import webpush from "web-push";

/** Données de pusher enregistrées par le client (spec 11) : la subscription Web Push complète. */
type PusherData = { endpoint?: string; p256dh?: string; auth?: string };
type Device = { pushkey?: string; data?: PusherData };

/** Payload `POST /_matrix/push/v1/notify` de Synapse (champs utilisés seulement). */
export type Notification = {
  event_id?: string;
  room_id?: string;
  devices?: Device[];
};

function subscriptionOf(data: PusherData | undefined, pushkey: string) {
  if (!data?.p256dh || !data.auth) return null;
  return { endpoint: data.endpoint ?? pushkey, keys: { p256dh: data.p256dh, auth: data.auth } };
}

/** Relaie une notification Synapse en Web Push ; retourne les pushkeys à supprimer. */
export async function notify(notification: Notification): Promise<string[]> {
  const { event_id, room_id, devices = [] } = notification;
  // Synapse envoie aussi des notifications sans event_id (mise à jour du badge seul) : rien à réveiller.
  if (!event_id || !room_id) return [];

  const rejected: string[] = [];
  await Promise.all(
    devices.map(async ({ pushkey, data }) => {
      if (!pushkey) return;
      const subscription = subscriptionOf(data, pushkey);
      if (!subscription) {
        rejected.push(pushkey);
        return;
      }
      try {
        // REQ-PSH-02 : event_id et room_id, rien d'autre. Le client déchiffre après réveil.
        await webpush.sendNotification(subscription, JSON.stringify({ event_id, room_id }));
      } catch (error) {
        const status = (error as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) rejected.push(pushkey);
        // REQ-PSH-04 : ID d'événement et code de statut, jamais le payload ni l'erreur brute.
        console.warn("push_failed", { event_id, status: status ?? 0 });
      }
    }),
  );
  return rejected;
}
