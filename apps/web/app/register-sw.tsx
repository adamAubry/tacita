"use client";

import { useEffect } from "react";

/**
 * enregistrement du service worker. Hors production, on ne l'enregistre pas :
 * un SW qui sert une coquille en cache pendant le développement fait passer des heures à
 * déboguer du code qui n'est plus celui du disque.
 */
export function RegisterServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;
    void navigator.serviceWorker.register("/sw.js").catch(() => {
      // Un SW qui ne s'enregistre pas dégrade l'app hors ligne, il ne la casse pas :
      // rien à afficher, et surtout rien à journaliser — l'erreur peut porter l'URL.
    });
  }, []);

  return null;
}
