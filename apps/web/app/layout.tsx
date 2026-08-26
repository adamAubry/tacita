import type { Metadata, Viewport } from "next";

// `tokens.css` en premier, et l'ordre compte : il ouvre par la déclaration des couches en
// cascade, qui n'a d'effet que si elle précède la première feuille qui en utilise une.
import "../components/foundation/tokens.css";
import "@astryxdesign/core/astryx.css";
import { PALETTE } from "../components/foundation/palette";
import { Providers } from "./providers";
import { RegisterServiceWorker } from "./register-sw";

export const metadata: Metadata = {
  title: "Tacita",
  // le manifeste est un fichier statique : le service worker doit pouvoir
  // le précacher comme le reste de la coquille.
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "Tacita", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  // `viewport-fit=cover` : sans lui, `env(safe-area-inset-*)` vaut zéro et la navbar
  // passe sous la barre de gestes en PWA installée sur iOS.
  viewportFit: "cover",
  // La barre système du navigateur : lue avant toute feuille de style, elle ne peut pas
  // prendre une variable CSS. Elle vient donc du thème, jamais d'une valeur recopiée.
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: PALETTE.bg.clair },
    { media: "(prefers-color-scheme: dark)", color: PALETTE.bg.sombre },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body>
        <Providers>{children}</Providers>
        <RegisterServiceWorker />
      </body>
    </html>
  );
}
