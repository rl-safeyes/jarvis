# Modèle de données et contrats API

PostgreSQL métier stocke les conversations, définitions et résultats. Temporal possède l’état d’exécution des workflows. L’API expose des projections cohérentes avec leur historique ; elle n’exécute pas directement les commandes des agents.

## Entités principales

| Entité | Champs et contraintes essentiels |
| --- | --- |
| `users`, `spaces`, `memberships` | Identité, propriétaire et appartenance ; toutes les données sont rattachées à un espace |
| `devices`, `sessions` | Appareil, clé publique éventuelle, session expirante et révocation |
| `conversations`, `messages` | Auteur, contenu, pièces jointes et `client_message_id` unique par conversation |
| `departments` | Domaine, politique, budget et état actif |
| `agent_definitions`, `agent_versions` | Identité logique, version immuable, manifeste, hash et état d’évaluation |
| `tool_versions` | Contrats, capacités, artefact exécutable, version et permissions |
| `harness_packages` | Identifiant extensible, versions, recette/image et digest, adaptateur, capacités et méthodes de connexion qualifiées |
| `harness_installations` | Package/version actif, état d’installation, révision, profil de référence facultatif `preferred_execution_profile_id` |
| `harness_operations` | Installation/mise à jour/retrait, clé d’idempotence, cible, étapes, état, erreur et workflow |
| `account_profiles` | Harness, fournisseur, référence de secret, mode de facturation et état ; aucune valeur de secret dans le manifeste |
| `auth_transactions` | Propriétaire, compte cible, méthode, état, expiration et référence privée du challenge |
| `execution_profiles`, `execution_profile_versions` | Profil nommé, version immuable, installation, compte, sélection de modèle, limites et compatibilité |
| `space_runtime_settings` | `default_execution_profile_id`, révision pour concurrence optimiste et historique des modifications |
| `missions`, `tasks` | Objectif, DAG de dépendances, versions de politiques et critères de réussite |
| `runs` | Tentative, version agent, profil/version résolu, origine `default` ou `agent`, révision du défaut éventuelle, versions harness/adaptateur, compte, modèle réel, session native, workspace et checkpoint |
| `events` | `event_id`, `mission_id`, séquence, type, version de schéma et charge utile filtrée |
| `artifacts` | Objet stocké, taille, type MIME, hash, propriétaire et durée de conservation |
| `approvals` | Action, hash du contenu approuvé, identité, expiration et décision |
| `capability_grants` | Sujet, action, ressource, contraintes, mission et expiration |
| `budget_reservations`, `usage_entries` | Réservations atomiques, consommation mesurée ou estimée, rapprochement |
| `action_ledger` | Action idempotente, état, identifiant distant et preuve de résultat |
| `change_requests`, `releases` | Commit, digest, rapports, risque et état de déploiement |
| `memory_entries` | Source, portée, contenu, statut confirmé ou proposé, expiration |
| `outbox` | Commandes à transmettre après commit, identifiant stable et acquittement |

Les tokens fournisseurs ne sont pas des champs de conversation ou d’événement. La base stocke des références vers des secrets, pas leur valeur en clair.

## Relations

```mermaid
erDiagram
    SPACE ||--o{ DEPARTMENT : organise
    DEPARTMENT ||--o{ AGENT : contient
    AGENT ||--|{ AGENT_VERSION : versionne
    SPACE ||--o{ CONVERSATION : contient
    CONVERSATION ||--o{ MISSION : declenche
    MISSION ||--o{ TASK : decompose
    TASK ||--o{ RUN : execute
    AGENT_VERSION ||--o{ RUN : definit
    ACCOUNT_PROFILE ||--o{ RUN : authentifie
    RUN ||--o{ ARTIFACT : produit
    MISSION ||--o{ APPROVAL : demande
    CHANGE_REQUEST ||--o{ RELEASE : publie
```

Les clés étrangères et contrôles d’accès empêchent une référence inter-espace. `agent_version_id`, `policy_version` et le commit de travail sont figés au démarrage d’un run. Les sorties volumineuses vont dans les artefacts ; les événements en contiennent les références.

## États d’exécution

Une mission évolue entre `queued`, `planning`, `running`, `waiting_input`, `waiting_approval`, `waiting_quota`, `paused`, `cancel_requested`, puis `succeeded`, `failed` ou `cancelled`. Les tâches portent également `blocked` lorsqu’une dépendance manque. Un résultat partiel est un attribut des livrables, pas une réussite implicite.

Une reprise crée une nouvelle tentative de run, liée à la précédente. Si le processus existe encore, le superviseur se rattache à lui ; sinon il reprend une session supportée ou repart du checkpoint. Une action externe ambiguë est inscrite `outcome_unknown` dans le registre des actions et bloque ses dépendants jusqu’à réconciliation.

L’annulation refuse toute nouvelle sous-tâche, retire les autorisations temporaires, interrompt les harnesses puis vérifie l’arrêt des descendants. Les effets déjà réalisés sont signalés. Annuler n’équivaut pas à inverser automatiquement un changement externe.

## API proposée

Tous les chemins ci-dessous sont des contrats Jarvis à implémenter, indépendants des API fournisseurs. Préfixe `/api/v1`, HTTPS, session utilisateur et contrôle d’accès par espace. Les mutations acceptent une clé d’idempotence ; réutiliser une clé avec un corps différent renvoie un conflit.

