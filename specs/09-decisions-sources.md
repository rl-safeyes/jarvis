# Décisions ouvertes et références

Les choix ci-dessous évitent de lier Jarvis à un seul fournisseur ou au serveur actuel. Les capacités exactes des comptes et des versions sont vérifiées au lot 0.

## Arbitrages proposés

| Décision | Alternative | Raison du choix |
| --- | --- | --- |
| PWA initiale | Applications natives séparées | Couvrir iPhone Linux et Mac avec une interface commune |
| TypeScript et modules partagés | API Python et client TypeScript | Réduire les frontières de types ; Python reste possible pour un outil spécialisé |
| Temporal | Queue et machine à états maison sur PostgreSQL | Les reprises, attentes et publications longues sont centrales au produit ; accepter un service supplémentaire |
| PostgreSQL et stockage local abstrait | Ensemble de bases spécialisées | Simplifier l’installation et la restauration |
| Agents déclaratifs | Code nouveau pour chaque rôle | Créer un spécialiste sans redéployer l’application |
| Adaptateurs de harness | Un framework unique imposé partout | Respecter les comptes configurés et permettre plusieurs moteurs |
| Extensions isolées | Modification directe du noyau pour toute capacité | Délimiter les droits et le retour arrière |
| Déploiement selon règles de risque | Validation humaine de tout changement | Appliquer l’autonomie choisie par le propriétaire |

Temporal ajoute un coût d’exploitation réel. Si ce coût s’avère disproportionné au prototype, une machine à états transactionnelle PostgreSQL peut remplacer le moteur, à condition de conserver les contrats de reprise, timers, annulation et idempotence. Cette alternative demande un arbitrage explicite ; elle ne consiste pas à garder les tâches uniquement en mémoire.

## Points confirmés

Le propriétaire utilise un iPhone et des ordinateurs Linux et macOS. Une PWA lui convient. Il dispose d’un serveur dont les caractéristiques ne doivent pas contraindre l’architecture. Il souhaite un déploiement autonome à faible risque et une validation humaine pour le reste.

## Questions avant construction

| Information | Pourquoi elle compte | Hypothèse en attendant |
| --- | --- | --- |
| Comptes et abonnements Codex Claude OpenCode disponibles | Éligibilité et modes d’authentification | Qualifier chaque compte sans promettre la portabilité des abonnements |
| Budget API et audio mensuel | Plafonds et bascules payantes | Aucun recours payant supplémentaire implicite |
| Usage exclusivement personnel ou futur partage | Isolation des espaces et connexion fournisseurs | Un propriétaire, un espace |
| Données acceptables chez des fournisseurs externes | Routage et options locales | Consentement de configuration par catégorie et fournisseur |
| Trois premiers usages hors développement de Jarvis | Choix des premières extensions et jeux d’évaluation | Commencer par import de fichier et production de rapport |
| Besoin immédiat d’agir sur les postes | Nécessité du compagnon local | PWA seule au premier jalon |
| Domaine et mode d’accès au serveur | HTTPS authentification et exploitation | Déploiement portable, choix au lot d’installation |

Ces points ne bloquent pas la présente proposition. Ils doivent être réglés avant les décisions techniques ou dépenses qui en dépendent.

## Documentation officielle

Références consultées le 10 octobre 2026. Les liens proches des affirmations dans les autres documents précisent leur portée. Les architectures, seuils, estimations de charge et règles Jarvis sont des propositions, pas des garanties fournisseurs.

| Source | Sujet |
| --- | --- |
| [Codex SDK](https://learn.chatgpt.com/docs/codex-sdk) | Automatisation et sessions |
| [Codex App Server](https://learn.chatgpt.com/docs/app-server) | Protocole événements et permissions |
| [Authentification Codex](https://learn.chatgpt.com/docs/auth) | Connexion compte et serveur sans navigateur |
| [Claude Code programmatique](https://code.claude.com/docs/en/headless) | Mode CLI et sorties structurées |
| [Claude Agent SDK](https://code.claude.com/docs/en/agent-sdk/overview) | Boucle d’agent programmable |
| [Quickstart du SDK Claude](https://code.claude.com/docs/en/agent-sdk/quickstart) | Modes d’authentification et restrictions d’intégration |
| [Authentification Claude Code](https://code.claude.com/docs/en/authentication) | Profils abonnement et API |
| [OpenCode Server](https://opencode.ai/docs/server/) | API HTTP et événements |
| [OpenCode SDK](https://opencode.ai/docs/sdk/) | Intégration TypeScript |
| [Fournisseurs OpenCode](https://opencode.ai/docs/providers/) | Connexions des fournisseurs |
| [Temporal Workflows](https://docs.temporal.io/workflows) | Exécution durable |
| [Temporal Activities](https://docs.temporal.io/activities) | Activités et effets de bord |
| [Installation des PWA](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Installing) | Distribution par navigateur |
| [Microphone navigateur](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia) | Capture et permissions |
| [Docker rootless](https://docs.docker.com/engine/security/rootless/) | Exécution avec privilèges réduits |
