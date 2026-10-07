# Exemples d'utilisation du serveur MCP Cezar

## Scénarios courants

### 1. Créer et suivre une tâche simple

**Dans Claude Desktop :**

```
Utilisateur: Crée une tâche cezar pour ajouter la validation d'email dans le formulaire d'inscription

Claude: [utilise cezar_create_task]
J'ai créé la tâche avec l'ID abc123. Elle utilise le workflow "quick-task" 
avec Claude comme agent. La tâche est actuellement en file d'attente.

Utilisateur: Quel est son statut maintenant ?

Claude: [utilise cezar_get_task]
La tâche abc123 est maintenant en cours d'exécution. L'agent a commencé 
à travailler il y a 2 minutes. Il a déjà fait 3 appels d'outils.

Utilisateur: Montre-moi les changements

Claude: [utilise cezar_get_task_diff]
L'agent a modifié 2 fichiers :
- src/components/SignupForm.tsx : ajout de la validation email
- src/utils/validation.ts : nouvelle fonction validateEmail()

Total : +45 lignes, -3 lignes
```

### 2. Gérer plusieurs tâches en parallèle

```
Utilisateur: Quelles sont mes tâches en cours ?

Claude: [utilise cezar_list_tasks avec status="running"]
Vous avez 3 tâches en cours :
1. abc123 - Validation d'email (running, 5 min)
2. def456 - Correction bug de connexion (running, 12 min)
3. ghi789 - Refactoring du module auth (running, 8 min)

Utilisateur: Annule la tâche ghi789, je vais la reprendre plus tard

Claude: [utilise cezar_cancel_task avec taskId="ghi789"]
La tâche ghi789 a été annulée avec succès.

Utilisateur: Les autres sont terminées ?

Claude: [utilise cezar_get_task pour chacune]
- abc123 : Terminée ! En attente de review. 2 fichiers modifiés.
- def456 : Toujours en cours, l'agent teste la correction.
```

### 3. Utiliser des workflows spécifiques

```
Utilisateur: Crée une tâche pour review le PR #234, utilise le workflow "review"

Claude: [utilise cezar_create_task avec workflow="review"]
J'ai créé la tâche de review avec l'ID xyz890. Elle utilise le workflow 
"review" qui va analyser le code, vérifier les tests, et générer un rapport.

Utilisateur: Quels workflows sont disponibles ?

Claude: [utilise cezar_list_workflows]
Voici les workflows disponibles dans ce projet :
1. quick-task - Tâche rapide en une étape
2. review - Analyse et review de code
3. test-and-fix - Exécute les tests puis corrige les erreurs
4. refactor - Refactoring avec vérification
```

### 4. Interaction avec une tâche en attente

```
Utilisateur: Crée une tâche pour migrer la DB vers PostgreSQL

Claude: [utilise cezar_create_task]
Tâche créée : mno345. L'agent est en train de travailler...

[Quelques minutes plus tard]

Utilisateur: Statut de mno345 ?

Claude: [utilise cezar_get_task]
La tâche est en statut "waiting" - l'agent vous demande quelque chose :
"Voulez-vous que je crée aussi le script de rollback ?"

Utilisateur: Envoie "Oui, crée aussi un script de rollback et documente-le"

Claude: [utilise cezar_send_message]
Message envoyé. L'agent a repris le travail et est maintenant en "running".
```

### 5. Utiliser différents agents

```
Utilisateur: Crée une tâche avec Codex pour optimiser les performances

Claude: [utilise cezar_create_task avec runner="codex"]
Tâche créée avec l'ID pqr678, utilisant Codex comme agent.

Utilisateur: Et une autre avec OpenCode pour la documentation

Claude: [utilise cezar_create_task avec runner="opencode"]
Tâche créée avec l'ID stu901, utilisant OpenCode.
```

### 6. Mode autonome pour les tâches longues

```
Utilisateur: Crée une tâche autonome pour implémenter l'API REST complète

Claude: [utilise cezar_create_task avec autonomous=true]
Tâche autonome créée : vwx234. Elle va s'exécuter jusqu'au bout sans 
interruption pour review. L'agent ne vous demandera pas de validation.

Utilisateur: Combien de tokens a-t-elle consommé ?

Claude: [utilise cezar_get_task]
La tâche vwx234 a consommé 45,230 tokens (32,100 input, 13,130 output).
Coût estimé : $0.23 USD.
```

### 7. Consulter les compétences disponibles

