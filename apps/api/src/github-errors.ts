export const githubErrors: Record<string, string> = {
  github_disconnected: 'Connectez votre compte GitHub dans les réglages.',
  github_permission:
    'GitHub refuse cet accès. Vérifiez les droits d’écriture et l’autorisation de votre organisation.',
  github_repository_missing: 'Dépôt ou branche inaccessible avec ce compte GitHub.',
  github_base_changed:
    'La branche de départ a changé. Relancez une mission depuis sa nouvelle version avant de publier.',
  github_source_missing:
    'La copie GitHub de cette proposition est absente. Lancez une nouvelle mission.',
  github_branch_conflict:
    'La branche Jarvis existe avec un autre contenu. Aucune branche n’a été écrasée.',
  github_conflict:
    'GitHub contient un état différent de cette proposition. Vérifiez la branche et la PR avant de reprendre.',
  github_protected_path:
    'Ce parcours ne publie pas les fichiers .github, .gitattributes ou .gitmodules. Une procédure dédiée est nécessaire.',
  github_invalid_patch: 'Le patch ne peut pas être publié dans ce parcours.',
  github_invalid_repository: 'Indiquez le dépôt sous la forme propriétaire/dépôt.',
  github_invalid_branch: 'Le nom de branche GitHub est invalide.',
  github_invalid_path: 'Un chemin du dépôt est incompatible avec la copie isolée.',
  github_unsupported_file:
    'Ce parcours ne prend pas en charge les liens symboliques ni les sous-modules.',
  github_source_limit:
    'Le dépôt dépasse les limites de cette copie isolée (3 000 fichiers, 32 Mo).',
  github_git_failed:
    'La copie ou l’application du patch a échoué. Vérifiez le dépôt et la connexion GitHub.',
  github_unavailable:
    'Le service GitHub est indisponible. Réessayez ; une branche ou une PR déjà créée sera recherchée avant toute reprise.',
};
