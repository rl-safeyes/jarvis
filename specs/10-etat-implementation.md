# État de l’implémentation

Mise à jour : 11 octobre 2026. Le premier socle simulé est conservé pour les tests. Une deuxième tranche ajoute le gestionnaire de harnesses et le chemin de conversation réelle.

## Livré dans le code

| Domaine | État |
| --- | --- |
| Application | TypeScript, React, Vite, Fastify ; PWA responsive et page hors connexion |
| Accès | Propriétaire unique, session persistante, cookie HttpOnly, CSRF et limitation des tentatives |
| Conversations | Envoi idempotent, contrôle de version, historique PostgreSQL, événements SSE |
| Runtimes Docker | Recettes épinglées pour Codex, Claude Code et OpenCode ; aucun emprunt de CLI ou de compte de l’hôte |
| Premier démarrage | Codex installé par défaut ; plusieurs moteurs initiaux sélectionnables via `JARVIS_INITIAL_HARNESSES` |
| Connexion | Assistant PWA utilisable sans IA ; Codex par code ChatGPT ou clé API, Claude par clé Anthropic, OpenCode par clé OpenAI/Anthropic |
| Profils | Plusieurs comptes et modèles, test réel obligatoire avant sélection, défaut global et affectation par agent |
| Héritage | Jarvis et spécialistes sans choix explicite utilisent le défaut ; snapshots immuables par mission |
| Fiches d’agents | Instructions et choix du profil persistés, révision optimiste et historique des versions |
| Administration par chat | Commandes explicites d’installation, orientation vers connexion, choix du défaut, choix de Jarvis/spécialiste et retour à l’héritage |
| Exécution réelle | Temporal, outbox, worker séparé et superviseur Docker ; une inférence à la fois par compte |
| Reprise | Idempotence par opération ; rattachement après perte du worker ; résultat inconnu signalé après crash du runtime, sans nouvelle inférence automatique |
| Contrôle | Annulation demandée puis vérifiée côté runtime, invalidation des profils après changement de compte |
| Secrets | Clés API Claude/OpenCode chiffrées AES-GCM ; cache natif Codex dans un volume dédié protégé, jamais copié de l’hôte |

## Limites présentes

Le démarrage réel de la connexion Codex par code appareil est vérifié. Les images de runtime (révision `v2`) exportent le magasin de certificats Mozilla inclus dans Node vers `/etc/ssl/certs/ca-certificates.crt` pour le client HTTPS natif. La vérification TLS reste activée ; ce magasin suit la version de l’image Node. Les erreurs réseau, TLS et refus du fournisseur traversent les couches sous forme de codes filtrés ; aucun diagnostic natif contenant potentiellement des secrets n’est exposé.

Le propriétaire a validé la connexion ChatGPT Business, le profil Codex et une conversation réelle dans Jarvis. Les autres fournisseurs restent à qualifier avec leurs comptes réels. L’installation d’un exécutable ne vaut pas preuve d’accès à un modèle. Les connexions d’abonnement Claude et les autres fournisseurs OpenCode ne sont pas intégrés dans cette tranche.

Les outils natifs sont désactivés pour les conversations : pas d’exécution de code demandé par le modèle, pas d’accès au dépôt, pas de développement autonome. Les spécialistes ont des fiches configurables mais la délégation et la création dynamique ne sont pas actives. Les fiches actuelles ne constituent pas encore le registre complet de manifestes v2 avec suites d’évaluation.

Le catalogue installable comprend les trois intégrations connues. Ajouter une autre marque, mettre à jour une recette ou qualifier une nouvelle version nécessite encore une modification logicielle. L’installation conversationnelle suit les formulations documentées dans le README ; l’interprétation générale des demandes et les cartes d’action intégrées restent à développer. La connexion est guidée depuis les réglages, pas réalisée par le modèle à la place du propriétaire.

Les profils sont immuables dans cette tranche : créer un nouveau profil pour changer de modèle. Le choix de compte ambigu se résout manuellement dans les réglages. La suppression des profils, les mises à jour automatiques de runtime, le profil de référence par harness et les replis configurables restent à implémenter.

Le dialogue transmet les 20 derniers messages, bornés à 64 000 caractères. Les événements SSE exposent les étapes ; la réponse est persistée à la fin du tour. Le streaming des tokens, les sessions natives longues et les budgets fins restent à ajouter. Le superviseur possède le socket Docker : il est privilégié et ne doit pas être accessible aux agents.

La voix, les notifications, le compagnon desktop, les espaces multiples et le cycle de release autonome ne sont pas réalisés. Jarvis n’est donc pas encore auto-améliorable.

## Vérifications

- Compilation TypeScript, build PWA et compilation des workflows Temporal.
- Tests unitaires et PostgreSQL : idempotence, transactions, héritage, snapshots, changement de défaut, choix explicite de Jarvis, révocation, concurrence, CSRF et séparation de la file simulée.
- Installation réelle des trois images dans une pile Docker dédiée ; vérification de leurs exécutables sans accéder aux installations de l’hôte.
- Parcours PWA sur ordinateur et format iPhone sous Chromium : configuration sans moteur connecté et compte neuf sans reprise d’identifiants hôte.
- Recette de protocole avec un pair Codex factice et Temporal réel : test de profil, réponse persistée, annulation et reprise du worker sans deuxième inférence. Les résultats ne qualifient pas les comptes fournisseurs.

## Suite

1. Connecter les comptes réels depuis la PWA, tester les modèles et qualifier chaque mode d’authentification utilisé.
2. Compléter streaming, états de quota/reconnexion, budgets, sessions et gestion des versions de runtime.
3. Activer délégation, agents versionnés évalués et outils limités dans des workspaces isolés.
4. Ajouter création dynamique, développement/review, préproduction et publication avec retour arrière selon le risque.
