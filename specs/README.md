# Architecture et implémentation de Jarvis

Jarvis est un assistant personnel accessible par texte et par voix depuis une PWA sur iPhone, Linux et macOS. Un serveur central conserve les conversations, orchestre des agents spécialisés organisés en départements et permet au logiciel de développer ses propres extensions.

La proposition repose sur un **noyau de contrôle déterministe**, des **agents configurables et versionnés**, et des **environnements d’exécution isolés** utilisant Codex, Claude Code ou OpenCode. Les changements à faible risque peuvent être déployés automatiquement ; les autres demandent une validation humaine sur une version précise et testée.

Statut : spécifications cibles, complétées avec la gestion des harnesses et leur distribution Docker. Le code comprend le socle, un gestionnaire de harnesses Docker la création/délégation d’agents et la préparation de patches dans une copie isolée ; voir [l’état d’implémentation](10-etat-implementation.md) pour distinguer la cible du code livré.

## Décisions de départ

| Sujet | Décision |
| --- | --- |
| Appareils confirmés | iPhone, ordinateurs Linux et macOS |
| Interface | PWA responsive ; voix par bouton au premier lancement |
| Hébergement | Serveur dédié existant, sans dépendance à sa configuration actuelle |
| Autonomie confirmée | Déploiement automatique à faible risque, validation humaine au-delà |
| Organisation | Jarvis pilote des agents répartis en départements |
| Moteurs | Un ou plusieurs harnesses initiaux fournis par Docker Jarvis ; ajout et connexion ultérieurs depuis Jarvis |
| Routage | Profil par défaut de l’espace ; choix explicite facultatif pour chaque agent, Jarvis inclus |
| Configuration | Assistant PWA sans IA au démarrage ; demandes en conversation pour installer, connecter et affecter un harness |
| Hypothèse produit | Usage personnel avec un propriétaire ; espace et droits prévus pour une extension future |
| Technologies proposées | TypeScript, React, Fastify, PostgreSQL, Temporal et workers isolés |

Le choix d’un harness ne fixe ni le rôle de l’agent ni son modèle. Un développeur et un reviewer peuvent employer des moteurs différents, tout en partageant les mêmes contrats Jarvis.

## Lecture

| Document | Contenu |
| --- | --- |
| [Périmètre et expérience](01-produit.md) | Parcours, PWA, voix, écrans et limites de la première version |
| [Architecture](02-architecture.md) | Composants, schémas, orchestration durable et circulation des données |
| [Agents et départements](03-agents.md) | Catalogue, création autonome, délégation, mémoire et budgets |
| [Harnesses et comptes](04-harnesses.md) | Installation Docker, connexion guidée, défaut, choix par agent, sessions et contrat commun |
| [Auto amélioration](05-auto-amelioration.md) | Développement, review, classement du risque, déploiement et retour arrière |
| [Données et API](06-donnees-api.md) | Entités, états, endpoints et événements |
| [Déploiement et exploitation](07-exploitation.md) | Isolation, secrets, supervision, sauvegardes et dimensionnement |
| [Plan de réalisation](08-implementation.md) | Structure du projet, lots, critères de recette et estimations |
| [Décisions et sources](09-decisions-sources.md) | Arbitrages, questions restantes et documentation officielle |
| [État livré](10-etat-implementation.md) | Fonctions vérifiées et limites présentes |
| [Outils de développement](11-outils-developpement.md) | Copie isolée, terminal/Git, patch, tests et revue |
| [Exemples](examples/) | Schéma de manifeste, agent développeur et interface TypeScript des adaptateurs |

## Premier scénario de démonstration

Depuis l’iPhone : « Jarvis, ajoute une fonction de suivi de mes dépenses à partir d’un CSV. » Jarvis réutilise ou crée un agent de traitement de données, fait développer l’extension dans un environnement isolé, obtient une review et des tests, puis présente une prévisualisation. Si le changement respecte la politique de faible risque, il le déploie et reprend la demande initiale avec la nouvelle fonction. Sinon, il attend l’accord du propriétaire. Le téléphone peut être fermé pendant ce travail ; l’exécution continue sur le serveur.

## Priorité de construction

Valider d’abord un harness fourni par Docker Jarvis et sa connexion depuis la PWA sans IA préexistante, puis livrer une chaîne verticale : choix du défaut → message PWA → Jarvis → agent développeur → résultat persistant. Les harnesses supplémentaires se qualifient au fur et à mesure de leur intégration. Ajouter ensuite la reprise après panne, la création d’agents, la voix et le cycle d’évolution. Les agents n’obtiennent les droits de déploiement qu’après validation du pipeline et du retour arrière.

- [Dictée vocale STT](16-voice-stt.md)
- [GitHub et pull requests](17-github-pull-requests.md)