| Méthode et chemin | Résultat |
| --- | --- |
| `POST /conversations` | Conversation créée |
| `POST /conversations/:id/messages` | Message persisté et mission acceptée avec HTTP 202 |
| `GET /missions/:id` | État, plan, coût connu, attentes et livrables |
| `GET /missions/:id/events` | SSE avec reprise par `Last-Event-ID` |
| `POST /missions/:id/commands` | `pause`, `resume` ou `cancel`, avec contrôle de version |
| `POST /approvals/:id/decision` | Décision liée au hash de l’action et à sa version |
| `GET /departments`, `GET /agents` | Catalogue autorisé |
| `POST /agents/proposals` | Brouillon validé puis workflow d’évaluation |
| `GET /harnesses` | Catalogue, installations, versions et capacités qualifiées |
| `POST /harness-installations` | Installation d’un package sélectionné, HTTP 202 avec opération persistante |
| `POST /harness-installations/:id/commands` | Mise à jour, désactivation ou retrait avec contrôle des références |
| `GET /harness-operations/:id` | Étapes, état et diagnostic filtré de l’opération |
| `POST /accounts` | Profil de compte nommé lié à un harness |
| `POST /accounts/:id/connect` | Transaction de connexion liée au propriétaire, méthode supportée et expiration |
| `GET /auth-transactions/:id` | État et action de connexion réservés au propriétaire, sans cache ni journalisation de secrets |
| `POST /auth-transactions/:id/complete` | Soumission dédiée ou retour de connexion vérifié selon protocole, jamais via le chat |
| `POST /accounts/:id/disconnect` | Révocation locale et arrêt selon politique, révocation fournisseur si disponible |
| `POST /execution-profiles`, `GET /execution-profiles` | Création et liste des profils harness/compte/modèle |
| `PATCH /execution-profiles/:id` | Nouvelle version de profil, révision attendue et requalification |
| `POST /execution-profiles/:id/test` | Test réel borné, résultat persistant et statut de compatibilité |
| `DELETE /execution-profiles/:id` | Retrait refusé tant que le profil est référencé |
| `PATCH /harness-installations/:id` | Profil de référence du harness, validation et révision attendue |
| `GET /runtime-settings`, `PATCH /runtime-settings` | Lecture/changement du défaut global avec révision attendue |
| `POST /agents/:id/versions` | Nouvelle version des instructions et de la sélection d’exécution, évaluation avant activation |
| `GET /agents/:id/runtime` | Choix configuré, choix effectif, origine de l’héritage et blocages, Jarvis inclus |
| `GET /accounts/:id/status` | Authentification, modèle testé et quotas disponibles |
| `POST /uploads` | Téléversement borné, type contrôlé et identifiant d’artefact |
| `POST /voice/transcriptions` | Transcription d’un artefact audio autorisé |
| `POST /voice/speech` | Synthèse d’une réponse visible par le demandeur |
| `GET /changes`, `GET /releases` | Évolutions et preuves de validation |
| `POST /control/freeze` | Gel des nouvelles exécutions et publications |

Exemple de message :

```json
{
  "client_message_id": "msg-device-001",
  "text": "Ajoute un import de dépenses CSV",
  "attachment_ids": ["artifact-demo-csv"],
  "expected_conversation_version": 4
}
```

Exemple d’événement persistant :

```json
{
  "schema_version": 1,
  "event_id": "evt-1042",
  "mission_id": "mission-42",
  "sequence": 17,
  "type": "task.completed",
  "occurred_at": "2026-10-10T10:00:00Z",
  "payload": {
    "task_id": "task-review",
    "artifact_ids": ["artifact-review-report"]
  }
}
```

Les exemples d’identifiants sont illustratifs. En implémentation, utiliser des identifiants opaques globalement uniques, avec validation stricte.

## Cohérence des flux

La séquence est monotone par mission. Le client déduplique par `event_id` et recharge un snapshot si son curseur a expiré. Les textes partiels peuvent être regroupés pour limiter les écritures ; les transitions métier et résultats terminaux sont persistés avant diffusion. Le client ne déduit jamais la réussite de la simple fermeture du flux.

Les cookies de session sont `HttpOnly`, `Secure` et avec politique `SameSite` adaptée. Les mutations ont une protection CSRF et les origines sont limitées. L’accès aux pièces jointes est vérifié à chaque téléchargement ; aucun chemin de fichier brut fourni par le client n’est interprété comme une autorisation.

## Résolution et mutations de configuration

Une mutation du défaut, d’un profil ou d’une sélection d’agent contrôle sa révision (`expected_revision`) et renvoie un conflit en cas de concurrence. L’activation d’une version d’agent porte sur son hash évalué. Le champ `runtime.execution` du manifeste v2 est la source structurée pour choisir un profil ; l’absence et le mode `inherit` renvoient au défaut de l’espace. Le compte, l’installation et le modèle du profil doivent être compatibles et autorisés dans cet espace.

Au lancement, la résolution et la réservation capturent atomiquement les versions exactes dans le run. Une modification concurrente ne peut pas produire un mélange ancien compte/nouveau modèle. L’état du compte et les droits sont recontrôlés lors d’une reprise. Une sélection indisponible produit un blocage explicite et un lien de réparation ; l’API ne remplace jamais tacitement le harness.

Les commandes de conversation utilisent ces mêmes services et contrôles que les réglages PWA. Une opération de connexion conserve ses informations sensibles dans un canal authentifié réservé au propriétaire ; les événements de mission n’exposent que son identifiant et son état. Les opérations d’installation et tests sont persistés avant lancement via l’outbox, comme les autres effets externes.
