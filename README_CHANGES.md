# Modifications Suggérées pour README.md

## 1. Section Features (ligne 52-70)

### Modification suggérée:

Remplacer:
```markdown
- 🐙&nbsp;Run the agent straight on a GitHub issue. Nothing merges on its own.
```

Par:
```markdown
- 🐙&nbsp;Run the agent straight on a GitHub, GitLab, Gitea or Forgejo issue. Nothing merges on its own.
```

## 2. Section Features - Ajout

Ajouter après la ligne 64:
```markdown
- 🔗&nbsp;**Multi-forge support**: GitHub, GitLab, Gitea and Forgejo, with auto-detection for self-hosted instances.
```

## 3. Nouvelle section après "Screenshots" (après ligne 108)

Ajouter:
```markdown
## Supported Forges

Cezar works with multiple code forges:

| Forge | Public | Self-Hosted | CLI |
|-------|--------|-------------|-----|
| GitHub | ✅ github.com | ✅ Enterprise | [gh](https://cli.github.com) |
| GitLab | ✅ gitlab.com | ✅ | [glab](https://gitlab.com/gitlab-org/cli) |
| Gitea | ✅ gitea.com | ✅ | [tea](https://gitea.com/gitea/tea) |
| Forgejo | ✅ codeberg.org | ✅ | [tea](https://gitea.com/gitea/tea) |

Cezar automatically detects your forge from the git remote. See [Multi-Forge Support](docs/multi-forge-support.md) for setup instructions.
```

## 4. Section "What you need" (ligne 113+)

### Modification suggérée:

Remplacer:
```markdown
- One of these coding agents: [Claude Code](https://www.anthropic.com/news/claude-desktop-app), [Anthropic Codex](https://codex.dev),
```

Par:
```markdown
- One of these coding agents: [Claude Code](https://www.anthropic.com/news/claude-desktop-app), [Anthropic Codex](https://codex.dev),
```

Ajouter après la liste des agents:
```markdown
- (Optional) Forge CLIs for issue/PR integration:
  - `gh` for GitHub (install: `brew install gh` or see [cli.github.com](https://cli.github.com))
  - `glab` for GitLab (install: `brew install glab` or see [GitLab CLI](https://gitlab.com/gitlab-org/cli))
  - `tea` for Gitea/Forgejo (install: `brew install tea` or see [Gitea Tea](https://gitea.com/gitea/tea))
```

## 5. Section "How it works" (ligne 154+)

### Modification suggérée:

Remplacer:
```markdown
1. **You describe a task.** Type it, attach files, or start from a GitHub issue.
```

Par:
```markdown
1. **You describe a task.** Type it, attach files, or start from a GitHub, GitLab, Gitea or Forgejo issue.
```

## 6. Nouvelle section dans la documentation

Ajouter un lien vers la nouvelle documentation dans la section de navigation principale:

```markdown
<p align="center">
  <a href="https://www.youtube.com/watch?v=nNLJm9gArnE">Demo</a>&nbsp;·
  <a href="#quick-start">Quick start</a>&nbsp;·
  <a href="docs/reference.md">Docs</a>&nbsp;·
  <a href="docs/multi-forge-support.md">Multi-Forge</a>&nbsp;·
  <a href="https://github.com/open-mercato/cezar/issues">Issues</a>
</p>
```

## 7. Section FAQ ou Troubleshooting

Si une section FAQ existe, ajouter:

```markdown
### Does cezar work with GitLab/Gitea/Forgejo?

Yes! Cezar supports GitHub, GitLab, Gitea and Forgejo. It automatically detects your forge from the git remote URL. See [Multi-Forge Support](docs/multi-forge-support.md) for setup instructions.
```

## 8. Fichier README.zh-CN.md et README.zh-TW.md

Les versions traduites devront être mises à jour avec les mêmes modifications (traductions appropriées).

## Exemple de diff complet pour la section principale

```diff
## Features

 - 💯&nbsp;Free and open source.
 - 🖥️&nbsp;Uses your own `claude`, `codex`, `copilot`, `cursor`, `junie`, `opencode` or `pi` login. No API key needed.
 - ☁️&nbsp;Easy to set up on a VPS, so your agents keep working when your laptop is closed.
 - 📱&nbsp;Fully responsive. Start and review tasks from your phone.
 - 🔀&nbsp;Every task gets its own git worktree, so several agents can work at the same time. Extra tasks wait in a queue.
 - 🤖&nbsp;Turn on **Autonomous** and a run never stops to ask. It just finishes.
 - 📡&nbsp;Watch it work live: agent text, tool calls, tokens and cost.
 - 🏁&nbsp;Run the same task ×2 or ×3, compare the diffs and keep the best one.
 - 🧩&nbsp;Skills are Markdown files and workflows are short YAML files. Mix agents per step.
-- 🐙&nbsp;Run the agent straight on a GitHub issue. Nothing merges on its own.
+- 🐙&nbsp;Run the agent straight on a GitHub, GitLab, Gitea or Forgejo issue. Nothing merges on its own.
+- 🔗&nbsp;**Multi-forge support**: GitHub, GitLab, Gitea and Forgejo, with auto-detection for self-hosted instances.
 - 📂&nbsp;One cockpit for all your projects.
 - 📊&nbsp;A workspace dashboard shows what needs you, what is running and what finished across your projects.
 - 💸&nbsp;Track reported cost and token usage by project in **Usage & cost**.
-- ⏰&nbsp;Schedule recurring work or launch tasks from GitHub and supported tracker events with **Automations**.
+- ⏰&nbsp;Schedule recurring work or launch tasks from GitHub, GitLab, Gitea, Forgejo and supported tracker events with **Automations**.
 - 🌳&nbsp;Agents can delegate independent work to child tasks, each in its own worktree, and receive their reports in the parent session.
 - 🎫&nbsp;Connect **Jira or Linear** to browse issues and launch tasks from your project tracker.
 - 💾&nbsp;No database. Everything is saved as plain files in `.ai/cezar/`.
```

## Résumé des changements

1. ✅ Mise à jour des références "GitHub" → "GitHub, GitLab, Gitea or Forgejo"
2. ✅ Ajout d'une nouvelle feature bullet pour multi-forge
3. ✅ Nouvelle section "Supported Forges" avec tableau
4. ✅ Documentation des CLIs optionnels
5. ✅ Lien vers la doc multi-forge
6. ✅ FAQ si applicable

Ces modifications sont **additives** et ne cassent aucune documentation existante.
