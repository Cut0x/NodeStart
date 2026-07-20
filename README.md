# NodeStart

**NodeStart** est une application de bureau (Windows) qui centralise la gestion de vos projets Node.js grâce à **Docker** : chaque projet tourne dans son propre conteneur, avec exactement la version de Node.js qu'il attend — sans jamais installer quoi que ce soit directement sur votre système, et sans jamais faire cohabiter plusieurs versions de Node dans votre PATH.

## L'idée du projet

Sur une même machine, il est courant de travailler sur plusieurs projets Node.js qui n'attendent pas la même version de Node. Docker règle élégamment ce problème : chaque version de Node.js est simplement une image Docker officielle (`node:18`, `node:22-alpine`, ...), et chaque projet tourne dans son propre conteneur isolé, avec son dossier monté dedans.

NodeStart pilote tout ça avec une interface graphique unique, façon Discord :

- il **vérifie automatiquement** que Docker Desktop (et WSL2, son prérequis) sont installés et démarrés dès l'ouverture de l'application ;
- si un prérequis manque, il propose de **l'installer pour vous** — après vous avoir explicitement demandé confirmation, jamais en silence ;
- il **télécharge (pull) les images Node.js** que vous choisissez, directement depuis Docker Hub ;
- vous **ajoutez un projet** en donnant son chemin sur le disque (ex. `C:\Users\username\Documents\MyFolderProject`) et l'image Node.js à utiliser ;
- il **vérifie** que le `package.json` du projet contient bien un script `"start"` (nécessaire pour que `npm run start` fonctionne) ;
- en ouvrant un projet, vous accédez à sa propre page de contrôle : **Démarrer / Arrêter / Redémarrer / Synchroniser le dossier**, avec la **console en direct** du conteneur.

## Fonctionnalités

### Prérequis gérés automatiquement
- Détection au lancement de Docker Desktop (CLI présent + moteur démarré) et de WSL2.
- Bandeau d'état toujours visible tant qu'un prérequis manque, avec un bouton "Revérifier".
- Installation de WSL2 et de Docker Desktop **directement depuis NodeStart**, à la demande :
  - une confirmation explicite est toujours demandée avant toute installation ;
  - l'installeur officiel de Docker Desktop est téléchargé puis exécuté silencieusement (`--quiet --accept-license --backend=wsl-2`) ;
  - ces opérations nécessitent une autorisation administrateur (invite Windows/UAC) ;
  - un redémarrage de Windows peut être nécessaire ensuite (WSL2/virtualisation) — NodeStart vous le signale clairement plutôt que de prétendre que tout est instantané.

### Images Node.js (Docker)
- Liste des images déjà installées (pull local), avec suppression en un clic.
- Une sélection courante (LTS, current, latest, principales versions majeures) est proposée par défaut.
- Champ de recherche interrogeant en direct l'API Docker Hub pour retrouver **n'importe quel tag officiel** de l'image `node` (variantes `-alpine`, `-slim`, versions précises, etc.).
- Téléchargement (`docker pull`) avec le journal de sortie en direct.

