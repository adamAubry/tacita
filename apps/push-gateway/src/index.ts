import webpush from "web-push";
import { createGateway } from "./server.ts";

const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT, PORT = "8008" } = process.env;
if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY || !VAPID_SUBJECT) {
  throw new Error("VAPID_SUBJECT, VAPID_PUBLIC_KEY et VAPID_PRIVATE_KEY sont requis (voir README).");
}

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
createGateway(VAPID_PUBLIC_KEY).listen(Number(PORT), () => console.info("listening", { port: PORT }));
