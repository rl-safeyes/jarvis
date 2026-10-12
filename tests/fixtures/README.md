# Recette de protocole sans compte fournisseur

Cette recette utilise un pair Codex factice, le vrai bridge de runtime et un vrai serveur Temporal. Elle vérifie les profils, l’idempotence, l’annulation et la reprise après arrêt forcé du worker. Elle ne qualifie pas l’authentification ni l’inférence des fournisseurs.

À exécuter dans un checkout de test avec une `.env` propre, jamais sur l’instance du propriétaire. Le script cible uniquement `http://localhost:3301` et le worker `jarvis-harness-test_worker_1`. Il crée des conversations et profils de test et arrête/redémarre ce worker.

```bash
npm ci
node scripts/setup.mjs
```

Ajouter dans la `.env` de test :

```dotenv
JARVIS_DB_PORT=55433
JARVIS_HTTP_PORT=3301
JARVIS_PUBLIC_ORIGIN=http://localhost:3301
JARVIS_RUNTIME_PREFIX=jarvis-protocol-fixture
```

Construire le pair factice puis la pile :

```bash
docker build -f tests/fixtures/Dockerfile -t jarvis-protocol-fixture-harness-codex:0.161.0-v2 .
docker compose -p jarvis-harness-test -f docker-compose.yml -f tests/fixtures/compose.yml --profile app up --build -d
node tests/fixtures/check-live-protocol.mjs
```

Le tag et le préfixe `jarvis-protocol-fixture` sont réservés aux tests. Le script soumet un identifiant de clé factice uniquement à ce pair local. Ne jamais substituer ce pair aux images de l’installation normale.

Pour vérifier les images réelles sans utiliser un compte existant, démarrer une autre pile avec le préfixe `jarvis-harness-test`, sans le fichier Compose de fixture ; les trois installations doivent réussir et un compte Codex neuf doit être déconnecté. Les tests Playwright `harnesses.spec.ts` couvrent ce parcours avec `E2E_LIVE=1`.

Après la recette, arrêter la pile Compose et les conteneurs ayant le label `jarvis.owner=jarvis-protocol-fixture`. Les volumes sont conservés pour diagnostic ; aucune suppression de volumes n’est effectuée par le script.

## Recette agents et délégation

Dans un checkout distinct, configurer `.env` avec `JARVIS_DB_PORT=55434`, `JARVIS_HTTP_PORT=3303`, `JARVIS_PUBLIC_ORIGIN=http://localhost:3303`, `JARVIS_RUNTIME_PREFIX=jarvis-delegation-fixture` et le port 55434 dans `DATABASE_URL`.

```bash
docker build -f tests/fixtures/Dockerfile -t jarvis-delegation-fixture-harness-codex:0.161.0-v2 .
docker compose -p jarvis-delegation-test --profile app up --build -d
node tests/fixtures/check-delegation-protocol.mjs
```

Ne pas ajouter `compose.yml` de fixture historique à cette commande : son préfixe est différent. La recette agents cible uniquement le port 3303 et le worker `jarvis-delegation-test_worker_1`. Elle valide création, délégation, restitution, arrêt du spécialiste et reprise du worker sans répéter son inférence. Le profil factice reste disponible pour `tests/e2e/agents.spec.ts` avec `E2E_AGENTS=1`, `E2E_BASE_URL=http://localhost:3303` et le mot de passe propriétaire de cette pile. Arrêter ensuite les services et les conteneurs labellisés `jarvis.owner=jarvis-delegation-fixture`, en conservant les volumes.


## Recette outils de développement

Dans un checkout dédié : `.env` avec `JARVIS_DB_PORT=55435`, `JARVIS_HTTP_PORT=3304`, `JARVIS_PUBLIC_ORIGIN=http://localhost:3304`, `JARVIS_RUNTIME_PREFIX=jarvis-development-fixture` et ce port PostgreSQL dans `DATABASE_URL`.

```bash
docker build -f tests/fixtures/Dockerfile -t jarvis-development-fixture-harness-codex:0.161.0-v2 .
docker compose -p jarvis-development-test --profile tools build development-image
docker compose -p jarvis-development-test --profile app up --build -d
node tests/fixtures/check-development-tools.mjs
node tests/fixtures/check-development-protocol.mjs
```

La première recette utilise Docker pour vérifier les vrais outils, les montages/permissions, les chemins, la reprise idempotente d’une écriture, le patch figé, les tests de référence et l’annulation durable. La seconde connecte uniquement le pair factice, passe par Temporal et vérifie le développement/review, le téléchargement authentifié et l’arrêt. Le pair ne contacte aucun fournisseur.

Les tests navigateur `tests/e2e/development.spec.ts` utilisent `E2E_DEVELOPMENT=1`, `E2E_BASE_URL=http://localhost:3304` et `E2E_OWNER_PASSWORD` pour cette pile uniquement. Après la recette, arrêter la pile et les conteneurs labellisés `jarvis.owner=jarvis-development-fixture`. Les journaux/volumes restent disponibles pour diagnostic.


## Recette connexion Claude par abonnement

Après installation de la recette Claude `2.1.296-v3` :

```bash
node tests/fixtures/check-claude-subscription.mjs
```

La recette monte la CLI factice `claude.mjs` dans un conteneur jetable avec réseau désactivé et un répertoire de compte temporaire. Elle vérifie l’aller-retour du code, le refus d’une autre session, l’inférence en mode abonnement sans clé API, l’échec de quota sans repli API, la persistance après redémarrage, le changement explicite vers l’API et la déconnexion. Le conteneur et son répertoire temporaire sont supprimés à la fin. `CLAUDE_FIXTURE_IMAGE` permet de choisir une autre image de base compatible ; aucun compte réel n’est monté.

Les tests unitaires `claude-auth.test.mjs` couvrent aussi expiration, URL officielle, code incorrect et refus d’une authentification Console présentée comme abonnement. Ces résultats ne remplacent pas un test de profil avec le véritable abonnement du propriétaire.
