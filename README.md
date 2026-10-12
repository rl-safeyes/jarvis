# Jarvis

Assistant personnel en TypeScript avec PWA, API Fastify, PostgreSQL, Temporal et runtimes de harnesses dans Docker.

Cette version permet d’installer des moteurs du catalogue, connecter des comptes, tester des profils, choisir un défaut et affecter un profil à Jarvis ou aux fiches des spécialistes. Les conversations réelles passent par le harness choisi, avec historique, annulation et suivi durable. Jarvis peut créer des agents par département et leur déléguer des tâches de rédaction ou d’analyse. Les missions de développement peuvent produire un patch testé et revu dans une copie isolée. La dictée vocale en français utilise Speaches/faster-whisper auto-hébergé. La synthèse vocale et la publication autonome ne sont pas encore activées.

## Démarrer avec Docker

Prérequis : Docker et Compose, Node.js 24 pour le script de configuration. Aucun Codex, Claude Code ou OpenCode n’est requis sur le serveur.

```bash
node scripts/setup.mjs
docker compose --profile app up --build -d
```

Avec Compose v1, remplacer `docker compose` par `docker-compose`. Ouvrir **http://localhost:3000**. Le mot de passe est la valeur `JARVIS_OWNER_PASSWORD` dans `.env`. Relancer `setup` sur une installation existante ajoute les secrets manquants sans modifier les mots de passe existants.

Le premier démarrage installe automatiquement Codex et Claude Code, chacun dans son image Docker dédiée. Pour installer aussi OpenCode dès le départ, définir `JARVIS_INITIAL_HARNESSES=codex,claude-code,opencode` dans `.env` avant le démarrage. Chaque installation apparaît dans les réglages et peut prendre plusieurs minutes. Sur une installation existante, `setup` conserve la sélection explicite de `.env` : ajouter `claude-code` à `JARVIS_INITIAL_HARNESSES` puis recréer le worker pour l’installer automatiquement. L’installation ne connecte aucun compte et ne change pas le profil par défaut.

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
| Claude Code | 2.1.296 | Abonnement Claude via le parcours officiel du CLI, ou clé API Anthropic (facturation API) |
| OpenCode | 1.18.35 | Clé API OpenAI ou Anthropic ; modèle au format `fournisseur/modèle` |

Le parcours ChatGPT requiert que la connexion par code d’appareil soit autorisée pour le compte. Les méthodes réellement disponibles restent soumises au fournisseur. Un catalogue de modèles n’atteste pas des droits : seul le test réel valide le profil. Les appels API utilisent la facturation du compte choisi. Aucun compte, jeton ou exécutable n’est importé depuis le serveur hôte.

L’interface reste accessible sans moteur connecté. Les clés se saisissent dans le formulaire dédié, jamais dans une conversation. Les clés Claude/OpenCode sont chiffrées dans le volume de compte ; Codex et la connexion Claude par abonnement gèrent leurs caches natifs protégés dans leurs volumes dédiés. Conserver les volumes **et** `JARVIS_VAULT_KEY` pour restaurer les connexions. Ne pas remplacer cette clé sans migration des secrets. Une session révoquée chez le fournisseur exige une nouvelle connexion.

### Connexion Claude avec abonnement

Dans le compte Claude Code, choisir **Se connecter avec mon abonnement Claude**, ouvrir le lien et autoriser Claude Code avec le compte Claude disposant de l’abonnement. Copier le code complet affiché par Claude dans **Code de connexion Claude**, puis **Valider le code Claude**. Cliquer sur **Vérifier la connexion** : le mode actif doit être **abonnement Claude**. Créer un profil (par exemple modèle `sonnet`), puis le tester avant toute affectation.

