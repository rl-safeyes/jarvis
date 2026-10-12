# Préproduction et qualification d’une release

## Livré

Après publication d’une PR, la carte propose **Vérifier la préproduction**. Cette
commande lit GitHub et conserve un rapport horodaté en PostgreSQL. Elle ne fusionne
pas, ne déploie pas, ne change pas le statut brouillon et ne déclenche pas de modèle.

Le pipeline `.github/workflows/ci.yml` comporte deux jobs :

1. `check` : compilation, tests unitaires, intégration PostgreSQL et navigateur.
2. `preproduction` : construction de l’image applicative, sélection par identifiant
   Docker immuable, démarrage sur un réseau Docker interne avec PostgreSQL éphémère,
   puis vérification par un conteneur de sonde distinct.

La sonde contrôle le chargement de la PWA, les migrations sur base vide, l’accès
non authentifié, la connexion, CSRF, une conversation persistante, l’idempotence,
une mission avec moteur simulé et la déconnexion. Aucun compte, volume ou secret de
production n’est monté. Les données et identifiants sont synthétiques. Aucun port
n’est publié. Le réseau de préproduction n’a pas d’accès externe. La construction
initiale nécessite le registre npm et les images de base sur le runner GitHub.
Le nettoyage retire seulement les trois conteneurs et le réseau créés par ce test.

Ce lot est une préproduction éphémère de qualification, pas un site de démonstration
permanent. Il ne qualifie pas les abonnements réels, le STT, Temporal, une migration
sur les données historiques ou le retour arrière. L’image n’est pas publiée dans
un registre de releases ; son identifiant et le commit sont archivés dans
l’artefact GitHub `preproduction-report`.

## Confiance et preuves

Le service GitHub installé contient la version approuvée du workflow, des deux
scripts de préproduction et du Dockerfile. Le contenu de ces fichiers sur le
commit candidat doit correspondre exactement. Modifier un pipeline puis faire
passer ses propres contrôles ne permet pas de qualifier ce candidat. Une mise à
jour de ce périmètre requiert une installation opérateur du nouveau validateur.
Le digest de politique inclut ces empreintes et le code du classificateur.

Le rapport vérifie :

- PR ouverte dans le dépôt configuré, branche `jarvis/<change-id>`, commit publié
  identique au commit testé/revu localement et parent identique à la source figée ;
- branche de départ toujours à la même version et diff complet (20 fichiers max) ;
- dernière exécution `push` du workflow approuvé sur cette branche et ce commit ;
- succès explicite des jobs `check` et `preproduction` dans la même tentative ;
- absence de changement de commit, base ou tentative pendant la lecture des preuves.

Un job absent, ignoré, annulé ou en échec ne compte jamais comme réussi. Une
exécution plus récente remplace les preuves anciennes. Un workflow absent ou en
cours produit « en attente ». Une différence de contenu produit un blocage.
Les métadonnées et états proviennent de l’API GitHub Actions, pas d’un texte d’agent.

Les rapports sont des observations datées. Recharger la page retrouve le dernier
rapport ; **Vérifier la préproduction** relit GitHub. Un changement local de
publication, patch ou configuration rend le rapport périmé. Un changement distant
ou une nouvelle version installée du validateur exige une nouvelle vérification ;
le simple affichage d’un ancien succès n’autorise aucune action. Une future release
devra revérifier ces preuves juste avant une approbation/bascule.

## Classement déterministe

- Faible : uniquement `README.md` et documentation Markdown dans `docs/`, jusqu’à
  10 fichiers et 300 lignes modifiées, diff textuel complet.
- Intermédiaire : autre surface applicative connue ou seuil dépassé.
- Élevé : infrastructure, scripts, API, stockage, contrôle des agents, permissions,
  instructions `AGENTS.md`/`CLAUDE.md`, dépendances, diff binaire/incomplet/renommé.

Cette classe est indicative pour préparer la décision. « Faible » n’autorise pas
encore le déploiement automatique : le périmètre propriétaire, les évaluations,
la stratégie de migration et la preuve de rollback doivent être livrés avant
l’activation. `deploy_allowed` reste toujours `false` dans cette tranche.

## Données et API

Migration additive `006-release-checks` : historique `release_checks`, lié à une
proposition, avec empreinte de sa publication, date de début et rapport JSON.

- `GET /api/v1/development/:id/release` : dernier rapport et obsolescence locale.
- `POST /api/v1/development/:id/release` : `{digest, commit}` issus de la proposition.

Session propriétaire et CSRF requis. Le serveur reconstruit les paramètres depuis
la publication persistée. Une validation transactionnelle refuse l’enregistrement
si les réglages ou la proposition changent pendant la lecture distante. Le parcours
est en lecture seule côté GitHub ; il n’a pas besoin d’outbox pour un effet externe.
Après interruption, l’utilisateur peut relancer la vérification sans duplication
de branche, PR ou déploiement.

## Exploitation

Le workflow utilise les runners GitHub hébergés et peut consommer le quota Actions
du dépôt. Aucun secret Actions supplémentaire n’est nécessaire. Les workflows
restent actifs sur les PR en brouillon et les branches poussées par GitHub CLI.
Le validateur accepte les exécutions `push` du commit source, pas les tests d’un
commit de merge virtuel distinct.

Pour mettre à jour le lot : pousser la version approuvée, construire les images
`github`, `supervisor`, `app`, `worker` et `development-image`, puis redémarrer les
services lorsque les missions sont terminées. Conserver les volumes et les comptes.

Le [lot 19](19-deploiement-et-retour-arriere.md) complète les approbations, la fusion,
les images locales, le déploiement de l’interface et le rollback. Le registre distant
d’images et les migrations restent hors périmètre. Aucun de ces droits n’est exposé aux agents.

Documentation officielle : [workflow runs](https://docs.github.com/en/rest/actions/workflow-runs),
[workflow jobs](https://docs.github.com/en/rest/actions/workflow-jobs).
