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
