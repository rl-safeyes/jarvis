# Jarvis

Assistant personnel en TypeScript avec PWA, API Fastify, PostgreSQL, Temporal et runtimes de harnesses dans Docker.

Cette version permet d’installer des moteurs du catalogue, connecter des comptes, tester des profils, choisir un défaut et affecter un profil à Jarvis ou aux fiches des spécialistes. Les conversations réelles passent par le harness choisi, avec historique, annulation et suivi durable. Les spécialistes autonomes, la voix et l’auto-amélioration ne sont pas encore activés.

## Démarrer avec Docker

Prérequis : Docker et Compose, Node.js 24 pour le script de configuration. Aucun Codex, Claude Code ou OpenCode n’est requis sur le serveur.

```bash
node scripts/setup.mjs
docker compose --profile app up --build -d
```

Avec Compose v1, remplacer `docker compose` par `docker-compose`. Ouvrir **http://localhost:3000**. Le mot de passe est la valeur `JARVIS_OWNER_PASSWORD` dans `.env`. Relancer `setup` sur une installation existante ajoute les secrets manquants sans modifier les mots de passe existants.

Le premier démarrage installe Codex automatiquement dans une image dédiée. Pour préparer plusieurs moteurs dès le départ, définir `JARVIS_INITIAL_HARNESSES=codex,claude-code,opencode` dans `.env` avant le démarrage. Une opération d’installation apparaît dans les réglages ; sa construction peut prendre plusieurs minutes.

## Connecter un harness

Dans **Réglages** :

1. Attendre l’installation initiale ou installer un autre moteur.
2. Ajouter un compte nommé pour ce moteur.
3. Connecter le compte avec le parcours proposé, puis cliquer sur **Vérifier la connexion**.
4. Créer un profil avec un nom et un identifiant de modèle accessible à ce compte.
5. Cliquer sur **Tester** : une courte demande réelle est envoyée au fournisseur.
6. Choisir le profil prêt comme défaut. Jarvis et les agents sans choix spécifique héritent de ce défaut.

| Harness | Version livrée | Connexions dans cette tranche |
| --- | --- | --- |
| Codex | 0.161.0 | Code d’appareil ChatGPT ou clé API OpenAI |
| Claude Code | 2.1.296 | Clé API Anthropic ; connexion d’abonnement non intégrée |
| OpenCode | 1.18.35 | Clé API OpenAI ou Anthropic ; modèle au format `fournisseur/modèle` |

Le parcours ChatGPT requiert que la connexion par code d’appareil soit autorisée pour le compte. Les méthodes réellement disponibles restent soumises au fournisseur. Un catalogue de modèles n’atteste pas des droits : seul le test réel valide le profil. Les appels API utilisent la facturation du compte choisi. Aucun compte, jeton ou exécutable n’est importé depuis le serveur hôte.

L’interface reste accessible sans moteur connecté. Les clés se saisissent dans le formulaire dédié, jamais dans une conversation. Les clés Claude/OpenCode sont chiffrées dans le volume de compte ; Codex gère son cache natif protégé dans son propre volume. Conserver les volumes **et** `JARVIS_VAULT_KEY` pour restaurer les connexions. Ne pas remplacer cette clé sans migration des secrets. Une session révoquée chez le fournisseur exige une nouvelle connexion.

## Administrer par conversation

Ces commandes explicites sont reconnues sans dépendre d’un modèle :

- « Jarvis, installe OpenCode »
- « Connecte mon compte Codex » — ouvre le parcours via les réglages ; l’identification reste une action du propriétaire.
- « Utilise Codex par défaut »
- « Jarvis, travaille sur Claude Code »
- « Modifie le prompt du reviewer pour utiliser Codex »
- « Remets le reviewer sur le défaut »

