# Cas d'Usage : Code Review Automatique

## Vue d'ensemble

Utilisez Cezar pour obtenir des code reviews automatiques de haute qualité, 24/7, avant de soumettre vos PRs.

## Pourquoi ?

- ✅ **Feedback instantané** - Pas besoin d'attendre qu'un collègue soit disponible
- ✅ **Détection précoce** - Trouvez les bugs avant qu'ils atteignent production
- ✅ **Standards cohérents** - Même qualité de review pour tous
- ✅ **Apprentissage** - Améliorez votre code en lisant les suggestions

## Configuration

### 1. Créer le skill de review

`.ai/cezar/skills/code-review.md` :

```markdown
---
name: code-review
description: Standards de code review du projet
---

# Code Review Guidelines

## Sécurité
- Valider toutes les entrées utilisateur
- Pas de secrets en dur dans le code
- Utiliser des requêtes paramétrées (pas de SQL injection)
- Vérifier les permissions avant actions sensibles

## Performance
- Éviter les requêtes N+1
- Pas de calculs lourds dans les boucles
- Utiliser le cache quand approprié
- Limiter la taille des payloads API

## Maintenabilité
- Fonctions < 50 lignes
- Complexité cyclomatique < 10
- Pas de code dupliqué
- Nommage explicite et clair

## Tests
- Couverture > 80%
- Tests des cas limites
- Tests d'erreur
- Tests d'intégration pour les APIs

## Documentation
- Docstrings sur les exports publics
- Commentaires pour la logique complexe
- README à jour
- Exemples d'utilisation
```

### 2. Créer le workflow

`.ai/cezar/workflows/code-review.yaml` :

```yaml
name: code-review
steps:
  - id: analyze
    prompt: |
      Faire une code review complète de : {{task}}
      
      Utiliser une approche structurée :
      
      1. **Vue d'ensemble**
         - Comprendre l'objectif des changements
         - Identifier les fichiers critiques
      
      2. **Analyse approfondie**
         - Sécurité : vulnérabilités potentielles
         - Performance : goulots d'étranglement
         - Maintenabilité : lisibilité, complexité
         - Tests : couverture et qualité
      
      3. **Suggestions**
         - Problèmes critiques (DOIT être corrigé)
         - Améliorations recommandées (DEVRAIT)
         - Optimisations possibles (POURRAIT)
      
      Produire un rapport structuré avec :
      - Résumé exécutif
      - Liste des problèmes par sévérité
      - Extraits de code avec suggestions
      - Score de qualité /10
    skill: code-review
    runner: claude
    
  - id: suggest-fixes
    prompt: |
      Pour les problèmes CRITIQUES et MAJEURS identifiés,
      proposer des corrections concrètes avec exemples de code.
```

## Scénarios d'utilisation

### Scénario 1 : Review avant PR

**Situation** : Vous avez terminé une feature, voulez vérifier avant de créer la PR.

**Commande** :
```bash
# Via CLI
cez task create "Review les changements dans ma branche feature/user-auth"

# Via l'UI
# 1. Cliquez "New task"
# 2. Entrez : "Review ma branche feature/user-auth"
# 3. Workflow : code-review
# 4. Start
```

**Résultat attendu** :
```
Code Review Report - feature/user-auth
Score: 7.5/10

=== CRITICAL ISSUES (2) ===

1. [SECURITY] Plaintext password in auth.ts:45
   > const password = req.body.password;
   > await db.query(`SELECT * FROM users WHERE password='${password}'`);
   
   ISSUE: SQL injection vulnerability
   FIX: Use parameterized query
   
   await db.query('SELECT * FROM users WHERE password = ?', [password]);

2. [SECURITY] No input validation in createUser()
   ISSUE: Missing email validation
   FIX: Add email validation before insertion
   
   if (!isValidEmail(email)) {
     throw new ValidationError('Invalid email');
   }

=== MAJOR ISSUES (3) ===

1. [PERFORMANCE] N+1 query in getUserPosts()
   FILE: posts.ts:78
   ISSUE: Loading posts one by one
   FIX: Use JOIN or batch load

...
```

### Scénario 2 : Review automatique sur PR

**Situation** : Configurer des reviews automatiques sur chaque PR.

**Setup automation** :

`.ai/cezar/automations/pr-review.yaml` :

```yaml
name: auto-review-prs
kind: github
events:
  - pull_request.opened
  - pull_request.synchronize
filters:
  branches:
    - main
    - develop
intervalSeconds: 300  # Poll toutes les 5 minutes
task: "Review le PR #{{number}} : {{title}}"
workflow: code-review
autonomous: true
```

**Activation** :
```bash
# Via l'UI : Settings → Automations → Enable "auto-review-prs"
```

