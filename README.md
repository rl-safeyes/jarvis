# Jarvis

Assistant personnel avec une PWA React, une API Fastify en TypeScript et une persistance PostgreSQL. Cette première tranche permet de se connecter, de dialoguer avec un **simulateur explicitement identifié**, de suivre les missions et de retrouver les conversations après rechargement.

## Fonctionnalités disponibles

- Connexion du propriétaire avec cookie HttpOnly, expiration, déconnexion et protection CSRF.
- Conversations persistantes et envoi idempotent des messages.
- Missions en file, événements SSE rejouables, annulation et reprise du simulateur après interruption.
- Catalogue initial des départements et profils d’agents.
- Interface responsive, manifeste PWA, icônes et page hors connexion.
- Tests unitaires, tests PostgreSQL, parcours navigateur et workflow GitHub Actions.

**Aucun modèle IA, compte fournisseur, outil shell ou déploiement autonome n’est activé.** Le worker PostgreSQL fourni exécute uniquement le simulateur sans effets de bord. Temporal et les adaptateurs réels seront introduits dans les prochains lots ; le worker refuse les adaptateurs non simulés.

## Lancement pour développer

Prérequis : Node.js 24 recommandé, npm et Docker avec Compose. Le projet exige au minimum Node.js 22.12. Avec nvm : `nvm install && nvm use`.

```bash
npm ci
npm run setup
docker compose up -d db
npm run dev
```

Sur une machine équipée de Compose v1, remplacer `docker compose` par `docker-compose`.

Ouvrir **http://localhost:5173**. Le mot de passe est la valeur `JARVIS_OWNER_PASSWORD` du fichier local `.env`, créé avec des permissions 0600. Le script ne l’affiche pas et ne remplace pas une configuration existante. Ce fichier est exclu de Git. Les migrations sont appliquées au démarrage de l’API.

PostgreSQL utilise le port local 55432, l’API le port 3000 et Vite le port 5173. Utiliser `localhost` dans le navigateur, conformément à `APP_ORIGIN`. Le dépôt ne fournit aucun mot de passe de connexion par défaut.

## Lancement de la version construite

Avec Docker et Node.js disponibles pour générer la configuration :

```bash
node scripts/setup.mjs
docker compose --profile app up --build -d
```

Ouvrir **http://localhost:3000**, avec le même mot de passe local. L’image construit l’interface et sert l’API et la PWA sur la même origine. Cette commande remplace le parcours de développement ; les deux utilisent le port 3000. Les volumes PostgreSQL conservent les données entre les redémarrages.

Les ports sont liés à l’interface locale. Pour un accès iPhone via le réseau, ajouter un reverse proxy HTTPS et définir `JARVIS_PUBLIC_ORIGIN=https://votre-domaine` dans `.env`. Les cookies deviennent alors `Secure`. Ne pas exposer PostgreSQL. Le service worker conserve uniquement une page publique hors connexion, jamais les conversations ni les réponses API. Les brouillons locaux peuvent être conservés dans le navigateur ; les missions demandent une connexion au serveur.

## Commandes de vérification

```bash
npm run check
npm run build
npm run doctor
```

`doctor` vérifie seulement la présence des exécutables Git, Docker et harnesses. Il ne lit pas leurs secrets et n’appelle aucun modèle. La qualification réelle des comptes reste à réaliser.

Les tests d’intégration exigent une URL de **base de test** explicite. Chaque exécution crée puis supprime son propre schéma isolé ; les autres schémas restent intacts.

```bash
TEST_DATABASE_URL='postgresql://utilisateur:mot-de-passe@localhost:port/base-de-test' npm run test:integration
```

Pour les tests navigateur, démarrer l’application, installer Chromium avec `npx playwright install chromium`, puis fournir le mot de passe de cet environnement de test :

```bash
E2E_OWNER_PASSWORD='mot-de-passe-de-test' npm run test:e2e
```

`E2E_BASE_URL` permet de changer l’URL et `CHROME_PATH` de réutiliser un exécutable Chromium installé. Les captures et traces vont dans `test-results/`, exclu de Git. Le profil mobile émule l’iPhone sous Chromium ; la recette sur Safari et iPhone réels reste à faire.

## Organisation du code

| Dossier | Responsabilité |
| --- | --- |
| `apps/api` | Authentification, API, événements et worker de simulation |
| `apps/web` | PWA et interface de conversation |
| `packages/contracts` | Validation des entrées et types partagés |
| `packages/storage` | Transactions, migrations et persistance |
| `packages/agent-registry` | Profils initiaux des agents et départements |
| `packages/harness-core` | Premier contrat d’exécution commun |
| `packages/harness-mock` | Simulateur déterministe, sans effet externe |
| `infra` | Construction Docker |
| `tests` | Tests unitaires, intégration et navigateur |

Les dépendances sont gérées à la racine du workspace npm et épinglées dans `package-lock.json`. Pour formater le code, utiliser `npm run format`.

## Prochain jalon

Qualifier un compte et un harness réel, intégrer Temporal pour les exécutions longues, puis ajouter les environnements isolés et la politique de capacités avant toute exécution de code généré. La voix, la création dynamique d’agents et l’auto amélioration suivent les lots décrits dans les spécifications.

- [Architecture et périmètre](specs/README.md)
- [Plan de réalisation](specs/08-implementation.md)
- [État du premier jalon](specs/10-etat-implementation.md)
