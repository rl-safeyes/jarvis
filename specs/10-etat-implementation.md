# État de l’implémentation

Mise à jour : 12 octobre 2026. Le premier socle simulé est conservé pour les tests. Le gestionnaire de harnesses et la conversation réelle sont complétés par un premier lot de création et délégation d’agents.

## Livré dans le code

| Domaine | État |
| --- | --- |
| Application | TypeScript, React, Vite, Fastify ; PWA responsive et page hors connexion |
| Accès | Propriétaire unique, session persistante, cookie HttpOnly, CSRF et limitation des tentatives |
| Conversations | Envoi idempotent, contrôle de version, historique PostgreSQL, événements SSE |
| Runtimes Docker | Recettes épinglées pour Codex, Claude Code et OpenCode ; aucun emprunt de CLI ou de compte de l’hôte |
| Premier démarrage | Codex et Claude Code installés par défaut ; moteurs initiaux sélectionnables via `JARVIS_INITIAL_HARNESSES` |
| Connexion | Assistant PWA utilisable sans IA ; Codex par code ChatGPT ou clé API, Claude par abonnement (lien + code du CLI) ou clé Anthropic, OpenCode par clé OpenAI/Anthropic |
| Profils | Plusieurs comptes et modèles, test réel obligatoire avant sélection, défaut global et affectation par agent |
| Héritage | Jarvis et spécialistes sans choix explicite utilisent le défaut ; snapshots immuables par mission |
| Fiches d’agents | Registre PostgreSQL, départements, création par chat ou Organisation, instructions et profils versionnés |
| Délégation | Décisions structurées de Jarvis, tâches de spécialistes, résultats persistés et restitution dans la conversation |
| Limites des missions | 8 appels de modèle, 6 tours de décision, 3 créations et 3 délégations maximum ; 15 minutes par mission et 5 minutes par appel, attente incluse |
| Administration par chat | Commandes explicites d’installation, orientation vers connexion, choix du défaut, choix de Jarvis/spécialiste et retour à l’héritage |
| Exécution réelle | Temporal, outbox, worker séparé et superviseur Docker ; une inférence à la fois par compte |
| Reprise | Idempotence par opération ; rattachement après perte du worker ; résultat inconnu signalé après crash du runtime, sans nouvelle inférence automatique |
| Contrôle | Annulation demandée puis vérifiée côté runtime, invalidation des profils après changement de compte |
| Secrets | Clés API Claude/OpenCode chiffrées AES-GCM ; cache natif Codex dans un volume dédié protégé, jamais copié de l’hôte |

| Développement isolé | Copie Jarvis, outils fichiers/Git/terminal, patch figé, vérifications de référence et revue indépendante ; publication non intégrée |

## Limites présentes

Le démarrage réel de la connexion Codex par code appareil est vérifié. Les images de runtime (révision `v2`) exportent le magasin de certificats Mozilla inclus dans Node vers `/etc/ssl/certs/ca-certificates.crt` pour le client HTTPS natif. La vérification TLS reste activée ; ce magasin suit la version de l’image Node. Les erreurs réseau, TLS et refus du fournisseur traversent les couches sous forme de codes filtrés ; aucun diagnostic natif contenant potentiellement des secrets n’est exposé.

Le propriétaire a validé la connexion ChatGPT Business, le profil Codex et une conversation réelle dans Jarvis. Les autres fournisseurs restent à qualifier avec leurs comptes réels. L’installation d’un exécutable ne vaut pas preuve d’accès à un modèle. Les connexions d’abonnement Claude et les autres fournisseurs OpenCode ne sont pas intégrés dans cette tranche.

Les outils natifs restent désactivés dans les conteneurs de compte. Les messages autorisés en mode développement peuvent utiliser les outils du service isolé décrits dans [le lot développement](11-outils-developpement.md). Les autres conversations restent sans accès au dépôt ni au terminal. Les spécialistes peuvent être créés et appelés pour rédiger ou analyser le contexte fourni. Ils ne peuvent pas déléguer à leur tour. Les spécialistes désignés pour une mission de développement disposent uniquement des outils bornés de cette mission. La création valide le schéma, le profil et l’absence de nouvelles capacités ; les évaluations qualitatives automatiques restent à ajouter. Les fiches actuelles ne constituent pas encore le registre complet de manifestes v2 avec suites d’évaluation.

Le catalogue installable comprend les trois intégrations connues. Ajouter une autre marque, mettre à jour une recette ou qualifier une nouvelle version nécessite encore une modification logicielle. L’installation conversationnelle suit les formulations documentées dans le README ; l’interprétation générale des demandes et les cartes d’action intégrées restent à développer. La connexion est guidée depuis les réglages, pas réalisée par le modèle à la place du propriétaire.

Les profils sont immuables dans cette tranche : créer un nouveau profil pour changer de modèle. Le choix de compte ambigu se résout manuellement dans les réglages. La suppression des profils, les mises à jour automatiques de runtime, le profil de référence par harness et les replis configurables restent à implémenter.

