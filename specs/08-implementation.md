# Plan de réalisation

Construire une tranche complète utilisable avant d’automatiser le développement de Jarvis. Les dépendances entre lots sont explicites et chaque lot produit une démonstration vérifiable.

## Structure du dépôt proposée

```text
jarvis/
  apps/
    web/                    PWA React
    api/                    API Fastify
    workflow-worker/        Workflows et activités Temporal
    runner-supervisor/      Gestion des environnements d’exécution
    release-controller/     Publication et retour arrière
    desktop-companion/      Phase ultérieure Linux et macOS
  packages/
    contracts/              Schémas et types partagés
    domain/                 Règles métier
    policies/               Droits risques et budgets
    agent-registry/         Versions et évaluations
    harness-core/           Interface commune
    harness-codex/
    harness-claude/
    harness-opencode/
    tool-gateway/
    memory/
    storage/
    voice/
  agents/                   Manifestes initiaux
  extensions/               Outils isolés
  evaluations/              Cas de référence approuvés
  infra/                    Compose images et sauvegardes
  tests/                    Contrats intégration et parcours
  specs/                    Présente proposition
```

Un workspace TypeScript partage les contrats sans permettre aux workers d’importer les secrets ou l’administration de release. Les modules de politiques et les suites de référence ont des propriétaires de validation distincts du code généré.

## Lots et critères de sortie

| Lot | Travail | Démonstration attendue | Charge indicative |
| --- | --- | --- | --- |
| 0 | Qualifier comptes, versions et interfaces des trois harnesses | Sur serveur : authentification, résultat, interruption, reprise et refus d’outil par moteur | 3 à 5 jours |
| 1 | Authentification Jarvis, PWA texte, base, premier adaptateur | Message depuis iPhone, résultat visible sur Linux ou Mac, aucun doublon à la reconnexion | 5 à 8 jours |
| 2 | Temporal, superviseur, isolement, événements et budgets | Mission survivant au redémarrage d’un service, annulation effective, plafond respecté | 6 à 10 jours |
| 3 | Départements, agents versionnés, création et mémoire | Jarvis crée un spécialiste borné, l’évalue, le réutilise et refuse une élévation de droits | 5 à 8 jours |
| 4 | Compléter les adaptateurs et la voix | Missions sur les trois moteurs qualifiés ; demande orale en français depuis l’iPhone | 5 à 8 jours |
| 5 | Extensions, développeur, review, runner de tests et préproduction | Jarvis réalise une fonctionnalité et fournit une prévisualisation avec preuves | 8 à 12 jours |
| 6 | Classement du risque, release automatique et rollback | Changement faible risque publié ; changement sensible bloqué ; régression restaurée | 6 à 10 jours |
| 7 | Restauration, supervision, stabilité et documentation | Installation neuve puis restauration contrôlée et recette des parcours critiques | 4 à 6 jours |

Total indicatif : **42 à 67 jours de travail effectif** pour un développeur expérimenté, soit environ 9 à 14 semaines à temps plein avant aléas. Il s’agit d’un ordre de grandeur de planification, pas d’un engagement ; les restrictions de comptes et la robustesse du cycle autonome sont les principaux facteurs d’incertitude. L’assistance d’agents ne supprime pas la qualification et l’exploitation.

Les lots 0 à 4 forment le premier assistant utilisable. Les lots 5 et 6 apportent l’auto amélioration demandée. Le compagnon desktop, la voix continue, les notifications push et les modèles locaux viennent ensuite. Une recette minimale accompagne chaque lot ; le lot 7 approfondit la reprise et l’exploitation.

## Ordre d’implémentation du premier parcours

1. Épingler les versions après le lot 0 et créer les migrations de données.
2. Définir les schémas de message, mission, événement et manifeste.
3. Implémenter un adaptateur simulé pour rendre les scénarios de panne reproductibles.
4. Ajouter un compte réel qualifié et un agent sans shell pour le premier chat.
5. Relier PWA, API et stockage puis vérifier la synchronisation entre appareils.
6. Introduire une tâche de développement isolée avec artefact et vérification indépendante.
7. Déporter cette tâche dans un workflow durable avant toute exécution longue ou autonome.

Le premier adaptateur réel peut être Codex si son compte est disponible. Le lot 0 peut faire retenir un autre moteur sans changer les contrats métier.

## Recette prioritaire

| Scénario | Résultat attendu |
| --- | --- |
| Deux soumissions du même message | Une mission, deux accusés cohérents |
| Fermeture puis réouverture de la PWA | Mission poursuivie, historique et progression retrouvés |
| Crash du worker après effet externe | Réconciliation, aucune répétition aveugle |
| Compte expiré ou quota épuisé | Attente explicite, reconnexion ou repli autorisé |
| Création d’un agent demandant de nouveaux droits | Brouillon conservé, activation refusée sans autorisation |
| Budget parent atteint pendant une délégation | Arrêt des nouveaux enfants, résultat partiel persisté |
| Arrêt utilisateur | Descendants arrêtés, effets déjà accomplis signalés |
| Document contenant une demande de secrets | Aucun accès supplémentaire, trace de refus exploitable |
| Échec de test ou review défavorable | Aucune publication |
| Code modifié après approbation | Approbation invalidée |
| Extension à faible risque valide | Publication automatique et reprise de la demande |
| Modification du moteur de permissions | Validation humaine obligatoire |
| Nouvelle version défaillante | Retour à la version précédente sans perte des données compatibles |
| Restauration sur serveur vierge | Conversations, artefacts et workflows réconciliés |
| Micro refusé ou format audio non supporté | Explication utile et saisie texte toujours disponible |

Les tests de contrats utilisent d’abord les simulateurs. Un petit jeu de tests avec comptes réels vérifie chaque version de harness avant promotion, avec consommation bornée. Les secrets de production n’entrent pas dans les tests de pull request.

## Définition de la première version complète

Le propriétaire peut utiliser la PWA sur ses trois environnements, envoyer une demande textuelle ou orale, suivre une mission durable, faire créer un agent puis demander une extension. Cette extension est développée, revue et testée ; une évolution faible risque se publie automatiquement, une évolution sensible attend sa validation. Les comptes peuvent être révoqués, les budgets imposés et la version précédente restaurée.
