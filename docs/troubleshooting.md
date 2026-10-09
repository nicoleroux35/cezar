# Résolution de Problèmes - Cezar

Guide de diagnostic et solutions aux problèmes courants.

## 🚨 Problèmes de démarrage

### "No agent CLI found"

**Symptôme** : Le serveur démarre mais dit qu'aucun agent n'est disponible.

**Causes** :
- Aucun agent CLI installé
- L'agent n'est pas dans le PATH
- L'agent n'est pas authentifié

**Solutions** :

1. **Vérifier les agents installés** :
   ```bash
   which claude codex opencode cursor junie
   ```

2. **Installer un agent** :
   ```bash
   # Claude Code
   npm install -g @anthropics/claude-code
   claude login
   
   # Codex
   npm install -g @openai/codex
   codex auth login
   
   # OpenCode
   npm install -g opencode
   opencode login
   ```

3. **Vérifier l'authentification** :
   ```bash
   claude --version  # Doit fonctionner sans erreur
   ```

4. **Mode démo temporaire** :
   ```bash
   CEZ_DRY_RUN=1 npx cezar-run
   ```

---

### "Port 4321 already in use"

**Symptôme** : `Error: listen EADDRINUSE: address already in use :::4321`

**Solutions** :

1. **Utiliser un autre port** :
   ```bash
   PORT=8080 npx cezar-run
   ```

2. **Tuer le processus existant** :
   ```bash
   # Trouver le PID
   lsof -i :4321
   
   # Tuer le processus
   kill -9 <PID>
   ```

3. **Vérifier qu'aucune autre instance ne tourne** :
   ```bash
   ps aux | grep cezar
   ```

---

### "Not a git repository"

**Symptôme** : Cezar démarre mais dit que le répertoire n'est pas un repo git.

**Solutions** :