**Résultat** :
- Chaque nouveau PR déclenche une review automatique
- Les commentaires apparaissent dans l'UI Cezar
- Vous pouvez poster les suggestions dans le PR GitHub

### Scénario 3 : Review diff spécifique

**Situation** : Vous voulez une review d'un seul fichier ou composant.

**Commande** :
```
Review le fichier src/auth/jwt-validator.ts en détail.
Checker spécifiquement :
- Gestion des tokens expirés
- Validation de la signature
- Vulnérabilités de timing attack
```

**Tips** : Plus vous êtes spécifique, meilleure est la review.

### Scénario 4 : Review comparative

**Situation** : Comparer deux approches différentes.

**Utiliser variants** :

1. Créer tâche : "Implémenter cache LRU"
2. Lancer ×2 variants
3. Review les deux : "Review et comparer les deux implémentations de cache"
4. Choisir la meilleure

## Bonnes pratiques

### 1. Préparer le contexte

Attachez des fichiers pertinents :
- Architecture diagrams
- Requirements doc
- Related issues

### 2. Poser des questions spécifiques

❌ **Mauvais** :
```
Review mon code
```

✅ **Bon** :
```
Review src/api/payments.ts
Focus sur :
- Gestion des erreurs Stripe
- Race conditions sur les transactions
- Validation des montants
- Tests des remboursements
```

### 3. Itérer sur les suggestions

```
# Première review
Review le PR #123

# Après corrections
Review les corrections du PR #123, vérifier que les problèmes sont résolus
```

### 4. Utiliser avec le mode Autonomous

Pour des reviews nocturnes :
```yaml
# automation.yaml
name: nightly-review
schedule:
  - cron: "0 2 * * *"  # 2h du matin
    task: "Review tous les PRs ouverts"
    workflow: code-review
    autonomous: true
```

## Limitations

### Ce que Cezar PEUT faire :

- ✅ Analyser la structure et logique du code
- ✅ Détecter patterns dangereux connus
- ✅ Vérifier les conventions de code
- ✅ Identifier le code dupliqué
- ✅ Suggérer des améliorations

### Ce que Cezar NE PEUT PAS faire :

- ❌ Comprendre le contexte business complet
- ❌ Tester réellement le code en runtime
- ❌ Détecter des bugs logiques subtils
- ❌ Juger l'UX ou le design
- ❌ Remplacer une review humaine pour les PRs critiques

## Intégration dans le workflow d'équipe

### Étape 1 : Review automatique (Cezar)
- Détection des problèmes évidents
- Vérification des standards
- Suggestions d'amélioration

### Étape 2 : Auto-correction
- Le développeur corrige les problèmes CRITICAL
- Implémente les suggestions pertinentes

### Étape 3 : Review humaine
- Un collègue review avec le contexte business
- Focus sur la logique et l'architecture
- Validation finale

### Résultat
- ⚡ **Reviews plus rapides** - Les humains se concentrent sur ce qui compte
- 🎯 **Qualité améliorée** - Moins de bugs qui passent
- 📚 **Apprentissage** - L'équipe apprend des suggestions Cezar

## Exemples réels

### Exemple 1 : API endpoint review

**Input** :
```
Review src/api/users.ts - nouvel endpoint POST /api/users
```

**Output snippet** :
```
CRITICAL:
- Line 23: Password stored in plaintext
  FIX: Use bcrypt.hash() before saving

MAJOR:
- Line 45: No rate limiting on user creation
  RISK: Spam attacks
  FIX: Add rate limiter middleware

MINOR:
- Line 12: TODO comment left in production code
- Line 67: console.log() should be removed
```

### Exemple 2 : Refactoring review

**Input** :
```
Review mon refactoring de auth/session.ts
Avant : 200 lignes, complexité 15
Maintenant : 3 fichiers, ~70 lignes chacun
Vérifier que je n'ai rien cassé
```

**Output snippet** :
```
POSITIVE:
✅ Complexité réduite à ~6 par fichier
✅ Bonne séparation des responsabilités
✅ Tests all passing

CONCERNS:
⚠️ La fonction validateToken() est dupliquée
   dans jwt-validator.ts et session-manager.ts
   
⚠️ Le timeout de session est hardcodé
   Suggestion: Move to config
```

## Métriques de succès

Suivez l'impact des reviews Cezar :

- **Bugs détectés avant production** - Combien Cezar a trouvé ?
- **Temps de review** - Combien économisé ?
- **Qualité du code** - Score moyen avant/après ?
- **Apprentissage** - Problèmes récurrents résolus ?

## Ressources

- [Workflow template](../workflows/code-review.yaml)
- [Skill template](../skills/code-review.md)
- [GitHub Actions integration](../ci-cd/cezar-review-action.yml)

---

**Prochaine étape** : [Cas d'usage - Maintenance régulière](maintenance-automation.md)
