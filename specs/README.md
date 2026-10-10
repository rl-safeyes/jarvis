# Architecture et implémentation de Jarvis

Jarvis est un assistant personnel accessible par texte et par voix depuis une PWA sur iPhone, Linux et macOS. Un serveur central conserve les conversations, orchestre des agents spécialisés organisés en départements et permet au logiciel de développer ses propres extensions.

La proposition repose sur un **noyau de contrôle déterministe**, des **agents configurables et versionnés**, et des **environnements d’exécution isolés** utilisant Codex, Claude Code ou OpenCode. Les changements à faible risque peuvent être déployés automatiquement ; les autres demandent une validation humaine sur une version précise et testée.

Statut : proposition technique du 10 octobre 2026. Ce dossier définit le produit et son implémentation ; il ne contient pas une application déjà développée.

## Décisions de départ

| Sujet | Décision |
| --- | --- |
| Appareils confirmés | iPhone, ordinateurs Linux et macOS |
| Interface | PWA responsive ; voix par bouton au premier lancement |
| Hébergement | Serveur dédié existant, sans dépendance à sa configuration actuelle |
| Autonomie confirmée | Déploiement automatique à faible risque, validation humaine au-delà |
| Organisation | Jarvis pilote des agents répartis en départements |
| Moteurs | Adaptateurs pour Codex, Claude Code et OpenCode |
| Hypothèse produit | Usage personnel avec un propriétaire ; espace et droits prévus pour une extension future |
| Technologies proposées | TypeScript, React, Fastify, PostgreSQL, Temporal et workers isolés |

Le choix d’un harness ne fixe ni le rôle de l’agent ni son modèle. Un développeur et un reviewer peuvent employer des moteurs différents, tout en partageant les mêmes contrats Jarvis.

## Lecture

| Document | Contenu |
| --- | --- |
| [Périmètre et expérience](01-produit.md) | Parcours, PWA, voix, écrans et limites de la première version |
| [Architecture](02-architecture.md) | Composants, schémas, orchestration durable et circulation des données |
| [Agents et départements](03-agents.md) | Catalogue, création autonome, délégation, mémoire et budgets |
| [Harnesses et comptes](04-harnesses.md) | Intégrations, comptes, sessions, quotas et contrat commun |
| [Auto amélioration](05-auto-amelioration.md) | Développement, review, classement du risque, déploiement et retour arrière |
| [Données et API](06-donnees-api.md) | Entités, états, endpoints et événements |
| [Déploiement et exploitation](07-exploitation.md) | Isolation, secrets, supervision, sauvegardes et dimensionnement |
| [Plan de réalisation](08-implementation.md) | Structure du projet, lots, critères de recette et estimations |
| [Décisions et sources](09-decisions-sources.md) | Arbitrages, questions restantes et documentation officielle |
| [Exemples](examples/) | Schéma de manifeste, agent développeur et interface TypeScript des adaptateurs |

## Premier scénario de démonstration

Depuis l’iPhone : « Jarvis, ajoute une fonction de suivi de mes dépenses à partir d’un CSV. » Jarvis réutilise ou crée un agent de traitement de données, fait développer l’extension dans un environnement isolé, obtient une review et des tests, puis présente une prévisualisation. Si le changement respecte la politique de faible risque, il le déploie et reprend la demande initiale avec la nouvelle fonction. Sinon, il attend l’accord du propriétaire. Le téléphone peut être fermé pendant ce travail ; l’exécution continue sur le serveur.

## Priorité de construction

Valider d’abord une exécution réelle avec chacun des comptes ciblés, puis livrer une chaîne verticale : message PWA → Jarvis → agent développeur → résultat persistant. Ajouter ensuite la reprise après panne, la création d’agents, la voix et le cycle d’évolution. Les agents n’obtiennent les droits de déploiement qu’après validation du pipeline et du retour arrière.