La connexion est lancée par `claude auth login --claudeai` dans le conteneur du compte ; le CLI vérifie lui-même le retour OAuth. Aucun jeton de l’hôte n’est importé. Le code passe uniquement par un formulaire authentifié avec CSRF, lié à une session de connexion de dix minutes. Le CLI doit confirmer `authMethod=claude.ai` avant activation. En mode abonnement, aucun `ANTHROPIC_API_KEY` n’est transmis à l’inférence et aucun repli automatique sur la facturation API n’est effectué. Changer de mode invalide les profils précédemment testés. Le CLI gère le renouvellement de son cache natif ; une session révoquée nécessite une reconnexion. [Authentification officielle Claude Code](https://code.claude.com/docs/en/authentication).

Cette évolution utilise la recette Claude `2.1.296-v3` (les autres harnesses gardent leur recette). Pour mettre à jour une installation existante, reconstruire l’app et le superviseur, demander l’installation Claude via l’API, puis recréer les conteneurs de comptes Claude **après la fin de leurs missions**, en conservant leurs volumes `/home/node` et la clé du coffre. Le superviseur refuse d’utiliser silencieusement un ancien conteneur avec la nouvelle image.

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
- Les outils natifs des modèles restent désactivés. Jarvis peut créer et appeler des spécialistes via des actions structurées validées ; les spécialistes ordinaires ne peuvent pas déléguer à leur tour. Les missions de développement explicitement activées utilisent un service d’outils isolé, séparé des comptes.
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

L’installation des trois images, le parcours navigateur et les contrats de protocole sont vérifiés. La conversation, la création et la délégation ont été validées avec le compte Codex réel du propriétaire. Les autres fonctions prévues sont détaillées dans [specs](specs/README.md), avec [l’état exact de l’implémentation](specs/10-etat-implementation.md).

## Créer un spécialiste et lui confier une tâche

Dans le chat, demander par exemple :

> Crée un agent Analyste dans le département Produit, puis demande-lui de rédiger cinq critères d’acceptation pour une recherche dans l’historique des conversations.

Jarvis crée la fiche, appelle le spécialiste et restitue son résultat. L’écran **Organisation** permet aussi de créer une fiche, modifier ses instructions et son profil, puis consulter ses versions. Un département absent est créé avec la fiche. L’absence de profil explicite signifie l’héritage du défaut global, même si Jarvis a son propre profil.

Le suivi de mission expose les agents appelés et leurs résultats, y compris après rechargement. Sur mobile, ouvrir **Voir les étapes**. Le bouton d’arrêt concerne également le spécialiste en cours. Les créations déjà terminées sont conservées après annulation.

Limites initiales par mission : 8 appels au modèle, 6 tours de décision, 3 créations, 3 délégations et 15 minutes. Chaque appel est limité à 5 minutes, attente du compte comprise. Ces bornes limitent le travail ; elles ne mesurent pas la facture ou les tokens. Les appels partageant un compte sont exécutés successivement.


## Préparer une modification de Jarvis

Construire l’environnement depuis le code de la version que l’on souhaite modifier :

```bash
docker compose --profile tools build development-image
docker compose --profile app up --build -d
```

Dans le chat, cocher **Développer Jarvis pour ce message**, puis demander par exemple :

> Ajoute dans README.md une explication concise du fonctionnement des départements. Prépare la modification et fais-la relire.

Jarvis choisit un développeur et un reviewer distincts dans le registre. Leurs profils configurés sont utilisés ; sans choix explicite ils héritent du défaut global. L’agent développeur dispose de lecture, liste, écriture et suppression de fichiers ainsi que d’un terminal avec Git, GitHub CLI, Node et npm. Le harness reste connecté uniquement dans son conteneur de compte : les outils sont appelés par décisions structurées validées par Jarvis, pas par un shell dans le conteneur qui contient les identifiants.

Sans dépôt GitHub configuré, le code de référence est inclus dans l’image de développement. Avec GitHub configuré, chaque mission part d’un commit distant figé ; le lockfile doit correspondre aux dépendances approuvées de l’image. Chaque mission travaille sur un volume séparé et une branche locale. Aucun montage du dépôt hôte, aucun secret, aucun réseau ni socket Docker n’est donné aux outils. Les dépendances existantes sont disponibles depuis l’image. Le terminal reste sans connexion GitHub. Un service séparé gère la connexion du propriétaire, la copie distante et les PR. Les nouvelles dépendances et le navigateur automatisé dans la sandbox restent à intégrer.

Le résultat comprend le diff téléchargeable, son SHA-256, les vérifications TypeScript/tests unitaires de référence et une revue indépendante. Le validateur travaille sur une copie figée et restaure les tests unitaires et la configuration TypeScript de référence ; il n’utilise pas une commande de test inventée par le développeur. Il ne remplace pas les tests d’intégration, E2E et de sécurité nécessaires avant publication. Une proposition issue de GitHub peut créer une branche et une PR en brouillon via le bouton dédié. Aucun patch n’est appliqué au serveur, fusionné ou déployé.

Bornes : une modification par mission, 20 tours du développeur, 32 appels au modèle au total, 30 minutes ; 5 minutes par appel, 90 secondes par commande. Le patch est limité à 20 fichiers et 100 000 caractères ; au-delà de 42 000 caractères, il reste téléchargeable mais la revue automatique est refusée. Les opérations et annulations sont idempotentes ; un résultat d’outil inconnu n’est pas rejoué aveuglément. Les journaux et volumes de travail sont conservés pour diagnostic. Voir [les détails et limites](specs/11-outils-developpement.md).

## Dicter un message

Cliquer sur le micro dans le chat, autoriser le microphone, parler puis cliquer
sur **Terminer la dictée**. Le texte apparaît dans le brouillon : corriger si
nécessaire, puis envoyer. **Annuler la dictée** abandonne l'enregistrement.
Limites : 60 secondes et 2 Mo, langue française. Sur iPhone, utiliser HTTPS et
laisser la PWA au premier plan ; sur ordinateur, localhost est accepté.

Le profil Docker `app` démarre son propre Speaches (faster-whisper-small, CPU
int8). Aucun compte ni clé API nécessaire. Le premier démarrage télécharge le
modèle (~0,5 Go) et affiche « Préparation du moteur vocal ». Les enregistrements
ne sont pas conservés. Le texte transcrit suit ensuite le fonctionnement normal
du brouillon puis des messages. La réponse audio (TTS) n'est pas encore incluse.
Configuration, développement local et compatibilité Docker :
[spécification STT](specs/16-voice-stt.md).

## Connecter GitHub et préparer une pull request

Dans **Réglages → GitHub · Développement**, cliquer sur **Se connecter à GitHub
dans le navigateur**, ouvrir le lien officiel, saisir le code puis autoriser
GitHub CLI. Vérifier et enregistrer **rl-safeyes/jarvis**, branche **main**.

Les nouvelles missions de développement figent un commit distant. Après tests
réussis, revue favorable et fin de mission, cliquer sur **Créer une pull request
en brouillon**. Jarvis crée une branche dédiée et conserve le lien vers la PR.
Aucune fusion ni aucun déploiement. Si la branche de départ a changé, lancer une
nouvelle mission. Les anciennes propositions locales restent téléchargeables.

Les commits locaux non poussés ne sont pas présents sur GitHub. Publier la version
courante sur la branche choisie et reconstruire l’image de développement pour que
la source distante, les dépendances et les tests de référence soient cohérents.
La connexion GitHub reste dans un conteneur dédié ; les agents n’ont pas le jeton.
Voir [la spécification GitHub](specs/17-github-pull-requests.md) pour la reprise,
les limites et le déploiement.
