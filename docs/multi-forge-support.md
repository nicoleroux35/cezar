# Multi-Forge Support

Cezar now supports multiple code forges beyond GitHub:

## Supported Forges

| Forge | Public Instance | Self-Hosted | CLI Required |
|-------|----------------|-------------|--------------|
| **GitHub** | github.com | ✅ (GitHub Enterprise) | `gh` ([GitHub CLI](https://cli.github.com)) |
| **GitLab** | gitlab.com | ✅ | `glab` ([GitLab CLI](https://gitlab.com/gitlab-org/cli)) |
| **Gitea** | gitea.com | ✅ | `tea` ([Gitea Tea CLI](https://gitea.com/gitea/tea)) |
| **Forgejo** | codeberg.org | ✅ | `tea` ([Gitea Tea CLI](https://gitea.com/gitea/tea)) |

## Features by Forge

All forges support:
- ✅ Issue and PR/MR listing
- ✅ Cross-state search (open, closed, merged)
- ✅ Draft PR/MR creation
- ✅ Web URL generation
- ✅ Dry-run mode (`CEZ_DRY_RUN=1`)

## Auto-Detection

Cezar automatically detects your forge from the git remote:

```bash
# GitHub
git remote add origin git@github.com:owner/repo.git

# GitLab (public)
git remote add origin git@gitlab.com:owner/repo.git

# GitLab (self-hosted)
git remote add origin git@gitlab.company.com:owner/repo.git

# Gitea (self-hosted)
git remote add origin https://gitea.example.com/owner/repo.git

# Forgejo (Codeberg)
git remote add origin git@codeberg.org:owner/repo.git

# Forgejo (self-hosted)
git remote add origin https://forgejo.example.org/owner/repo.git
```

## Setup

### 1. Install the CLI

Each forge requires its own CLI tool:

#### GitHub (gh)
```bash
# macOS
brew install gh

# Linux
# See https://github.com/cli/cli/blob/trunk/docs/install_linux.md

# Authenticate
gh auth login
```

#### GitLab (glab)
```bash
# macOS
brew install glab

# Linux
# Download from https://gitlab.com/gitlab-org/cli/-/releases

# Authenticate
glab auth login
```

#### Gitea/Forgejo (tea)
```bash
# macOS
brew install tea

# Linux
# Download from https://gitea.com/gitea/tea/releases

# Authenticate
tea login add
```

### 2. Configure Authentication

For self-hosted instances, authenticate the CLI with your instance:

```bash
# GitLab self-hosted
glab auth login --hostname gitlab.company.com

# Gitea self-hosted
tea login add --name company --url https://gitea.example.com

# Forgejo self-hosted
tea login add --name forgejo --url https://forgejo.example.org
```

## Usage

Once the CLI is authenticated, cezar automatically uses the correct forge based on your git remote:

### Browse Issues and PRs/MRs

The forge tab adapts to your project:
- GitHub projects show the **GitHub** tab
- GitLab projects show the **GitLab** tab  
- Gitea projects show the **Gitea** tab
- Forgejo projects show the **Forgejo** tab

### Create Draft PRs/MRs

When you finish a task, cezar creates a draft PR/MR on your forge:

```bash
# Works on any supported forge
cezar run "Fix the login bug"
```

The draft PR/MR is created on the same forge as your git remote.

### Launch from Issues

Click any issue in the forge tab to start a task:

```bash
# The task inherits the issue title and description
# Works the same on GitHub, GitLab, Gitea and Forgejo
```

## Self-Hosted Detection

Cezar automatically detects self-hosted instances by hostname patterns:

- `*gitlab*` → GitLab driver
- `*gitea*` → Gitea driver  
- `*forgejo*` → Forgejo driver

Examples:
- `gitlab.company.com` ✅
- `git.gitlab.internal` ✅
- `gitea.example.org` ✅
- `code.forgejo.dev` ✅

## Troubleshooting

### "CLI not found" error

Install and authenticate the required CLI for your forge:

```bash
# Check which CLI you need
git remote -v

# Install and authenticate (see Setup above)
```

### Self-hosted instance not detected

Make sure your hostname includes the forge name:
- ✅ `gitlab.company.com`
- ✅ `gitea.example.org`
- ❌ `git.company.com` (generic, not detected)

You can rename your remote to help detection:
```bash
git remote set-url origin https://gitlab.company.com/owner/repo.git
```

### "Authentication failed" error

Re-authenticate the CLI:

```bash
# GitHub
gh auth login

# GitLab  
glab auth login

# Gitea/Forgejo
tea login add
```

## URL Formats

Each forge has its own URL structure:

### GitHub
- Issues: `https://github.com/owner/repo/issues/123`
- PRs: `https://github.com/owner/repo/pull/456`

### GitLab
- Issues: `https://gitlab.com/owner/repo/-/issues/123`
- MRs: `https://gitlab.com/owner/repo/-/merge_requests/456`

### Gitea
- Issues: `https://gitea.com/owner/repo/issues/123`
- PRs: `https://gitea.com/owner/repo/pulls/456`

### Forgejo
- Issues: `https://codeberg.org/owner/repo/issues/123`
- PRs: `https://codeberg.org/owner/repo/pulls/456`

## Feature Parity

All supported forges now have complete feature parity with GitHub:

### ✅ Fully Supported Features

| Feature | GitHub | GitLab | Gitea | Forgejo |
|---------|--------|--------|-------|---------|
| Issue/PR listing | ✅ | ✅ | ✅ | ✅ |
| Cross-state search | ✅ | ✅ | ✅ | ✅ |
| Draft PR/MR creation | ✅ | ✅ | ✅ | ✅ |
| **Merge state details** | ✅ | ✅ | ✅ | ✅ |
| **Automatic merging** | ✅ | ✅ | ✅ | ✅ |
| **Full PR/MR diffs** | ✅ | ✅ | ✅ | ✅ |
| **CI/CD checks** | ✅ | ✅ | ✅ | ✅ |
| **Comment counts** | ✅ | ✅ | ✅ | ✅ |
| Web URL generation | ✅ | ✅ | ✅ | ✅ |

### New Capabilities (2026-10-07)

**Merge State Details:**
- See if PR/MR is mergeable or has conflicts
- View blocking issues (CI failures, missing approvals, unresolved discussions)
- Check available merge methods (merge/squash/rebase)
- Understand exactly why a PR/MR cannot be merged

**Automatic Merging:**
- Merge PRs/MRs directly from cezar
- Choose merge method (merge commit, squash, or rebase)
- SHA verification prevents race conditions
- Clear error messages for permission or conflict issues

**Full Diffs:**
- View complete file changes for any PR/MR
- See patches with additions/deletions
- Binary file detection
- Handles large diffs gracefully (up to 300 files)

**CI/CD Checks:**
- Display pipeline and job status
- Show individual check results
- Links to check details on forge
- Graceful degradation if checks unavailable

**Accurate Comment Counts:**
- Real comment counts from forge APIs
- Displayed in lists and search results
- No more "0" placeholders

### Known Limitations

**GitLab:**
- Cannot override merge rules via CLI (GitLab API limitation)
- Fine-grained PATs may not access check details (requires `api` scope)

**Gitea/Forgejo:**
- Review decision shows as "unknown" (Gitea has no formal approval system)
- Required vs optional checks not distinguished by API

**All Forges:**
- Timeline events (commits, labels, assignments) only available on GitHub
- Review comment threads not yet supported (only top-level comments)

## Mixed Projects

If you work on projects across different forges, cezar handles each correctly:

```bash
# Project A on GitHub
cd ~/projects/project-a
cezar  # Uses gh CLI

# Project B on GitLab  
cd ~/projects/project-b
cezar  # Uses glab CLI

# Project C on Forgejo
cd ~/projects/project-c
cezar  # Uses tea CLI
```

Each project's forge is detected independently from its git remote.