Le choix du moteur est enregistré dans la fiche structurée avant l’envoi du prompt. Les instructions de rôle sont modifiables dans la même fiche. Si plusieurs profils du moteur sont prêts, Jarvis demande de choisir dans les réglages ; il ne choisit pas silencieusement un compte. Le parseur couvre les formes ci-dessus, pas encore toutes les formulations naturelles. Un harness inconnu du catalogue nécessite une nouvelle intégration logicielle.

Un changement de défaut concerne les prochains runs. Les missions en cours conservent leur profil, compte, modèle et versions. Les agents à profil explicite restent sur ce profil. Un profil déconnecté ou non testé bloque le lancement au lieu de déclencher un repli implicite.

## Exécution et exploitation

- Temporal orchestre installations, tests et missions réelles. Une outbox PostgreSQL assure le démarrage durable avec un identifiant stable.
- Le superviseur est le seul composant qui monte le socket Docker. Il constitue une partie privilégiée du plan de contrôle ; ses recettes et son API interne doivent rester réservées à l’administrateur. Aucun port du superviseur ou des runtimes n’est publié.
- Un conteneur de compte est non privilégié, limité en ressources et séparé de l’API. Il possède son propre volume persistant et accepte une inférence à la fois. Il ne reçoit aucun montage du dépôt ou du répertoire personnel de l’hôte.
- Dans cette tranche, les outils des modèles sont désactivés : conversation uniquement, pas de shell, de développement autonome ou d’édition du serveur.
- Les workflows sont compilés dans l’image. Le worker n’a pas besoin d’écrire dans le code au démarrage.
- Le registre d’exécution du runtime rend le lancement idempotent. Un crash du worker peut se rattacher au résultat existant. Un crash du runtime pendant un appel produit un échec explicite avec résultat inconnu, sans deuxième inférence aveugle.
- Les conversations transfèrent les 20 derniers messages, bornés à 64 000 caractères, dans une nouvelle session native par mission. La reprise native longue et le streaming token par token restent à ajouter.

Les services Compose utilisent les volumes `postgres-data` et `temporal-data`. Les volumes de compte portent le préfixe `jarvis-account-…-data`, et les conteneurs le label `jarvis.owner=jarvis`. Ces conteneurs sont gérés par le superviseur, pas directement par Compose : `docker compose down` seul ne les arrête pas. Pour un arrêt complet, arrêter d’abord le worker puis les conteneurs portant ce label, sans supprimer leurs volumes. Les préfixes sont configurables via `JARVIS_RUNTIME_PREFIX` pour isoler plusieurs installations.

Pour un accès distant, installer un proxy HTTPS et définir `JARVIS_PUBLIC_ORIGIN` sur l’origine publique exacte. Aucun port fournisseur n’est à exposer. L’accès Safari/iPhone réel reste à qualifier ; le format mobile est testé avec Chromium.

## Développement et tests

```bash
npm ci
npm run setup
# Pour travailler uniquement sur le simulateur : HARNESS_MODE=mock dans .env
docker compose up -d db
npm run dev
npm run check
npm run build
```

Pour les tests d’intégration, définir `TEST_DATABASE_URL` vers une base dédiée : chaque fichier crée puis supprime son propre schéma. `npm run test:integration` ne doit pas viser une base de production.

Les tests Playwright de conversation utilisent le mode `mock`, `E2E_BASE_URL` et `E2E_OWNER_PASSWORD`. Les tests `harnesses.spec.ts` demandent `E2E_LIVE=1` et une pile Docker de test avec Codex installé, sans compte connecté. Voir [la recette de protocole](tests/fixtures/README.md) pour tester les exécutions et la reprise Temporal sans appel fournisseur.

## État et suite

L’installation des trois images, le parcours navigateur et les contrats de protocole sont vérifiés. La qualification d’une inférence avec les comptes réels du propriétaire reste à effectuer depuis l’interface. Les autres fonctions prévues sont détaillées dans [specs](specs/README.md), avec [l’état exact de l’implémentation](specs/10-etat-implementation.md).
