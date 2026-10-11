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
    harness-manager/        Catalogue, installation, connexions et profils
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
| 0 | Qualifier le premier harness et les recettes Docker ; inventorier les modes des autres | Serveur sans CLI : runtime fourni par Jarvis, connexion PWA, résultat, interruption, reprise et refus d’outil | À réestimer |
| 1 | Authentification Jarvis, PWA, base, assistant de connexion, profils, défaut et premier adaptateur | Premier compte connecté sans IA préexistante, choix de Jarvis visible, message réel sans doublon entre appareils | À réestimer |
| 2 | Temporal, superviseur, isolement, événements et budgets | Mission survivant au redémarrage d’un service, annulation effective, plafond respecté | 6 à 10 jours |
| 3 | Départements, agents versionnés, création, mémoire et affectation de harness | Agent héritant du défaut, choix explicite par modification de fiche/prompt, évaluation et refus d’élévation de droits | À réestimer |
| 4 | Ajout de harness par Jarvis, connexions multiples, autres adaptateurs et voix | Installation et connexion d’un second moteur depuis la PWA/chat, choix du défaut, demande orale depuis iPhone | À réestimer |
| 5 | Extensions, développeur, review, runner de tests et préproduction | Jarvis réalise une fonctionnalité et fournit une prévisualisation avec preuves | 8 à 12 jours |
| 6 | Classement du risque, release automatique et rollback | Changement faible risque publié ; changement sensible bloqué ; régression restaurée | 6 à 10 jours |
| 7 | Restauration, supervision, stabilité et documentation | Installation neuve puis restauration contrôlée et recette des parcours critiques | 4 à 6 jours |

L’estimation initiale de 42 à 67 jours ne couvrait pas tout le parcours de gestion des harnesses demandé. Elle doit être recalculée après qualification du premier parcours de connexion et des images Docker ; les lignes « À réestimer » ne sont pas incluses dans un nouveau total. Les restrictions de comptes et la robustesse du cycle autonome restent des facteurs d’incertitude. L’assistance d’agents ne supprime pas la qualification et l’exploitation.

Les lots 0 à 4 forment le premier assistant utilisable. Les lots 5 et 6 apportent l’auto amélioration demandée. Le compagnon desktop, la voix continue, les notifications push et les modèles locaux viennent ensuite. Une recette minimale accompagne chaque lot ; le lot 7 approfondit la reprise et l’exploitation.

## Ordre d’implémentation du premier parcours

1. Qualifier et épingler un premier harness, son adaptateur et son image Docker ; le livrer dans le déploiement sans dépendance aux CLI de l’hôte.
2. Créer les contrats et migrations de packages, installations, comptes, profils, défaut et manifestes v2 ; conserver le simulateur pour les tests.
3. Installer Temporal, l’outbox et le superviseur avant les exécutions réelles et installations ayant des effets externes.
4. Construire l’assistant PWA sans IA : connexion, test borné, choix du défaut, récupération et affichage du choix effectif de Jarvis.
5. Exécuter un premier chat réel sans shell, persistant et synchronisé entre appareils.
6. Ajouter les commandes conversationnelles de configuration, l’installation d’un second harness connu et l’affectation/héritage des agents versionnés.
7. Introduire les tâches de développement isolées avec artefacts, vérification indépendante et intégration de nouveaux adaptateurs via le cycle d’évolution.

Le premier adaptateur réel peut être Codex si son compte est disponible. Le lot 0 peut faire retenir un autre moteur sans changer les contrats métier.

## Recette prioritaire

| Scénario | Résultat attendu |
| --- | --- |
| Serveur vierge sans CLI de harness | Runtime fourni par Docker Jarvis et connexion par la PWA sans modèle préconnecté |
| Demande d’installation d’un harness connu | Installation suivie, connexion guidée, test et profil prêt, défaut conservé |
| Agent sans sélection explicite | Utilisation du défaut de l’espace même si Jarvis a un choix spécifique |
| Modification du prompt pour changer de harness | Nouvelle version cohérente de la fiche et sélection structurée évaluée |
| Changement de défaut pendant un run | Nouveaux runs héritiers modifiés, run existant et agents explicites inchangés |
| Tous les comptes déconnectés | Réglages et reconnexion accessibles sans réponse IA |
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

La recette complète inclut les critères de [gestion des harnesses](04-harnesses.md#recette-de-la-gestion-des-harnesses), notamment le démarrage sans CLI sur l’hôte, les comptes multiples, les ajouts ultérieurs et la récupération sans moteur disponible.
