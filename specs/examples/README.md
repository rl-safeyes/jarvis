# Exemples de contrats

Ces fichiers illustrent les contrats à implémenter. Ils ne démarrent aucun agent et ne contiennent aucun compte configuré.

- [agent.schema.json](agent.schema.json) valide la structure d’un manifeste.
- [agent-developer.json](agent-developer.json) décrit un développeur d’extensions et respecte ce schéma.
- [harness-adapter.ts](harness-adapter.ts) définit une interface commune indépendante des SDK fournisseurs.

Les identifiants de politiques, comptes, outils et suites d’évaluation dans le manifeste sont des références de catalogue à créer au démarrage du projet. Les résolutions et contrôles d’autorisation sont effectués côté serveur. Un manifeste structurellement valide ne constitue pas une autorisation d’exécution.

Les capacités accordées résultent de l’intersection des droits de l’utilisateur, de la mission, du département et de l’agent. Les limites du manifeste peuvent réduire ces droits, jamais les élargir. Les replis de harness sont des candidats : le noyau doit encore vérifier le compte, les capacités et le budget avant de les employer.

`sandbox.exec` autorise uniquement des commandes dans l’environnement isolé affecté à la tâche. Ce nom ne désigne pas un accès shell au serveur hôte. `tests.run` produit un rapport ; seul le runner de confiance peut attester les contrôles nécessaires à une release.
