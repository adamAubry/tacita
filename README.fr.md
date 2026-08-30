*[English](README.md) · **Français***

# Tacita

**Messagerie chiffrée de bout en bout, auto-hébergée, pour un cercle fermé.** Une seule
commande déploie toute la pile sur votre serveur ; vos proches l'installent depuis le
navigateur comme une application. Elle remplace les DM et groupes Instagram, sans la
surveillance ni la publicité.

[![Licence : MIT](https://img.shields.io/badge/License-MIT-black.svg)](LICENSE)
![État : pré-1.0](https://img.shields.io/badge/status-pre--1.0-orange.svg)
![Matrix](https://img.shields.io/badge/protocol-Matrix-000.svg)

**Lisez [THREAT_MODEL.md](THREAT_MODEL.md) avant de lui confier quoi que ce soit.** C'est
la version honnête de la phrase ci-dessus : ce que le chiffrement couvre, ce qu'il ne
couvre pas, et où sont les arêtes vives.

---

## Pas un client Matrix — la boîte entière

Tacita n'est pas une application qu'on pointe vers le serveur de quelqu'un d'autre. C'est
**toute la pile**, déployée d'un bloc sur une machine qui vous appartient : Synapse,
PostgreSQL, MinIO pour les blobs chiffrés, LiveKit et Element Call pour les appels, nginx
pour le TLS, et la PWA.

Pour un compte Matrix existant, utilisez Element — il est excellent, et ce n'est pas ce
que fait Tacita. Pour une messagerie privée à douze personnes qui vit entièrement sur
votre machine, c'est exactement ça.

## Installation

Sur un serveur Ubuntu neuf, avec un domaine qui pointe dessus :

```sh
git clone https://github.com/adamAubry/tacita.git
cd tacita
./install.sh --domaine=chat.example.org --email=vous@example.org
```

Six étapes : prérequis, configuration, vérification DNS, certificat TLS, pile,
diagnostic. Le script est **reprenable** — s'il s'arrête, corrigez ce qu'il nomme et
relancez-le : il repart où il en était. À la fin, ouvrez votre domaine et créez le
premier compte depuis l'application.

```sh
./install.sh --dev     # machine locale, certificat auto-signé
pnpm admin doctor      # diagnostique une pile qui tourne, sans rien toucher
```

### Prérequis

- **Ubuntu 22.04 ou 24.04**, root ou sudo (autre distribution : installer soi-même
  Node 22+, pnpm, Docker avec le plugin compose v2 et certbot, puis lancer le script)
- **4 Go de RAM recommandés, 2 Go minimum avec swap.** L'application web est compilée
  sur votre machine pendant l'installation, parce que le build inscrit votre domaine
  dans le bundle. C'est de loin le moment le plus lourd.
- **Un domaine**, avec un enregistrement `A` pour lui et pour `call.<votre-domaine>`
- **Ports ouverts** : `80/tcp` (certbot seulement, le temps du défi), `443/tcp`,
  `3478/udp` et `5349/tcp` (TURN), `7881/tcp` et `50000-50100/udp` (média des appels).
  `./install.sh` ouvre lui-même ceux du RTC quand `ufw` est là — les oublier fait qu'un
  appel se connecte, affiche les participants, puis meurt à 15-20 secondes sans rien dire.

## Fonctionnalités

- Conversations **chiffrées de bout en bout**, directes et de groupe (crypto Rust)
- **Appels audio et vidéo** chiffrés, via Element Call
- **Photos, vidéos, vocaux et fichiers** — chiffrés côté client avant l'envoi, un seul
  pipeline pour tous les types
- **Hors ligne** : lire, chercher et composer sans connexion ; ce que vous écrivez part
  à la reconnexion et survit à un rechargement
- **Recherche locale** dans votre historique — le serveur n'est jamais interrogé, il ne
  saurait pas répondre
- **Installable** sur iOS et Android depuis le navigateur, notifications comprises
- Réponses, réactions, éditions, épinglage, mentions, indicateurs de saisie, accusés

## Ce que le serveur voit

Le serveur ne voit jamais le contenu d'un message. Il voit les métadonnées, et la nuance
compte : qui parle à qui et quand, la taille exacte de chaque pièce jointe — donc, à
débit quasi constant, **la durée de chaque vidéo et de chaque vocal** — et les réactions,
qui ne sont pas chiffrées.

Une arête vive à connaître avant de commencer : **votre clé de récupération transite vers
le serveur au changement de mot de passe**, et elle ouvre une session à elle seule. C'est
tenable parce que l'opérateur, c'est vous. Ça cesse de l'être si vous hébergez pour des
inconnus.

Tout est écrit dans **[THREAT_MODEL.md](THREAT_MODEL.md)**.

## État

Pré-1.0, et le dit. Le projet distingue deux portes :

```sh
npm test        # tests unitaires et de configuration, sur imitations
npm run smoke   # vrai Synapse, vraie crypto, vrai IndexedDB (Docker requis)
```

**Prouvé à l'exécution** : la crypto Rust réellement chargée, un salon effectivement
chiffré côté serveur, l'aller-retour chiffrement → serveur → déchiffrement, et la reprise
de session sans réseau.

**Non prouvé** : tout le reste — la passerelle push de bout en bout, le média contre un
vrai serveur, LiveKit en charge. Rien n'a jamais été rendu dans un vrai navigateur par un
test automatisé ; `apps/web/README.md` dit ce que ça laisse invérifié.

Chaque paquet porte dans son `README.md` son contrat d'interface et ses limites assumées.
Ces limites ne sont pas de la communication : plusieurs sont tenues par des tests qui
échouent si le README cesse de les dire.

## Contribuer

Les issues et les pull requests sont bienvenues. [CONTRIBUTING.md](CONTRIBUTING.md) porte
tout le contrat — il est court, et il évite une PR refusée. Ses contraintes ne sont pas
des préférences : la plupart ont été écrites après un bug précis.

## Licence

MIT — voir [LICENSE](LICENSE).
