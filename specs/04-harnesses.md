# Intégration des harnesses et des comptes

Un harness fournit la boucle d’exécution d’un agent, ses sessions et ses outils. Jarvis l’utilise au travers d’un adaptateur ; il conserve lui-même les droits, le budget et le suivi des missions. Les profils de compte restent attachés à leur intégration d’origine.

## Interfaces retenues

| Moteur | Intégration proposée | Point à vérifier au prototype |
| --- | --- | --- |
| Codex | SDK TypeScript pour les jobs ; app-server local pour le dialogue interactif avancé | Compatibilité de version, interruptions et remontée des demandes de permission |
| Claude Code | CLI non interactive pour le profil personnel compatible ; Agent SDK pour le profil API | Authentification autorisée, permissions et reprise de session |
| OpenCode | Serveur privé et SDK TypeScript | Version majeure, schéma HTTP, comptes disponibles et isolation des sessions |

Le [SDK Codex](https://learn.chatgpt.com/docs/codex-sdk) permet d’automatiser et de reprendre des threads. L’[app-server](https://learn.chatgpt.com/docs/app-server) expose une communication structurée et des événements ; sa documentation signale des interfaces expérimentales. Retenir le transport local et qualifier la version épinglée avant production. Une API réseau native de harness ne devient jamais l’API publique Jarvis.

[Claude Code en mode programmatique](https://code.claude.com/docs/en/headless) fournit des sorties JSON et `stream-json`. Le [Claude Agent SDK](https://code.claude.com/docs/en/agent-sdk/overview) permet une intégration Python ou TypeScript de la boucle d’agent. Les outils et permissions doivent rester restreints aux capacités de la mission.

[OpenCode Server](https://opencode.ai/docs/server/) expose une API HTTP et des événements ; son [SDK](https://opencode.ai/docs/sdk/) fournit un client typé. Prévoir une instance isolée par contexte d’exécution, accessible seulement à son adaptateur. Épingler ensemble serveur et SDK : les branches de documentation des différentes versions ne sont pas interchangeables.

## Utilisation des comptes configurés

La connexion Jarvis et les connexions fournisseurs sont distinctes. La première authentifie le propriétaire de l’application. Les secondes donnent accès à un moteur avec des modèles, quotas et conditions propres.

**Codex.** La connexion ChatGPT et la connexion par clé API sont documentées. Pour un serveur sans navigateur, le parcours par code d’appareil est prévu selon les réglages du compte. L’automatisation doit gérer expiration, rafraîchissement et révocation ; une clé API reste une option distincte. [Authentification Codex](https://learn.chatgpt.com/docs/auth).

**Claude.** Claude Code documente les connexions d’abonnement et les identifiants API. Le quickstart du SDK précise que les développeurs tiers ne peuvent pas proposer une connexion claude.ai ou ses quotas dans leur produit sans accord préalable. La proposition conserve donc deux chemins : usage du CLI personnel à qualifier selon le compte et le cadre d’utilisation, ou SDK avec authentification API prise en charge. Un succès technique ne prouve pas à lui seul l’éligibilité de l’usage. [Authentification Claude Code](https://code.claude.com/docs/en/authentication), [authentification du SDK](https://code.claude.com/docs/en/agent-sdk/quickstart).

**OpenCode.** Les méthodes dépendent du fournisseur configuré. Le catalogue n’est pas une garantie d’accès ; vérifier une inférence minimale avec le compte cible. Ne pas transférer automatiquement les jetons d’un autre harness dans OpenCode. [Fournisseurs OpenCode](https://opencode.ai/docs/providers/).

Les comptes, abonnements et modèles réellement disponibles sont à renseigner avant développement des intégrations. Aucun mot de passe ni jeton ne doit être envoyé dans la conversation de cadrage.

## Parcours de connexion

1. Créer un profil de compte nommé, avec harness, fournisseur et mode de facturation.
2. Lancer le mécanisme officiel de connexion depuis une procédure d’administration contrôlée ; utiliser le parcours navigateur ou code d’appareil seulement s’il est pris en charge.
3. Conserver les secrets chiffrés ou dans un coffre système, avec métadonnées en base.
4. Exécuter un test minimal, afficher le modèle testé et l’authentification réellement utilisée.
5. Affecter le profil à des agents ou départements avec une limite de concurrence.
6. Détecter les états `ready`, `reauth_required`, `rate_limited`, `disabled` et afficher l’action utile.

Le MVP peut employer un assistant de connexion côté administrateur sur le serveur ; il ne doit pas exposer un terminal arbitraire dans la PWA. Un parcours entièrement intégré sera construit seulement sur les protocoles officiels disponibles.

Un profil de session natif n’est pas cloné aveuglément entre workers. Par défaut, un compte utilise une exécution simultanée jusqu’à validation des mécanismes de rafraîchissement et de concurrence. Une reconnexion remplace le secret via le gestionnaire de comptes, jamais via un prompt.

## Contrat d’adaptateur

[harness-adapter.ts](examples/harness-adapter.ts) décrit le contrat interne proposé : découverte des capacités, vérification de compte, démarrage idempotent, reprise, événements, interruption et réponse aux permissions. Ce contrat n’est pas une reproduction des SDK fournisseurs.

Chaque exécution capture les versions du harness et de l’adaptateur, le modèle réel, le compte, le manifeste d’agent, les outils accordés et le workspace. Les capacités absentes sont déclarées : `resume`, `permissions`, `structuredOutput`, `usage`, `cancel`. Un job exigeant une capacité absente est refusé ou routé vers un profil compatible avant son démarrage.

Les prompts sont transmis par API, stdin ou arguments structurés sans shell interpolé. Les chemins sont canonisés et les références d’artefacts vérifiées. Les paramètres de configuration et les hooks chargés par le harness sont issus d’un profil approuvé ; un dépôt entrant ne peut pas activer automatiquement des plugins.

## Sessions et bascule de moteur

Une session native se reprend avec le même harness, le même compte et un workspace compatible. Passer à un autre moteur crée une nouvelle session avec un paquet de transfert : objectif, état vérifié, artefacts, contraintes et résumé. Jarvis ne promet pas de transférer l’état interne natif entre fournisseurs.

En cas de quota, le run passe en attente jusqu’à la date connue, ou propose un compte de repli déjà autorisé. La bascule ne doit ni contourner une restriction ni entraîner une nouvelle facturation non prévue. Les quotas d’abonnement sont suivis lorsqu’exposés ; les compteurs locaux indiquent leur caractère estimé.

Les demandes de permission natives sont traduites en décisions Jarvis. Si l’adaptateur ne peut pas suspendre puis reprendre une demande, l’opération est refusée et la tâche revient avec `capability_missing`. Il n’utilise pas un mode global de suppression des permissions pour masquer cette limite.

## Critères de qualification

Pour chaque intégration : connexion sur serveur, requête réelle minimale, streaming, résultat structuré, fichier produit en sandbox, permission refusée, interruption, session reprise, quota simulé, expiration d’authentification et absence de secrets dans les logs. Ces tests déterminent la matrice exacte des modes supportés dans Jarvis.