```
Utilisateur: Quelles compétences sont disponibles pour les agents ?

Claude: [utilise cezar_list_skills]
Voici les compétences (skills) disponibles :
1. debug-typescript - Débogage TypeScript avancé
2. react-best-practices - Bonnes pratiques React
3. api-design - Design d'API RESTful
4. security-audit - Audit de sécurité
5. performance-optimization - Optimisation des performances

Ces compétences peuvent être référencées dans vos tâches avec /skill.

Utilisateur: Crée une tâche avec la compétence security-audit

Claude: [utilise cezar_create_task]
Tâche créée : yza456
Task: "Audite la sécurité de l'API /skill security-audit"
```

### 8. Monitoring de l'état du serveur

```
Utilisateur: Est-ce que cezar fonctionne correctement ?

Claude: [utilise cezar_get_health]
Oui, le serveur cezar est opérationnel :
- Version : 2.0.0
- Agents disponibles : claude, codex, opencode
- Capacités : worktrees, variants, automations, dispatch
- Tâches actives : 2
- Slots libres : 2/4
```

## Cas d'usage avancés

### Pipeline de développement complet

```
# Étape 1 : Implémenter la fonctionnalité
Crée une tâche pour implémenter l'authentification OAuth2

# Étape 2 : Review automatique
Quand la tâche est terminée, crée une tâche de review sur le même code

# Étape 3 : Tests
Si la review est OK, crée une tâche pour ajouter les tests unitaires

# Étape 4 : Documentation
Crée une dernière tâche pour documenter l'API OAuth2
```

### Debugging assisté

```
Utilisateur: J'ai une erreur dans mon code, crée une tâche pour la déboguer

Claude: Pouvez-vous me donner plus de détails sur l'erreur ?

Utilisateur: TypeError dans auth.ts ligne 45

Claude: [utilise cezar_create_task]
Tâche créée : debug-001
Task: "Débogue le TypeError dans auth.ts ligne 45 /skill debug-typescript"

Utilisateur: Montre le diff quand c'est fait

Claude: [après quelques minutes, utilise cezar_get_task_diff]
L'agent a corrigé l'erreur. Voici les changements :
- auth.ts : ajout de vérification null sur user.profile
- auth.test.ts : ajout d'un test pour ce cas limite
```

### Refactoring progressif

```
Utilisateur: Je veux refactorer mon code en plusieurs étapes

Claude: D'accord, décomposons :

Étape 1 : [crée cezar_create_task]
"Refactore le module auth pour extraire les constantes"

Étape 2 : [crée cezar_create_task] 
"Refactore le module auth pour utiliser async/await partout"

Étape 3 : [crée cezar_create_task]
"Refactore le module auth pour ajouter le typage strict"

Voulez-vous que je les lance toutes en parallèle ou séquentiellement ?
```

## Intégration avec d'autres outils

### Avec GitHub

```
Utilisateur: Crée une tâche pour le ticket GitHub #123

Claude: [utilise cezar_create_task]
Task: "Implémente la fonctionnalité décrite dans le ticket #123"

Le système cezar va automatiquement lier la tâche au ticket GitHub.
```

### Avec des automations

```
Utilisateur: Configure une automation pour créer une tâche à chaque nouveau PR

Claude: Pour cela, vous devez configurer une automation dans cezar directement.
Mais je peux créer des tâches manuellement quand vous me signalez un nouveau PR.
```

## Bonnes pratiques

### 1. Descriptions de tâches claires

❌ Mauvais :
```
Crée une tâche pour corriger le bug
```

✅ Bon :
```
Crée une tâche pour corriger le bug d'authentification où les utilisateurs 
sont déconnectés après 5 minutes même avec "Remember me" coché
```

### 2. Utiliser les bons workflows

```
# Pour du développement rapide
workflow: "quick-task"

# Pour du code critique
workflow: "review"

# Pour des corrections de bugs
workflow: "test-and-fix"
```

### 3. Surveiller les ressources

```
Avant de créer 10 tâches, vérifie l'état :
[cezar_get_health]

Si tous les slots sont occupés, attends ou annule une tâche peu prioritaire.
```

### 4. Garder une trace des tâches

```
Utilisateur: Liste toutes mes tâches des dernières 24h

Claude: [utilise cezar_list_tasks]
[Garde une référence des IDs importants pour les consulter plus tard]
```

## Dépannage via MCP

```
Utilisateur: Ma tâche xyz789 est bloquée

Claude: [utilise cezar_get_task]
La tâche est en "waiting" depuis 15 minutes. L'agent vous a posé une question.

Utilisateur: Je ne vois pas de question

Claude: Voici la question de l'agent : "Le fichier config.json existe-t-il ?"

Utilisateur: Réponds "Non, crée-le"

Claude: [utilise cezar_send_message]
Message envoyé, la tâche a repris.
```