### Projets
- Ajout d'un projet : nom (optionnel), chemin complet sur le disque (sélecteur de dossier ou saisie directe), image Node.js à utiliser (parmi celles installées).
- Vérification automatique du `package.json` (présence du fichier, présence d'un script `"start"`), avec badge d'état sur chaque projet.
- **Cliquer sur un projet ouvre sa page dédiée**, avec :
  - **▶ Démarrer** — crée le conteneur si besoin puis le démarre (`npm install && npm run start` s'exécute dedans) ;
  - **■ Arrêter** — arrête le conteneur proprement ;
  - **⟳ Redémarrer** — redémarre le conteneur ;
  - **⇅ Sync le dossier** — recrée le conteneur avec le dossier et l'image actuellement configurés (utile après avoir changé l'image Node.js ou déplacé le projet) ;
  - **Console en direct** — les logs du conteneur (`docker logs -f`) s'affichent en temps réel ;
  - **Ouvrir le dossier**, **Retirer le projet**.
- Le dossier du projet est monté directement dans le conteneur (bind mount) : toute modification de fichier côté hôte est immédiatement visible dans le conteneur, et `node_modules` installé par le conteneur reste sur votre disque.

### Thème
Thème sombre inspiré de l'interface de Discord, avec le **vert officiel Node.js** (`#339933`) comme unique couleur d'accent (boutons, onglets actifs, statuts "en cours d'exécution").

## Prérequis (pour développer / builder NodeStart)

- Windows 10/11 (x64)
- [Node.js](https://nodejs.org/) 18 ou supérieur, avec `npm` (uniquement pour développer NodeStart lui-même — une fois packagé en `.exe`, l'application n'a besoin que de Docker Desktop, qu'elle sait installer pour vous)
- Une connexion internet

> Docker Desktop et WSL2 ne sont **pas** requis pour développer/lancer NodeStart lui-même — uniquement pour utiliser ses fonctionnalités de gestion de projets (installer des images, démarrer des conteneurs).

## Déploiement en local

1. **Cloner le dépôt et installer les dépendances**

   ```powershell
   git clone https://github.com/<votre-compte>/NodeStart.git
   cd NodeStart
   npm install
   ```

2. **(Optionnel) Configurer les variables d'environnement**

   ```powershell
   Copy-Item .env.example .env
   ```

   | Variable             | Description                                                                 | Défaut                                   |
   |-----------------------|------------------------------------------------------------------------------|-------------------------------------------|
   | `PROJECTS_DB_PATH`    | Fichier où est stockée la liste des projets ajoutés                          | `%APPDATA%\NodeStart\projects.json`      |

3. **Lancer l'application en mode développement**

   ```powershell
   npm start
   ```

4. **(Optionnel) Régénérer le logo**

   Le logo (`assets/logo-*.png` et `build/icon.ico`) est généré par un script PowerShell autonome (aucune dépendance externe, uniquement System.Drawing/GDI+) :

   ```powershell
   npm run generate-logo
   ```

5. **Construire l'exécutable Windows (`.exe`)**

   ```powershell
   npm run dist
   ```

   > **Windows doit avoir le "Mode développeur" activé** (Paramètres > Confidentialité et sécurité > Pour les développeurs) pour que `electron-builder` puisse extraire ses outils de build (création de liens symboliques). Sans cela, le build échoue avec une erreur de type "Cannot create symbolic link".

   Cela génère dans `dist/` :
   - `NodeStart_Setup_v<version>.exe` — installeur NSIS classique ;
   - `NodeStart_Portable_v<version>.exe` — version portable, sans installation.

## Structure du projet

```
NodeStart/
├── assets/                  # Logo (3 tailles, même design)
│   ├── logo-small.png       # 256×256
│   ├── logo-medium.png      # 512×512
│   └── logo-large.png       # 1024×1024
├── build/
│   ├── generate-logo.ps1    # Génération procédurale du logo (GDI+, sans dépendance)
│   └── icon.ico              # Icône Windows dérivée du logo (généré)
├── src/
│   ├── main/                 # Processus principal Electron
│   │   ├── main.js           # Point d'entrée, fenêtre, IPC
│   │   ├── dockerManager.js  # Prérequis, images Docker, cycle de vie des conteneurs
│   │   └── projectManager.js # Ajout / listing / suppression des projets, vérification package.json
│   ├── preload/
│   │   └── preload.js        # Pont sécurisé (contextBridge) entre l'UI et le processus principal
│   └── renderer/              # Interface utilisateur (HTML/CSS/JS)
│       ├── index.html
│       ├── renderer.js
│       └── styles.css
├── .env.example
├── .gitignore
├── package.json
└── README.md
```

## Où sont stockées les données ?

- La liste des projets : `%APPDATA%\NodeStart\projects.json`
- Les images Node.js sont gérées par Docker lui-même (`docker images`), pas par NodeStart.
- Chaque projet correspond à un conteneur Docker nommé `nodestart-<id>`.

## Notes techniques

- Chaque conteneur de projet exécute `sh -c "npm install && npm run start"` avec le dossier du projet monté en volume sur `/app` — aucune compilation ni installation native sur la machine hôte.
- La liste des tags Node.js disponibles à l'installation provient de l'API publique Docker Hub (`hub.docker.com/v2/repositories/library/node/tags`).
- L'installation de WSL2/Docker Desktop se fait via une invite d'élévation Windows standard (UAC) ; NodeStart ne contourne jamais les mécanismes de sécurité de Windows.
- L'application est construite avec [Electron](https://www.electronjs.org/) et packagée avec [electron-builder](https://www.electron.build/).

## Migration depuis la v1.x

La version 2.0.0 remplace entièrement le gestionnaire natif de versions Node.js (téléchargement d'archives `.zip`) par Docker. Les projets ajoutés sous une version antérieure à 2.0.0 ne sont pas compatibles avec ce nouveau format (le champ `nodeVersion` est remplacé par `nodeImage`, un tag Docker) : il faut ré-ajouter vos projets après mise à jour.

## Licence

ISC
