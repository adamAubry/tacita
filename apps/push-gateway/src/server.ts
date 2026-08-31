import { createServer } from "node:http";
import { notify, type Notification } from "./notify.ts";

// Une notification Synapse (event_id, room_id, liste de pushers) tient largement là-dedans.
// Sans borne, `JSON.parse` sur un corps illimité serait un déni de service — la passerelle
// n'a pas de port publié, mais elle reçoit de Synapse, et un Synapse compromis ne mérite
// pas qu'on lui laisse épuiser la mémoire du process.
const MAX_BODY = 1_000_000;

async function readBody(req: NodeJS.ReadableStream): Promise<unknown> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    total += (chunk as Buffer).length;
    if (total > MAX_BODY) throw new Error("corps trop volumineux"); // → 400, comme un corps illisible
    chunks.push(chunk as Buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf-8"));
}

/** Passerelle Matrix Push Gateway → Web Push. `vapidPublicKey` est exposée pour l'abonnement client. */
export function createGateway(vapidPublicKey: string) {
  return createServer((req, res) => {
    const json = (status: number, body: unknown) => {
      res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));
      // REQ-PSH-04 : méthode, chemin, statut. Jamais le corps de la requête.
      console.info("request", { method: req.method, url: req.url, status });
    };

    if (req.method === "GET" && req.url === "/config") {
      // REQ-PSH-03 : clé publique VAPID, seule valeur nécessaire au client pour s'abonner.
      return json(200, { vapid_public_key: vapidPublicKey });
    }

    if (req.method === "POST" && req.url === "/_matrix/push/v1/notify") {
      // Un seul chemin d'échec : corps illisible, `notification` absente ou relais en panne → 400.
      return void readBody(req)
        .then((body) => {
          const notification = (body as { notification?: Notification }).notification;
          if (!notification) throw new Error("notification manquante");
          return notify(notification);
        })
        .then(
          (rejected) => json(200, { rejected }),
          () => json(400, { errcode: "M_BAD_JSON" }),
        );
    }

    return json(404, { errcode: "M_UNRECOGNIZED" });
  });
}
