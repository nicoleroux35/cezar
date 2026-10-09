/**
 * Translations for the cezar cockpit.
 *
 * Each key maps to translations in all supported languages.
 * Keep translations synchronized across languages.
 */

export const translations = {
  // Settings - Appearance
  'settings.appearance.theme': {
    en: 'Theme',
    fr: 'Thème',
  },
  'settings.appearance.theme.hint': {
    en: 'System follows your OS preference. Applies to this browser.',
    fr: 'Système suit les préférences de votre OS. S\'applique à ce navigateur.',
  },
  'settings.appearance.theme.system': {
    en: 'System',
    fr: 'Système',
  },
  'settings.appearance.theme.light': {
    en: 'Light',
    fr: 'Clair',
  },
  'settings.appearance.theme.dark': {
    en: 'Dark',
    fr: 'Sombre',
  },
  'settings.appearance.accent': {
    en: 'Accent',
    fr: 'Accent',
  },
  'settings.appearance.accent.hint': {
    en: 'The primary action color. Saved with this repo\'s cockpit state.',
    fr: 'La couleur d\'action principale. Enregistrée avec l\'état du cockpit de ce dépôt.',
  },
  'settings.appearance.accent.lime': {
    en: 'Lime',
    fr: 'Citron vert',
  },
  'settings.appearance.accent.violet': {
    en: 'Violet',
    fr: 'Violet',
  },
  'settings.appearance.density': {
    en: 'Density',
    fr: 'Densité',
  },
  'settings.appearance.density.hint': {
    en: 'Compact tightens spacing across the cockpit — text stays the same size.',
    fr: 'Compact resserre l\'espacement dans le cockpit — le texte garde la même taille.',
  },
  'settings.appearance.density.comfortable': {
    en: 'Comfortable',
    fr: 'Confortable',
  },
  'settings.appearance.density.compact': {
    en: 'Compact',
    fr: 'Compact',
  },
  'settings.appearance.density.ultra': {
    en: 'Compact for real',
    fr: 'Très compact',
  },
  'settings.appearance.width': {
    en: 'Reading width',
    fr: 'Largeur de lecture',
  },
  'settings.appearance.width.hint': {
    en: 'Wide lets a task\'s session and commits use more of the screen. Narrow keeps a comfortable reading column. The Changes tab is always full-width.',
    fr: 'Large permet aux sessions et commits d\'une tâche d\'utiliser plus d\'écran. Étroit garde une colonne de lecture confortable. L\'onglet Changements est toujours en pleine largeur.',
  },
  'settings.appearance.width.narrow': {
    en: 'Narrow',
    fr: 'Étroit',
  },
  'settings.appearance.width.wide': {
    en: 'Wide',
    fr: 'Large',
  },
  'settings.appearance.language': {
    en: 'Language',
    fr: 'Langue',
  },
  'settings.appearance.language.hint': {
    en: 'The language for the cockpit interface.',
    fr: 'La langue de l\'interface du cockpit.',
  },
  'settings.appearance.language.en': {
    en: 'English',
    fr: 'Anglais',
  },
  'settings.appearance.language.fr': {
    en: 'French',
    fr: 'Français',
  },
  'settings.appearance.projectOrder': {
    en: 'Project order',
    fr: 'Ordre des projets',
  },
  'settings.appearance.projectOrder.hint': {
    en: 'The sidebar is in the order you dragged it into. Reset puts it back to most-recently-opened first. Shared with every browser signed in to this cezar.',
    fr: 'La barre latérale est dans l\'ordre que vous avez défini par glisser-déposer. Réinitialiser remet l\'ordre par date d\'ouverture. Partagé avec tous les navigateurs connectés à ce cezar.',
  },
  'settings.appearance.projectOrder.reset': {
    en: 'Reset order',
    fr: 'Réinitialiser l\'ordre',
  },

  // Sidebar - Navigation
  'nav.dashboard': {
    en: 'Dashboard',
    fr: 'Tableau de bord',
  },
  'nav.tasks': {
    en: 'Tasks',
    fr: 'Tâches',
  },
  'nav.inbox': {
    en: 'Inbox',
    fr: 'Boîte de réception',
  },
  'nav.git': {
    en: 'Git',
    fr: 'Git',
  },
  'nav.github': {
    en: 'GitHub',
    fr: 'GitHub',
  },
  'nav.tracker': {
    en: 'Tracker',
    fr: 'Tracker',
  },
  'nav.automations': {
    en: 'Automations',
    fr: 'Automatisations',
  },
  'nav.skills': {
    en: 'Skills',
    fr: 'Compétences',
  },
  'nav.workflows': {
    en: 'Workflows',
    fr: 'Workflows',
  },
  'nav.settings': {
    en: 'Settings',
    fr: 'Paramètres',
  },

  // Sidebar - Actions
  'sidebar.search': {
    en: 'Search',
    fr: 'Rechercher',
  },
  'sidebar.newTask': {
    en: 'New task',
    fr: 'Nouvelle tâche',
  },
  'sidebar.addProject': {
    en: 'Add project',
    fr: 'Ajouter un projet',
  },
  'sidebar.cloneProject': {
    en: 'Clone project',
    fr: 'Cloner un projet',
  },
  'sidebar.openLocalFolder': {
    en: 'Open local folder',
    fr: 'Ouvrir un dossier local',
  },
  'sidebar.globalSettings': {
    en: 'Global settings',
    fr: 'Paramètres globaux',
  },
  'sidebar.openMenu': {
    en: 'Open menu',
    fr: 'Ouvrir le menu',
  },
  'sidebar.closeMenu': {
    en: 'Close menu',
    fr: 'Fermer le menu',
  },

  // Sidebar - Projects
  'sidebar.projects': {
    en: 'Projects',
    fr: 'Projets',
  },
  'sidebar.allProjects': {
    en: 'All projects',
    fr: 'Tous les projets',
  },
  'sidebar.noProjects': {
    en: 'No projects',
    fr: 'Aucun projet',
  },

  // Sidebar - Footer
  'sidebar.version': {
    en: 'Version',
    fr: 'Version',
  },
  'sidebar.updateAvailable': {
    en: 'Update available',
    fr: 'Mise à jour disponible',
  },
  'sidebar.starOnGitHub': {
    en: 'Star on GitHub',
    fr: 'Étoile sur GitHub',
  },

  // Sidebar - Tools menu
  'sidebar.tools': {
    en: 'Tools',
    fr: 'Outils',
  },
  'sidebar.commandPalette': {
    en: 'Command palette',
    fr: 'Palette de commandes',
  },

  // Sidebar - Status
  'sidebar.skillsUpdateAvailable': {
    en: 'Skills update available',
    fr: 'Mise à jour des compétences disponible',
  },
  'sidebar.unreadFinishedTask': {
    en: 'unread finished task',
    fr: 'tâche terminée non lue',
  },
  'sidebar.unreadFinishedTasks': {
    en: 'unread finished tasks',
    fr: 'tâches terminées non lues',
  },

  // Tasks page - Views
  'tasks.view.active': {
    en: 'Active',
    fr: 'Actives',
  },
  'tasks.view.archived': {
    en: 'Archived',
    fr: 'Archivées',
  },

  // Tasks page - Buckets
  'tasks.bucket.pinned': {
    en: 'Pinned',
    fr: 'Épinglées',
  },
  'tasks.bucket.needsYou': {
    en: 'Needs you',
    fr: 'Besoin de vous',
  },
  'tasks.bucket.working': {
    en: 'Working',
    fr: 'En cours',
  },
  'tasks.bucket.recent': {
    en: 'Recent',
    fr: 'Récentes',
  },
  'tasks.bucket.archived': {
    en: 'Archived',
    fr: 'Archivées',
  },

  // Tasks page - Actions
  'tasks.action.archiveFinished': {
    en: 'Archive finished',
    fr: 'Archiver terminées',
  },
  'tasks.action.markAllRead': {
    en: 'Mark all read',
    fr: 'Tout marquer comme lu',
  },
  'tasks.action.search': {
    en: 'Search',
    fr: 'Rechercher',
  },
  'tasks.action.clearSearch': {
    en: 'Clear search',
    fr: 'Effacer la recherche',
  },

  // Tasks page - Empty states
  'tasks.empty.noTasks': {
    en: 'No tasks',
    fr: 'Aucune tâche',
  },
  'tasks.empty.noResults': {
    en: 'No matching tasks',
    fr: 'Aucune tâche correspondante',
  },
  'tasks.empty.allDone': {
    en: 'All done',
    fr: 'Tout est fait',
  },

  // Tasks page - Status
  'tasks.status.waiting': {
    en: 'Waiting',
    fr: 'En attente',
  },
  'tasks.status.running': {
    en: 'Running',
    fr: 'En cours',
  },
  'tasks.status.queued': {
    en: 'Queued',
    fr: 'En file',
  },
  'tasks.status.review': {
    en: 'Review',
    fr: 'À réviser',
  },
  'tasks.status.done': {
    en: 'Done',
    fr: 'Terminée',
  },
  'tasks.status.failed': {
    en: 'Failed',
    fr: 'Échouée',
  },
  'tasks.status.cancelled': {
    en: 'Cancelled',
    fr: 'Annulée',
  },

  // Tasks page - Columns
  'tasks.column.status': {
    en: 'Status',
    fr: 'Statut',
  },
  'tasks.column.title': {
    en: 'Title',
    fr: 'Titre',
  },
  'tasks.column.workflow': {
    en: 'Workflow',
    fr: 'Workflow',
  },
  'tasks.column.changes': {
    en: 'Changes',
    fr: 'Modifications',
  },
  'tasks.column.tokens': {
    en: 'Tokens',
    fr: 'Jetons',
  },
  'tasks.column.cost': {
    en: 'Cost',
    fr: 'Coût',
  },
  'tasks.column.time': {
    en: 'Time',
    fr: 'Durée',
  },
  'tasks.column.memory': {
    en: 'Memory',
    fr: 'Mémoire',
  },

  // Tasks page - Group actions
  'tasks.group.expand': {
    en: 'Expand',
    fr: 'Développer',
  },
  'tasks.group.collapse': {
    en: 'Collapse',
    fr: 'Réduire',
  },
  'tasks.group.task': {
    en: 'task',
    fr: 'tâche',
  },
  'tasks.group.tasks': {
    en: 'tasks',
    fr: 'tâches',
  },
  'tasks.group.startAll': {
    en: 'Start all',
    fr: 'Tout démarrer',
  },

  // New Task Form
  'newTask.title': {
    en: 'New task',
    fr: 'Nouvelle tâche',
  },
  'newTask.placeholder': {
    en: 'Describe a task for the agent — / for skills…',
    fr: 'Décrivez une tâche pour l\'agent — / pour les compétences…',
  },
  'newTask.ariaLabel': {
    en: 'Describe a task for the agent',
    fr: 'Décrivez une tâche pour l\'agent',
  },
  'newTask.startTask': {
    en: 'Start task',
    fr: 'Démarrer la tâche',
  },
  'newTask.planTask': {
    en: 'Plan task',
    fr: 'Planifier la tâche',
  },
  'newTask.addToQueue': {
    en: 'Add to queue',
    fr: 'Ajouter à la file',
  },
  'newTask.startingTask': {
    en: 'Starting task…',
    fr: 'Démarrage de la tâche…',
  },
  'newTask.planning': {
    en: 'Planning…',
    fr: 'Planification…',
  },
  'newTask.planFirst': {
    en: 'Plan first',
    fr: 'Planifier d\'abord',
  },
  'newTask.start': {
    en: 'Start',
    fr: 'Démarrer',
  },
  'newTask.queueOnly': {
    en: 'Queue only',
    fr: 'File uniquement',
  },

  // New Task Form - Fields
  'newTask.field.project': {
    en: 'Project',
    fr: 'Projet',
  },
  'newTask.field.workflow': {
    en: 'Workflow',
    fr: 'Workflow',
  },
  'newTask.field.runner': {
    en: 'Runner',
    fr: 'Exécuteur',
  },
  'newTask.field.model': {
    en: 'Model',
    fr: 'Modèle',
  },
  'newTask.field.source': {
    en: 'Source',
    fr: 'Source',
  },
  'newTask.field.searchProjects': {
    en: 'search projects…',
    fr: 'rechercher des projets…',
  },
  'newTask.field.searchWorkflows': {
    en: 'search workflows…',
    fr: 'rechercher des workflows…',
  },
  'newTask.field.searchModels': {
    en: 'search models…',
    fr: 'rechercher des modèles…',
  },

  // New Task Form - Sources
  'newTask.source.github': {
    en: 'GitHub',
    fr: 'GitHub',
  },
  'newTask.source.tracker': {
    en: 'Tracker',
    fr: 'Tracker',
  },
  'newTask.source.manual': {
    en: 'Manual',
    fr: 'Manuel',
  },

  // Dashboard
  'dashboard.title': {
    en: 'Dashboard',
    fr: 'Tableau de bord',
  },
  'dashboard.view.overview': {
    en: 'Overview',
    fr: 'Vue d\'ensemble',
  },
  'dashboard.view.costs': {
    en: 'Usage & cost',
    fr: 'Utilisation & coût',
  },
  'dashboard.view.automations': {
    en: 'Automations',
    fr: 'Automatisations',
  },

  // Dashboard - Tiles
  'dashboard.tile.fleet': {
    en: 'Fleet',
    fr: 'Flotte',
  },
  'dashboard.tile.needsYou': {
    en: 'Needs you',
    fr: 'Besoin de vous',
  },
  'dashboard.tile.recent': {
    en: 'Recent results & GitHub',
    fr: 'Résultats récents & GitHub',
  },
  'dashboard.tile.usage': {
    en: 'Usage & cost',
    fr: 'Utilisation & coût',
  },
  'dashboard.tile.trends': {
    en: 'Trends',
    fr: 'Tendances',
  },
  'dashboard.tile.automations': {
    en: 'Automations',
    fr: 'Automatisations',
  },
  'dashboard.tile.overview': {
    en: 'Overview',
    fr: 'Vue d\'ensemble',
  },
  'dashboard.tile.portfolio': {
    en: 'Portfolio',
    fr: 'Portefeuille',
  },

  // Dashboard - Actions
  'dashboard.showAll': {
    en: 'Show all',
    fr: 'Tout afficher',
  },
  'dashboard.customize': {
    en: 'Customize',
    fr: 'Personnaliser',
  },
  'dashboard.reset': {
    en: 'Reset',
    fr: 'Réinitialiser',
  },

  // Dashboard - Stats
  'dashboard.running': {
    en: 'running',
    fr: 'en cours',
  },
  'dashboard.task': {
    en: 'task',
    fr: 'tâche',
  },
  'dashboard.tasks': {
    en: 'tasks',
    fr: 'tâches',
  },

  // Git - Tabs
  'git.tab.changes': {
    en: 'Changes',
    fr: 'Modifications',
  },
  'git.tab.commits': {
    en: 'Commits',
    fr: 'Commits',
  },
  'git.tab.branches': {
    en: 'Branches',
    fr: 'Branches',
  },

  // Git - Changes
  'git.changes.uncommitted': {
    en: 'Uncommitted changes',
    fr: 'Modifications non validées',
  },
  'git.changes.loading': {
    en: 'Loading changes…',
    fr: 'Chargement des modifications…',
  },
  'git.changes.noChanges': {
    en: 'No changes to show',
    fr: 'Aucune modification à afficher',
  },
  'git.changes.workingTreeClean': {
    en: 'Working tree clean',
    fr: 'Arbre de travail propre',
  },
  'git.changes.couldNotLoad': {
    en: 'Could not load the changes',
    fr: 'Impossible de charger les modifications',
  },

  // Git - Commits
  'git.commits.recent': {
    en: 'Recent commits',
    fr: 'Commits récents',
  },
  'git.commits.loading': {
    en: 'Loading commits…',
    fr: 'Chargement des commits…',
  },
  'git.commits.notFound': {
    en: 'Commit not found',
    fr: 'Commit introuvable',
  },
  'git.commits.couldNotLoad': {
    en: 'Could not load the commit',
    fr: 'Impossible de charger le commit',
  },
  'git.commits.noCommits': {
    en: 'No commits',
    fr: 'Aucun commit',
  },

  // Git - Branches
  'git.branches.title': {
    en: 'Branches',
    fr: 'Branches',
  },
  'git.branches.current': {
    en: 'Current branch',
    fr: 'Branche actuelle',
  },
  'git.branches.all': {
    en: 'All branches',
    fr: 'Toutes les branches',
  },
  'git.branches.switch': {
    en: 'Switch',
    fr: 'Basculer',
  },
  'git.branches.create': {
    en: 'Create branch',
    fr: 'Créer une branche',
  },
  'git.branches.delete': {
    en: 'Delete',
    fr: 'Supprimer',
  },

  // Git - Actions
  'git.action.commit': {
    en: 'Commit',
    fr: 'Valider',
  },
  'git.action.push': {
    en: 'Push',
    fr: 'Pousser',
  },
  'git.action.pull': {
    en: 'Pull',
    fr: 'Tirer',
  },
  'git.action.stash': {
    en: 'Stash',
    fr: 'Remiser',
  },
  'git.action.discard': {
    en: 'Discard',
    fr: 'Abandonner',
  },

  // Git - File status
  'git.status.modified': {
    en: 'Modified',
    fr: 'Modifié',
  },
  'git.status.added': {
    en: 'Added',
    fr: 'Ajouté',
  },
  'git.status.deleted': {
    en: 'Deleted',
    fr: 'Supprimé',
  },
  'git.status.renamed': {
    en: 'Renamed',
    fr: 'Renommé',
  },
  'git.status.copied': {
    en: 'Copied',
    fr: 'Copié',
  },

  // Git - Diff view
  'git.diff.unified': {
    en: 'Unified',
    fr: 'Unifié',
  },
  'git.diff.split': {
    en: 'Split',
    fr: 'Divisé',
  },
  'git.diff.wrap': {
    en: 'Wrap',
    fr: 'Retour à la ligne',
  },

  // GitHub - Tabs
  'github.tab.issues': {
    en: 'Issues',
    fr: 'Issues',
  },
  'github.tab.pullRequests': {
    en: 'Pull requests',
    fr: 'Pull requests',
  },

  // GitHub - States
  'github.state.open': {
    en: 'Open',
    fr: 'Ouvert',
  },
  'github.state.closed': {
    en: 'Closed',
    fr: 'Fermé',
  },
  'github.state.merged': {
    en: 'Merged',
    fr: 'Fusionné',
  },
  'github.state.draft': {
    en: 'Draft',
    fr: 'Brouillon',
  },

  // GitHub - PR Status
  'github.pr.readyToMerge': {
    en: 'Ready to merge',
    fr: 'Prêt à fusionner',
  },
  'github.pr.mergeBlocked': {
    en: 'Merge blocked',
    fr: 'Fusion bloquée',
  },
  'github.pr.conflictsMustBeResolved': {
    en: 'Conflicts must be resolved',
    fr: 'Les conflits doivent être résolus',
  },
  'github.pr.merging': {
    en: 'Merging…',
    fr: 'Fusion en cours…',
  },

  // GitHub - Actions
  'github.action.merge': {
    en: 'Merge',
    fr: 'Fusionner',
  },
  'github.action.close': {
    en: 'Close',
    fr: 'Fermer',
  },
  'github.action.reopen': {
    en: 'Reopen',
    fr: 'Rouvrir',
  },
  'github.action.review': {
    en: 'Review',
    fr: 'Réviser',
  },
  'github.action.comment': {
    en: 'Comment',
    fr: 'Commenter',
  },
  'github.action.approve': {
    en: 'Approve',
    fr: 'Approuver',
  },
  'github.action.requestChanges': {
    en: 'Request changes',
    fr: 'Demander des modifications',
  },

  // GitHub - Labels
  'github.label.comments': {
    en: 'comments',
    fr: 'commentaires',
  },
  'github.label.files': {
    en: 'files',
    fr: 'fichiers',
  },
  'github.label.changes': {
    en: 'changes',
    fr: 'modifications',
  },
  'github.label.checks': {
    en: 'checks',
    fr: 'vérifications',
  },

  // GitHub - Messages
  'github.loading': {
    en: 'Loading…',
    fr: 'Chargement…',
  },
  'github.noItems': {
    en: 'No items',
    fr: 'Aucun élément',
  },
  'github.couldNotLoad': {
    en: 'Could not load',
    fr: 'Impossible de charger',
  },

  // Skills
  'skills.title': {
    en: 'Skills',
    fr: 'Compétences',
  },
  'skills.refresh': {
    en: 'Refresh',
    fr: 'Actualiser',
  },
  'skills.filterPlaceholder': {
    en: 'Filter skills…',
    fr: 'Filtrer les compétences…',
  },
  'skills.couldNotLoad': {
    en: 'Could not load skills',
    fr: 'Impossible de charger les compétences',
  },
  'skills.noSkills': {
    en: 'No skills',
    fr: 'Aucune compétence',
  },
  'skills.import': {
    en: 'Import',
    fr: 'Importer',
  },
  'skills.available': {
    en: 'Available',
    fr: 'Disponibles',
  },
  'skills.installed': {
    en: 'Installed',
    fr: 'Installées',
  },
  'skills.updateAvailable': {
    en: 'Update available',
    fr: 'Mise à jour disponible',
  },

  // Skills - Actions
  'skills.action.install': {
    en: 'Install',
    fr: 'Installer',
  },
  'skills.action.update': {
    en: 'Update',
    fr: 'Mettre à jour',
  },
  'skills.action.remove': {
    en: 'Remove',
    fr: 'Supprimer',
  },
  'skills.action.use': {
    en: 'Use',
    fr: 'Utiliser',
  },

  // Workflows
  'workflows.title': {
    en: 'Workflows',
    fr: 'Workflows',
  },
  'workflows.subtitle': {
    en: 'Portable skill chains — the agent applies them top to bottom.',
    fr: 'Chaînes de compétences portables — l\'agent les applique de haut en bas.',
  },
  'workflows.workflowName': {
    en: 'Workflow name',
    fr: 'Nom du workflow',
  },
  'workflows.description': {
    en: 'Description',
    fr: 'Description',
  },
  'workflows.steps': {
    en: 'steps',
    fr: 'étapes',
  },
  'workflows.step': {
    en: 'step',
    fr: 'étape',
  },

  // Workflows - Actions
  'workflows.action.auto': {
    en: 'Auto',
    fr: 'Auto',
  },
  'workflows.action.import': {
    en: 'Import',
    fr: 'Importer',
  },
  'workflows.action.export': {
    en: 'Export',
    fr: 'Exporter',
  },
  'workflows.action.save': {
    en: 'Save',
    fr: 'Enregistrer',
  },
  'workflows.action.delete': {
    en: 'Delete',
    fr: 'Supprimer',
  },
  'workflows.action.new': {
    en: 'New',
    fr: 'Nouveau',
  },
  'workflows.action.copy': {
    en: 'Copy',
    fr: 'Copier',
  },

  // Workflows - Messages
  'workflows.autoTitle': {
    en: 'Describe a chain — the agent builds it',
    fr: 'Décrivez une chaîne — l\'agent la construit',
  },
  'workflows.deleteTitle': {
    en: 'Delete the saved workflow file',
    fr: 'Supprimer le fichier workflow enregistré',
  },
  'workflows.exportTitle': {
    en: 'Download workflow.yaml',
    fr: 'Télécharger workflow.yaml',
  },
  'workflows.descriptionPlaceholder': {
    en: 'e.g. Fix the bug, run the tests, then review the diff for regressions.',
    fr: 'ex. Corriger le bug, exécuter les tests, puis réviser le diff pour les régressions.',
  },
  'workflows.importPlaceholder': {
    en: 'name: my-flow\nskills:\n  - test-conventions\n  - commit-style',
    fr: 'name: mon-workflow\nskills:\n  - test-conventions\n  - commit-style',
  },
  'workflows.filterSkillsPlaceholder': {
    en: 'Filter skills…',
    fr: 'Filtrer les compétences…',
  },
  'workflows.noWorkflows': {
    en: 'No workflows',
    fr: 'Aucun workflow',
  },
  'workflows.couldNotLoad': {
    en: 'Could not load workflows',
    fr: 'Impossible de charger les workflows',
  },

  // Settings - Agent
  'settings.agent.title': {
    en: 'Agent',
    fr: 'Agent',
  },
  'settings.agent.defaultRunner': {
    en: 'Default agent',
    fr: 'Agent par défaut',
  },
  'settings.agent.defaultModels': {
    en: 'Default models',
    fr: 'Modèles par défaut',
  },
  'settings.agent.modelsLocked': {
    en: 'Models are locked to the defaults configured in the native coding-agent settings.',
    fr: 'Les modèles sont verrouillés sur les valeurs par défaut configurées dans les paramètres natifs de l\'agent de codage.',
  },
  'settings.agent.modelsHint': {
    en: 'The model preselected in the composer for each runner. Auto lets the runner decide per task.',
    fr: 'Le modèle présélectionné dans le compositeur pour chaque exécuteur. Auto laisse l\'exécuteur décider par tâche.',
  },
  'settings.agent.systemPrompt': {
    en: 'System prompt',
    fr: 'Invite système',
  },
  'settings.agent.systemPromptPlaceholder': {
    en: 'Extra rules for every agent run — conventions, tone, review requirements…',
    fr: 'Règles supplémentaires pour chaque exécution d\'agent — conventions, ton, exigences de révision…',
  },
  'settings.agent.liveTitleUpdates': {
    en: 'Live title updates',
    fr: 'Mises à jour du titre en direct',
  },
  'settings.agent.reviewChanges': {
    en: 'Review changes before finishing',
    fr: 'Réviser les modifications avant de terminer',
  },
  'settings.agent.baseBranch': {
    en: 'Base branch',
    fr: 'Branche de base',
  },
  'settings.agent.couldNotLoad': {
    en: 'Agent settings did not load',
    fr: 'Les paramètres de l\'agent n\'ont pas pu être chargés',
  },

  // Settings - Forges
  'settings.forges.title': {
    en: 'Forges',
    fr: 'Forges',
  },
  'settings.forges.documentation': {
    en: 'Documentation',
    fr: 'Documentation',
  },

  // Settings - Notifications
  'settings.notifications.title': {
    en: 'Notifications',
    fr: 'Notifications',
  },
  'settings.notifications.desktop': {
    en: 'Desktop notifications',
    fr: 'Notifications bureau',
  },
  'settings.notifications.push': {
    en: 'Push notifications',
    fr: 'Notifications push',
  },

  // Settings - Common
  'settings.save': {
    en: 'Save',
    fr: 'Enregistrer',
  },
  'settings.cancel': {
    en: 'Cancel',
    fr: 'Annuler',
  },
  'settings.reset': {
    en: 'Reset',
    fr: 'Réinitialiser',
  },
  'settings.enabled': {
    en: 'Enabled',
    fr: 'Activé',
  },
  'settings.disabled': {
    en: 'Disabled',
    fr: 'Désactivé',
  },
} as const

export type TranslationKey = keyof typeof translations
export type Language = 'en' | 'fr'

export function translate(key: TranslationKey, language: Language): string {
  return translations[key][language]
}