1. **Initialiser git** :
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   ```

2. **Vérifier le repo** :
   ```bash
   git status  # Doit montrer le statut git
   ```

3. **Travailler sans git** (déconseillé) :
   - Cezar fonctionnera en mode dégradé
   - Pas de worktrees isolés
   - Pas de diffs propres

---

## 🔄 Problèmes d'exécution

### Les tâches restent en status "queued"

**Symptôme** : Les nouvelles tâches ne démarrent jamais.

**Causes** :
- Limite `maxParallel` atteinte
- Tâches bloquées qui ne terminent pas
- Ressources système insuffisantes

**Solutions** :

1. **Vérifier les tâches en cours** :
   - Regardez le dashboard
   - Combien de tâches sont "running" ?

2. **Augmenter maxParallel** :
   ```json
   // .ai/cezar/config.json
   {
     "maxParallel": 5
   }
   ```

3. **Arrêter les tâches bloquées** :
   - Dans l'UI, cliquez "Abandon" sur les tâches stuck

4. **Redémarrer cezar** :
   ```bash
   # Ctrl+C puis
   npx cezar-run
   ```

---

### L'agent répète la même erreur en boucle

**Symptôme** : L'agent échoue, retry, échoue encore avec la même erreur.

**Causes** :
- Test cassé qui ne peut pas passer
- Dépendance manquante
- Environnement mal configuré
- Limite de retry atteinte

**Solutions** :

1. **Lire l'erreur complète** :
   - Cliquez sur l'onglet "Session"
   - Scrollez jusqu'au dernier échec
   - Lisez la sortie d'erreur complète

2. **Vérifier votre environnement localement** :
   ```bash
   npm test  # Est-ce que ça passe manuellement ?
   npm run build
   ```

3. **Ajuster le workflow** :
   ```yaml
   steps:
     - id: test
       command: "npm test"
       onFail: { retry: implement, max: 5 }  # Plus de retries
   ```

4. **Donner plus de contexte** :
   - Cliquez "Continue"
   - Ajoutez un message expliquant l'erreur
   - Donnez des indices de solution

---

### "Memory limit exceeded"

**Symptôme** : La tâche s'arrête avec une erreur de mémoire.

**Solutions** :

1. **Augmenter la limite** :
   ```json
   // .ai/cezar/config.json
   {
     "memoryLimitMb": 8192
   }
   ```

2. **Vérifier la mémoire système** :
   ```bash
   free -h  # Linux
   vm_stat  # macOS
   ```

3. **Fermer d'autres applications**

4. **Simplifier la tâche** :
   - Diviser en plusieurs sous-tâches plus petites
   - Réduire le scope

---

### Worktree ne se nettoie pas

**Symptôme** : Des répertoires `.ai/cezar/worktrees/*` restent après abandon.

**Solutions** :

1. **Nettoyage manuel** :
   ```bash
   git worktree prune
   rm -rf .ai/cezar/worktrees/*
   ```

2. **Vérifier les worktrees orphelins** :
   ```bash
   git worktree list
   ```

3. **Redémarrer cezar** (il nettoie au démarrage)

---

## 🔐 Problèmes d'authentification

### "gh authentication required"

**Symptôme** : L'onglet GitHub ne charge pas, dit "gh CLI not authenticated".

**Solutions** :

1. **Authentifier gh** :
   ```bash
   gh auth login
   ```

2. **Vérifier l'authentification** :
   ```bash
   gh auth status
   ```

3. **Utiliser un token** :
   ```bash
   export GITHUB_TOKEN=ghp_your_token_here
   ```

---

### "glab authentication required" (GitLab)

**Solutions** :

1. **Installer glab** :
   ```bash
   brew install glab  # macOS
   # Ou télécharger depuis https://gitlab.com/gitlab-org/cli
   ```

2. **Authentifier** :
   ```bash
   glab auth login
   ```

---

### "tea authentication required" (Gitea/Forgejo)

**Solutions** :

1. **Installer tea** :
   ```bash
   brew install tea  # macOS
   # Ou télécharger depuis https://gitea.com/gitea/tea
   ```

2. **Configurer** :
   ```bash
   tea login add
   ```

---

## 📊 Problèmes de performance

### L'UI est lente

**Causes** :
- Trop de tâches dans l'historique
- Session avec énormément d'événements
- Navigateur surchargé

**Solutions** :

1. **Nettoyer l'historique** :
   ```bash
   # Sauvegarder d'abord !
   cp -r .ai/cezar .ai/cezar.backup
   
   # Supprimer les anciennes tâches
   rm .ai/cezar/runs/*.ndjson  # Garder runs.json
   ```

2. **Recharger la page**

3. **Utiliser un navigateur différent**

4. **Augmenter la RAM Node** :
   ```bash
   NODE_OPTIONS="--max-old-space-size=4096" npx cezar-run
   ```

---

### Builds très lents

**Symptôme** : `npm run build` prend plusieurs minutes.

**Solutions** :

1. **Nettoyer et reconstruire** :
   ```bash
   rm -rf node_modules package-lock.json
   npm install
   npm run build
   ```

2. **Vérifier l'espace disque** :
   ```bash
   df -h
   ```

3. **Désactiver les source maps** (temporaire) :
   ```bash
   NODE_ENV=production npm run build
   ```

---

## 🌐 Problèmes réseau

### "Failed to fetch" dans l'UI

**Symptôme** : L'UI affiche des erreurs réseau, impossible de charger les données.

**Solutions** :

1. **Vérifier que le serveur tourne** :
   ```bash
   curl http://localhost:4321/api/v1/health
   ```

2. **Vérifier les logs serveur** :
   - Regardez le terminal où cezar tourne
   - Y a-t-il des erreurs ?

3. **Recharger la page**

4. **Vider le cache navigateur** :
   - Chrome : Ctrl+Shift+R
   - Firefox : Ctrl+F5

---

### "Cannot connect to remote server"

**Symptôme** : Impossible d'accéder à cezar hébergé sur un VPS.

**Solutions** :

1. **Vérifier le service** :
   ```bash
   ssh user@server
   sudo systemctl status cezar
   ```

2. **Vérifier les logs** :
   ```bash
   sudo journalctl -u cezar -f
   ```

3. **Vérifier le firewall** :
   ```bash
   sudo ufw status
   sudo ufw allow 443/tcp
   ```

4. **Tester localement** :
   ```bash
   curl https://your-server.com/api/v1/health
   ```

---

## 🐛 Problèmes spécifiques aux agents

### Claude Code timeout

**Symptôme** : "Claude did not respond within 120s"

**Solutions** :

1. **Augmenter le timeout** :
   ```json
   // .ai/cezar/config.json
   {
     "agentTimeout": 300000  // 5 minutes en ms
   }
   ```

2. **Vérifier votre connexion internet**

3. **Simplifier la tâche** (moins de contexte)

---

### OpenCode "experimental features"

**Symptôme** : Warning sur features expérimentales.

**Note** : OpenCode est stable, les warnings seront retirés prochainement.

**Solutions** :

1. **Ignorer le warning** (safe)

2. **Utiliser Claude ou Codex** si vous préférez des outils établis

---

### Cursor ne démarre pas

**Symptôme** : "cursor command not found"

**Solutions** :

1. **Vérifier l'installation** :
   ```bash
   which cursor
   ```

2. **Ajouter au PATH** :
   ```bash
   export PATH="/Applications/Cursor.app/Contents/Resources/app/bin:$PATH"
   ```

3. **Utiliser le CLI Cursor** :
   ```bash
   cursor --version
   ```

---

## 📁 Problèmes de fichiers

### "Permission denied" lors du commit

**Symptôme** : Impossible de commit depuis l'UI.

**Solutions** :

1. **Vérifier les permissions** :
   ```bash
   ls -la .git
   ```

2. **Corriger les permissions** :
   ```bash
   chmod -R u+w .git
   ```

3. **Commit manuellement** :
   ```bash
   cd .ai/cezar/worktrees/<runId>
   git add .
   git commit -m "Task result"
   ```

---

### Config JSON corrompu

**Symptôme** : Cezar ne démarre pas, erreur de parsing JSON.

**Solutions** :

1. **Valider le JSON** :
   ```bash
   cat .ai/cezar/config.json | jq .
   ```

2. **Restaurer depuis backup** :
   ```bash
   cp ~/.cezar/config.json.bak ~/.cezar/config.json
   ```

3. **Supprimer et recommencer** :
   ```bash
   mv .ai/cezar/config.json .ai/cezar/config.json.old
   # Cezar recréera un fichier vierge
   ```

---

## 🔍 Diagnostic avancé

### Activer les logs debug

```bash
DEBUG=cezar:* npx cezar-run
```

### Vérifier la santé complète

```bash
curl http://localhost:4321/api/v1/health | jq .
```

### Inspecter l'état workspace

```bash
cat ~/.cezar/config.json | jq .
```

### Vérifier les worktrees

```bash
git worktree list
```

### Logs système (serveur)

```bash
# systemd
sudo journalctl -u cezar -f --since today

# PM2
pm2 logs cezar
```

---

## 🆘 Obtenir de l'aide

Si vous ne trouvez pas la solution :

1. **Cherchez dans les issues** : https://github.com/open-mercato/cezar/issues
2. **Créez une issue** avec :
   - Version de cezar (`npx cezar-run --version`)
   - Système d'exploitation
   - Agent utilisé
   - Logs d'erreur complets
   - Steps pour reproduire
3. **Joignez-vous au Discord** (lien dans le README)

---

## 🔧 Réinitialisation complète

En dernier recours :

```bash
# Sauvegarder vos workflows et skills
cp -r .ai/cezar/workflows ~/cezar-backup/
cp -r .ai/cezar/skills ~/cezar-backup/

# Nettoyer complètement
rm -rf .ai/cezar
rm -rf ~/.cezar
rm -rf ~/.cache/cez

# Redémarrer
npx cezar-run

# Restaurer vos fichiers
cp -r ~/cezar-backup/workflows .ai/cezar/
cp -r ~/cezar-backup/skills .ai/cezar/
```

⚠️ **Vous perdrez l'historique des tâches** mais cezar repartira sur des bases saines.
