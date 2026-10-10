# État du premier jalon

Date : 10 octobre 2026. Cette première tranche livre un parcours complet avec simulateur. Elle constitue une base du lot 1 et du contrat d’adaptateurs, sans revendiquer l’achèvement de la qualification des harnesses du lot 0.

## Réalisé

| Domaine | État |
| --- | --- |
| Workspace | TypeScript, React, Vite, Fastify et paquets partagés |
| Accès | Un propriétaire, mot de passe local, sessions persistantes de 8 heures, limitation des tentatives, cookie HttpOnly et CSRF |
| Conversations | Création et envoi idempotents, contrôle de version, historique partagé via PostgreSQL |
| Missions | Simulation, événements persistés, flux SSE avec reprise par curseur, annulation et résultat |
| Reprise | Bail d’exécution de 15 secondes, exclusion des anciens workers, maximum de 3 tentatives |
| Catalogue | Quatre départements et quatre profils initiaux ; spécialistes signalés comme prévus |
| PWA | Interface responsive, manifeste, icônes, page hors connexion et brouillon local |
| Exploitation locale | Compose, image applicative, migrations transactionnelles et script de configuration |
| Vérification | Tests de contrats, de transactions et de parcours navigateur ; CI définie |

## Écarts temporaires explicites

Temporal n’est pas encore installé. Une petite file persistante PostgreSQL sert uniquement au simulateur sans effets de bord. Elle n’est pas le moteur retenu pour les harnesses réels et ne doit pas être étendue aux commandes ou actions externes. Le worker vérifie cette restriction au démarrage.

Le contrat exécutable dans `packages/harness-core` est un sous-ensemble de la cible : il couvre une exécution, des événements et l’interruption. Les comptes, permissions interactives et sessions natives seront ajoutés avec le premier harness qualifié.

La base correspond à un propriétaire unique. Les espaces, utilisateurs multiples, budgets, outils, approbations et releases ne sont pas encore implémentés. Le catalogue est fourni par le code et ne permet pas encore la création dynamique d’agents.

Le service worker ne conserve que la page hors connexion. L’interface complète exige le serveur ; aucune mission n’est envoyée silencieusement hors ligne. Une demande dont la réponse réseau est perdue conserve son identifiant pour une nouvelle tentative sans duplication.

L’accès navigateur mobile est vérifié par émulation Chromium. Safari sur macOS et un iPhone réel, l’installation native de la PWA, la voix et les notifications restent à qualifier.

## Vérifications et limites

Les vérifications couvrent la compilation TypeScript, la construction Vite, les requêtes concurrentes identiques, les conflits d’identifiants, le contrôle de version, les baux expirés, la protection contre un ancien worker, l’annulation, la limite de reprises, l’authentification, le CSRF, la déconnexion et la reprise du flux SSE.

Les parcours navigateur couvrent la connexion, l’envoi, le résultat simulé, la persistance après rechargement, l’arrêt d’une mission, le catalogue et l’absence de débordement horizontal en format mobile. Aucun appel à un fournisseur IA n’est effectué.

## Suite prioritaire

1. Qualifier un compte et un mode d’authentification réels sur le serveur cible.
2. Étendre le contrat de harness et vérifier les capacités de permission et d’interruption.
3. Installer Temporal avec outbox et projections avant les jobs ayant des effets externes.
4. Construire le superviseur d’environnements isolés et les capacités limitées par mission.
5. Activer les agents spécialistes, puis la création de profils et leurs évaluations.