Le dialogue utilise les 20 derniers messages ; le contexte d’orchestration (registre et résultats inclus) est limité à 64 000 caractères. Un dépassement invite à ouvrir une autre conversation ; le résultat complet du spécialiste reste consultable dans ses tâches, tandis que sa restitution au planificateur est bornée à 3 000 caractères. Les événements SSE exposent les étapes ; la réponse est persistée à la fin du tour. Le streaming des tokens, les sessions natives longues et les budgets fins restent à ajouter. Le superviseur possède le socket Docker : il est privilégié et ne doit pas être accessible aux agents.

La synthèse vocale, les notifications, le compagnon desktop, les espaces multiples et le cycle de release autonome ne sont pas réalisés. Jarvis n’est donc pas encore auto-améliorable.

## Vérifications

- Validation du lot développement avec le vrai Codex : création de `docs/guide-departements.md` dans la copie isolée, patch figé, compilation et tests unitaires réussis, revue favorable et synthèse. Neuf appels au modèle ; aucune application du patch ni publication.

- Lot développement : 42 tests unitaires/intégration, 2 parcours navigateur ordinateur/mobile ; outils Docker réels, isolation des comptes, copie figée, tests de référence, annulation durable et parcours Temporal complet avec pair Codex factice.

- Validation avec le compte Codex réel : création de l’agent « Analyste Produit » dans « Produit », délégation de critères d’acceptation et synthèse par Jarvis ; quatre appels de modèle, mission terminée avec succès.
- 6 tests unitaires, 26 tests d’intégration et 2 parcours navigateur ordinateur/iPhone réussis pour ce lot. Les rafraîchissements SSE sont regroupés et ciblés ; les parcours vérifient l’absence d’erreur HTTP 429 et de bannière d’erreur.
- Compilation TypeScript, build PWA et compilation des workflows Temporal.
- Création/délégation/restitution avec Temporal et Docker, annulation du spécialiste et reprise après arrêt forcé du worker sans nouvelle inférence du spécialiste.
- Tests des budgets, de l’expiration durable, de la révocation du compte enfant et de l’absence d’exécution des actions émises par les spécialistes.
- Tests unitaires et PostgreSQL : idempotence, transactions, héritage, snapshots, changement de défaut, choix explicite de Jarvis, révocation, concurrence, CSRF et séparation de la file simulée.
- Installation réelle des trois images dans une pile Docker dédiée ; vérification de leurs exécutables sans accéder aux installations de l’hôte.
- Parcours PWA sur ordinateur et format iPhone sous Chromium : configuration sans moteur connecté et compte neuf sans reprise d’identifiants hôte.
- Recette de protocole avec un pair Codex factice et Temporal réel : test de profil, réponse persistée, annulation et reprise du worker sans deuxième inférence. Les résultats ne qualifient pas les comptes fournisseurs.

## Fonctionnement du premier lot d’agents

Une mission reste gérée par Temporal. Le worker persiste chaque étape dans `mission_steps` avant d’appeler le runtime ; son UUID sert de clé native d’idempotence. Le profil et les instructions sont figés au début de chaque tâche : une modification ultérieure concerne les prochaines tâches. La création d’un agent et l’enregistrement de son étape sont transactionnels. Les annulations et les limites arrêtent les enfants ; un arrêt non confirmé est signalé comme résultat inconnu, jamais comme annulation réussie.

Les décisions du planificateur utilisent trois objets JSON validés (`reply`, `create_agent`, `delegate`). Un texte ordinaire ne déclenche aucune action. Les réponses des spécialistes restent des données ; les outils et sous-agents natifs demeurent désactivés. Un seul appel est exécuté à la fois par compte. Les limites d’appels et de durée ne constituent pas un plafond de tokens ou de facturation fournisseur.

## Suite

1. Qualifier les autres fournisseurs et ajouter les évaluations qualitatives des agents.
2. Compléter streaming, états de quota/reconnexion, budgets, sessions et gestion des versions de runtime.
3. Compléter les outils : autres dépôts, connexion GitHub, nouvelles dépendances et navigateur de test.
4. Ajouter développement/review, préproduction et publication avec retour arrière selon le risque.


## Validation du parcours abonnement Claude

- 13 tests unitaires et 36 tests d’intégration PostgreSQL réussis, dont expiration, invalidation des profils, protection CSRF et séparation des modes de connexion.
- Recette Docker avec CLI factice : connexion, inférence sans clé API, quota sans repli, redémarrage, passage explicite à l’API et déconnexion.
- CLI Claude réelle `2.1.296` : création du lien d’abonnement officiel et annulation vérifiées dans un compte Docker vierge, sans connexion du propriétaire ni inférence.
- Interface ordinateur et format mobile vérifiée avec réponses de connexion simulées, affichage du mode actif et traitement d’un code refusé.
- App, superviseur et recette Claude `v3` déployés localement ; volumes de comptes et profil global conservés. Le propriétaire doit terminer le parcours Claude et tester son profil pour qualifier l’accès réel à son abonnement.

La dictée STT est implémentée via Speaches/faster-whisper CPU en français, avec capture PWA, relecture avant envoi et moteur Docker dédié. Voir [dictée vocale](16-voice-stt.md).
