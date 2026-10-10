# Périmètre et expérience utilisateur

Jarvis fournit un point d’entrée unique pour demander un travail, suivre son avancement et récupérer son résultat. Les départements organisent les compétences sans imposer à l’utilisateur de choisir un agent avant de parler.

## Fonctionnalités attendues

| Capacité | Comportement |
| --- | --- |
| Conversation | Historique partagé, pièces jointes, réponses progressives et reprise sur un autre appareil |
| Missions | Plan, étapes, agents mobilisés, statut, durée, consommation et livrables |
| Création d’agents | Création d’un spécialiste lorsqu’une compétence manque ; évaluation avant activation |
| Départements | Catalogue par domaine, budgets, outils autorisés et règles de confidentialité |
| Comptes | Connexion des moteurs, état des sessions, quotas connus et reconnexion |
| Auto amélioration | Proposition et implémentation d’une extension, tests, review, publication selon son risque |
| Contrôle | Suspension, annulation d’une mission, gel global et validations contextuelles |
| Mémoire | Préférences et connaissances consultables, corrigeables et supprimables |

Un agent ne tourne pas en permanence simplement parce qu’il existe dans le catalogue. Les workers exécutent des missions à la demande ou selon des déclencheurs explicitement configurés.

## PWA sur iPhone Linux et macOS

Une interface React responsive sert les trois environnements. Elle propose un manifeste d’installation, une icône et un mode autonome lorsque le navigateur le permet. L’installation dépend du navigateur et du système ; l’accès par navigateur reste disponible. [Installation des PWA sur MDN](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Installing).

La première version met en cache l’interface et les brouillons, mais ne promet pas l’exécution de missions hors connexion. Un message hors ligne reste visiblement « non envoyé ». Au retour du réseau, il conserve son identifiant client pour éviter une double soumission. Les données privées et réponses API ne sont pas mises dans le cache public du service worker.

L’interface doit être testée sur Safari iPhone réel, Safari macOS et un navigateur Chromium sur Linux. L’installation est un confort ; le fonctionnement dans ces navigateurs constitue le contrat de base.

## Interaction vocale

Le parcours initial utilise un bouton « Parler » : capture du micro, transcription, création d’un message, traitement par Jarvis puis réponse vocale et texte. La transcription reste visible et corrigeable. L’utilisateur peut interrompre la lecture sans annuler la mission ; un bouton distinct annule le travail.

Le navigateur demande l’accès au microphone dans un contexte sécurisé HTTPS. [Accès au microphone sur MDN](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia).

La cible initiale est une conversation vocale au premier plan. L’écoute permanente, le mot de réveil et le fonctionnement micro avec l’iPhone verrouillé feront l’objet d’une étude native séparée ; ils ne sont pas des critères de la PWA. Les notifications push sont un lot ultérieur, avec suivi dans l’application comme solution de base.

Proposition d’implémentation : `MediaRecorder` avec sélection du format réellement supporté, envoi audio HTTPS, adaptateur STT de transcription et adaptateur TTS de synthèse. Le serveur normalise le format si nécessaire. Le fournisseur audio est indépendant du harness ; un abonnement de coding ne vaut pas crédit audio. Une deuxième étape pourra ajouter transcription continue et WebRTC après mesure des latences.

Les enregistrements bruts sont supprimés après transcription par défaut. Une conservation pour diagnostic nécessite un réglage explicite et une durée limitée. Les résumés oraux annoncent l’essentiel ; les détails techniques restent dans les résultats écrits.

## Écrans

1. **Conversation** : texte, micro, pièces jointes, résultats et cartes de missions.
2. **Missions** : arbre de tâches, avancement, blocages, annulation et artefacts.
3. **Organisation** : départements, agents, versions, outils et performances.
4. **Évolutions** : changements proposés, prévisualisations, tests, risque et historique des releases.
5. **Réglages** : comptes, modèles accessibles, budgets, mémoire, appareils et règles d’autonomie.

Une validation présente le changement concret, les accès nouveaux, les résultats de tests et le retour arrière prévu. Les boutons « Approuver » et « Refuser » s’appliquent à cette version uniquement. Jarvis réutilise les autorisations existantes dans leur périmètre.

## Exemple de création de capacité

L’import CSV démarre avec un fichier de démonstration dans un stockage isolé. Jarvis constate qu’aucun outil d’import adapté n’existe, rédige les critères d’acceptation, fait produire une extension et reprend le traitement après activation. Il demande les informations réellement manquantes — colonnes, devise, destination — et n’invente pas des règles de gestion.

## Accès aux ordinateurs

La PWA suffit pour dialoguer avec le serveur. Pour manipuler des fichiers ou applications sur un poste, une phase ultérieure ajoute un compagnon local Linux/macOS : appairage, connexion sortante authentifiée, outils limités, choix des répertoires et révocation par appareil. Les tâches restent en attente si le poste est hors ligne. Aucun service d’administration du poste n’est directement exposé à Internet.

## Limites initiales

Le produit démarre avec un propriétaire et un espace. Les paiements, l’envoi de communications externes, la domotique et l’administration complète des postes sont des intégrations futures, avec leurs propres droits. L’auto amélioration concerne le logiciel, ses agents et ses outils ; elle ne signifie pas entraînement automatique des modèles de fondation.
