# Exemples de contrats

Ces fichiers illustrent les contrats à implémenter. Ils ne démarrent aucun agent et ne contiennent aucun compte configuré.

- [agent.schema.json](agent.schema.json) valide la structure d’un manifeste v2 avec choix de profil facultatif et héritage du défaut.
- [agent-developer.json](agent-developer.json) décrit un développeur d’extensions et respecte ce schéma.
- [harness-adapter.ts](harness-adapter.ts) définit une interface commune indépendante des SDK fournisseurs.

Les identifiants de politiques, comptes, outils et suites d’évaluation dans le manifeste sont des références de catalogue à créer au démarrage du projet. Les résolutions et contrôles d’autorisation sont effectués côté serveur. Un manifeste structurellement valide ne constitue pas une autorisation d’exécution.

Les capacités accordées résultent de l’intersection des droits de l’utilisateur, de la mission, du département et de l’agent. Les limites du manifeste peuvent réduire ces droits, jamais les élargir. Un profil explicite indisponible bloque le run ; il ne se replie pas automatiquement sur le défaut. Les politiques de compte et de modèle sont portées par les profils d’exécution et les restrictions du noyau, pas par une liste de préférences dans le prompt.

`sandbox.exec` autorise uniquement des commandes dans l’environnement isolé affecté à la tâche. Ce nom ne désigne pas un accès shell au serveur hôte. `tests.run` produit un rapport ; seul le runner de confiance peut attester les contrôles nécessaires à une release.

## Sélection d’exécution du manifeste v2

L’exemple développeur hérite du défaut. Supprimer `runtime.execution` a exactement le même effet que `{ "mode": "inherit" }`. Pour une affectation explicite, utiliser :

```json
{
  "execution": {
    "mode": "profile",
    "profile_ref": "profiles.developer-codex"
  },
  "required_capabilities": ["resume", "cancel"]
}
```

Ce fragment remplace `runtime`. Le profil doit exister, être autorisé et satisfaire les capacités requises. Les identifiants de harness sont extensibles dans le registre ; ni le schéma ni l’adaptateur ne limitent le produit à trois marques. L’ajout d’un identifiant n’installe pas son runtime ni son adaptateur.

Les manifestes v1 ne sont pas acceptés sous la forme v2 : une migration explicite transforme les anciennes préférences et politiques en référence de profil, ou laisse un brouillon si le choix de compte est ambigu. Le contrat d’exemple n’est pas encore celui du catalogue exécutable du premier jalon.
