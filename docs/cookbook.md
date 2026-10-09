# Cookbook - Recettes de Workflows Cezar

Collection de workflows éprouvés pour tâches courantes.

## 📚 Table des matières

- [Développement](#développement)
- [Tests & QA](#tests--qa)
- [Maintenance](#maintenance)
- [Documentation](#documentation)
- [CI/CD](#cicd)
- [Sécurité](#sécurité)

---

## Développement

### Fix un bug avec tests automatiques

```yaml
name: bug-fix-with-tests
steps:
  - id: analyze
    prompt: |
      Analyser le bug : {{task}}
      1. Comprendre la cause racine
      2. Identifier les fichiers impactés
      3. Proposer une solution
    runner: claude
    
  - id: implement
    prompt: |
      Implémenter le fix pour : {{task}}
      Assurer que le code est propre et bien commenté.
    skill: coding-standards
    
  - id: test
    command: "npm test"
    onFail: { retry: implement, max: 3 }
    
  - id: verify
    prompt: "Vérifier que le fix résout bien le problème initial sans régression"
```

**Utilisation** :
```
Fix le bug où la pagination échoue avec plus de 1000 items
```

---

### Feature complète avec documentation

```yaml
name: feature-with-docs
steps:
  - id: design
    prompt: |
      Concevoir l'architecture pour : {{task}}
      - Structure des fichiers
      - Interfaces et types
      - Points d'intégration
    runner: claude
    
  - id: implement
    prompt: "Implémenter la feature selon le design précédent"
    skill: typescript-conventions
    
  - id: test
    prompt: "Écrire des tests unitaires complets pour la nouvelle feature"
    skill: testing-patterns
    
  - id: verify-tests
    command: "npm test"
    onFail: { retry: test, max: 2 }
    
  - id: document
    prompt: |
      Créer la documentation :
      1. README.md avec exemples
      2. Docstrings dans le code
      3. Guide d'utilisation
    
  - id: integration
    prompt: "Vérifier l'intégration avec le reste du système"
    command: "npm run build && npm run lint"
```

**Utilisation** :
```
Ajouter un système de plugins avec hot reload et API de hooks
```

---

### Refactoring avec préservation des tests

```yaml
name: safe-refactor
steps:
  - id: baseline
    command: "npm test"
    
  - id: analyze
    prompt: |
      Analyser le code à refactoriser : {{task}}
      Identifier :
      - Code dupliqué
      - Abstractions manquantes
      - Points d'amélioration
    
  - id: refactor
    prompt: |
      Refactoriser selon l'analyse.
      IMPORTANT : Ne pas modifier le comportement, seulement la structure.
    skill: refactoring-principles
    
  - id: verify-tests
    command: "npm test"
    onFail: { retry: refactor, max: 2 }
    
  - id: verify-build
    command: "npm run build"
```

**Utilisation** :
```
Refactoriser le module auth/ pour séparer validation, sessions et middleware
```

---

## Tests & QA

### Code review automatique

```yaml
name: auto-review
steps:
  - id: review
    prompt: |
      Faire une review complète de : {{task}}
      
      Vérifier :
      1. **Sécurité**
         - Injection SQL/XSS
         - Validation des entrées
         - Gestion des secrets
      
      2. **Performance**
         - Requêtes N+1
         - Fuites mémoire
         - Algorithmes inefficaces
      
      3. **Maintenabilité**
         - Complexité cyclomatique
         - Duplication de code
         - Nommage clair
      
      4. **Tests**
         - Couverture adéquate
         - Cas limites
         - Tests d'intégration
      
      Produire un rapport détaillé avec exemples.
    runner: claude
    
  - id: suggest
    prompt: "Proposer des corrections pour les problèmes identifiés"
```

**Utilisation** :
```
Review le PR #145 avant merge
```

---

### Tests E2E avec retry

```yaml
name: e2e-testing
steps:
  - id: setup
    command: "npm run test:setup"
    
  - id: generate-tests
    prompt: |
      Générer des tests E2E pour : {{task}}
      Utiliser Playwright/Cypress selon le projet.
      Couvrir :
      - Happy paths
      - Erreurs utilisateur
      - Cas limites
    skill: e2e-patterns
    
  - id: run-tests
    command: "npm run test:e2e"
    onFail: { retry: generate-tests, max: 3 }
    
  - id: teardown
    command: "npm run test:teardown"
```

**Utilisation** :
```
Créer des tests E2E pour le flow d'inscription utilisateur
```

---

## Maintenance

### Mise à jour dépendances

```yaml
name: update-dependencies
steps:
  - id: check
    command: "npm outdated"
    
  - id: analyze
    prompt: |
      Analyser les dépendances outdated : {{task}}
      Identifier :
      - Breaking changes potentiels
      - Ordre de mise à jour recommandé
      - Risques de compatibilité
    
  - id: update
    prompt: |
      Mettre à jour les dépendances de manière incrémentale.
      Commencer par les patches, puis les minors, enfin les majors.
    
  - id: test
    command: "npm test"
    onFail: { retry: update, max: 2 }
    
  - id: verify-build
    command: "npm run build"
```

**Utilisation** :
```
Mettre à jour toutes les dépendances npm
```

---

### Nettoyage de code mort

```yaml
name: cleanup-dead-code
steps:
  - id: find
    prompt: |
      Identifier le code mort dans : {{task}}
      - Imports non utilisés
      - Functions jamais appelées
      - Variables non référencées
      - Fichiers obsolètes
    runner: claude
    
  - id: remove
    prompt: |
      Supprimer le code mort identifié.
      Vérifier avec grep que rien n'est référencé ailleurs.
    
  - id: verify
    command: "npm run typecheck && npm test"
    
  - id: lint
    command: "npm run lint -- --fix"
```

**Utilisation** :
```
Nettoyer le code mort dans src/legacy/
```

---

### Migration de code

```yaml
name: migrate-code
steps:
  - id: analyze
    prompt: |
      Analyser la migration : {{task}}
      Plan :
      1. État actuel
      2. État cible
      3. Étapes de migration
      4. Compatibilité backward
    
  - id: migrate
    prompt: |
      Exécuter la migration selon le plan.
      Garder un layer de compatibilité si nécessaire.
    skill: migration-patterns
    
  - id: deprecate
    prompt: "Ajouter des warnings de dépréciation sur l'ancien code"
    
  - id: test-old
    command: "npm test -- src/legacy"
    
  - id: test-new
    command: "npm test -- src/new"
```

**Utilisation** :
```
Migrer de Redux à Zustand en gardant la compatibilité
```

---

## Documentation

### Documentation API

```yaml
name: api-documentation
steps:
  - id: generate
    prompt: |
      Générer la documentation API pour : {{task}}
      
      Pour chaque endpoint :
      - Méthode HTTP
      - Path et paramètres
      - Body schema
      - Response schema
      - Exemples curl
      - Codes d'erreur
    runner: claude
    
  - id: openapi
    prompt: "Générer le fichier OpenAPI/Swagger spec.yaml"
    
  - id: readme
    prompt: "Mettre à jour le README.md avec liens vers la doc"
```

**Utilisation** :
```
Documenter tous les endpoints /api/v1/forge
```

---

### Guide utilisateur

```yaml
name: user-guide
steps:
  - id: outline
    prompt: |
      Créer un outline pour : {{task}}
      Structure recommandée :
      - Introduction
      - Quick start
      - Concepts clés
      - Exemples pratiques
      - FAQ
      - Troubleshooting
    
  - id: write
    prompt: |
      Rédiger le guide complet.
      Ton : Amical, clair, pratique
      Inclure : Screenshots, exemples de code, astuces
    skill: technical-writing
    
  - id: review
    prompt: "Relire et améliorer la clarté"
```

**Utilisation** :
```
Créer un guide utilisateur pour le système de plugins
```

---

## CI/CD

### Pipeline CI complet

```yaml
name: ci-pipeline
steps:
  - id: design
    prompt: |
      Concevoir un pipeline CI/CD pour : {{task}}
      
      Étapes :
      1. Lint & Typecheck
      2. Tests unitaires
      3. Tests d'intégration
      4. Tests E2E
      5. Build
      6. Deploy (preview)
    
  - id: implement-lint
    prompt: "Créer le job de linting dans .github/workflows/"
    
  - id: implement-test
    prompt: "Créer le job de tests avec coverage"
    
  - id: implement-build
    prompt: "Créer le job de build et artifacts"
    
  - id: implement-deploy
    prompt: "Créer le job de deployment avec rollback"
    
  - id: verify
    prompt: "Tester le workflow localement avec act"
    command: "act pull_request"
```

**Utilisation** :
```
Mettre en place CI/CD GitHub Actions pour le projet
```

---

### Optimisation Docker

```yaml
name: optimize-docker
steps:
  - id: analyze
    prompt: |
      Analyser le Dockerfile actuel : {{task}}
      Identifier :
      - Layers inutiles
      - Opportunités de cache
      - Taille de l'image
      - Vulnerabilités
    
  - id: optimize
    prompt: |
      Optimiser le Dockerfile :
      - Multi-stage build
      - .dockerignore
      - Minimiser les layers
      - Utiliser Alpine quand possible
    skill: docker-best-practices
    
  - id: build
    command: "docker build -t app:optimized ."
    
  - id: compare
    command: "docker images | grep app"
```

**Utilisation** :
```
Optimiser le Dockerfile pour réduire la taille de l'image
```

---

## Sécurité

### Audit de sécurité

```yaml
name: security-audit
steps:
  - id: scan-deps
    command: "npm audit"
    
  - id: analyze
    prompt: |
      Audit de sécurité complet : {{task}}
      
      Vérifier :
      1. **Input validation**
         - SQL injection
         - XSS
         - Path traversal
      
      2. **Authentication**
         - Hash de mots de passe
         - Session management
         - JWT sécurisé
      
      3. **Authorization**
         - RBAC correct
         - Vérifications de permissions
      
      4. **Data protection**
         - Secrets chiffrés
         - HTTPS only
         - CORS configuré
    runner: claude
    
  - id: fix
    prompt: "Corriger les vulnérabilités identifiées"
    
  - id: verify
    command: "npm audit fix && npm test"
```

**Utilisation** :
```
Faire un audit de sécurité du module auth
```

---

### Mise à jour sécurité urgente

```yaml
name: security-hotfix
steps:
  - id: analyze
    prompt: |
      Analyser la CVE : {{task}}
      - Impact sur notre code
      - Vecteur d'attaque
      - Solution recommandée
    
  - id: patch
    prompt: "Appliquer le patch de sécurité"
    
  - id: test-exploit
    prompt: "Vérifier que l'exploit ne fonctionne plus"
    
  - id: test-regression
    command: "npm test"
    
  - id: emergency-deploy
    prompt: "Préparer les notes de release pour déploiement urgent"
```

**Utilisation** :
```
Patcher CVE-2024-1234 dans la dépendance express
```

---

## 🎯 Conseils d'utilisation

### Composition de workflows

Combinez des workflows avec dispatch :

```yaml
name: full-feature
steps:
  - id: implement
    skill: feature-template
    
  - id: test
    dispatch:
      task: "Écrire tests pour la feature"
      workflow: testing-suite
      
  - id: document
    dispatch:
      task: "Documenter la feature"
      workflow: api-documentation
```

### Skills réutilisables

Créez des skills génériques :

```markdown
---
name: coding-standards
---

## Standards TypeScript
- Utiliser `const` et `let`, jamais `var`
- Types explicites sur les exports publics
- Interfaces pour les objets, types pour les unions
- Préférer `async/await` aux Promises

## Nommage
- camelCase pour variables et fonctions
- PascalCase pour classes et types
- UPPER_CASE pour constantes
- Préfixes `is/has/should` pour booléens
```

### Variables dans les prompts

```yaml
prompt: |
  Implémenter {{task}}
  Framework : {{framework}}
  Style : {{style}}
  Tests : {{testFramework}}
```

---

## 📦 Templates prêts à l'emploi

Tous ces workflows sont disponibles dans le dépôt :
https://github.com/open-mercato/cezar-workflows

```bash
# Installer les templates
cd .ai/cezar/workflows
curl -O https://raw.githubusercontent.com/open-mercato/cezar-workflows/main/{workflow}.yaml
```

---

## 💡 Contribuer

Partagez vos workflows sur le repo communautaire !

1. Testez votre workflow sur plusieurs projets
2. Documentez les prérequis
3. Ajoutez des exemples d'utilisation
4. Soumettez une PR

---

Bon coding avec Cezar ! 🚀
