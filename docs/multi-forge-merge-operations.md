# Multi-Forge Merge Operations

This guide covers how to use the new merge capabilities across GitHub, GitLab, Gitea, and Forgejo.

## Overview

Cezar now supports full merge operations on all forges:
- Check merge eligibility
- View blocking issues
- Merge PRs/MRs with different strategies
- Handle conflicts gracefully

## Prerequisites

Each forge requires its CLI tool to be installed and authenticated:

```bash
# GitHub
gh auth login

# GitLab
glab auth login

# Gitea/Forgejo
tea login add
```

## Checking Merge State

Before merging, check if a PR/MR is ready:

### Via UI

1. Open the PR/MR in cezar
2. Go to the **Changes** tab
3. Look for the **Merge** section showing:
   - ✅ Ready to merge
   - ⏳ Pending checks
   - ⛔ Blocked (with reasons)

### Via API

```typescript
const mergeState = await driver.prMergeState(prNumber);

if (mergeState.available) {
  const { mergeState: state } = mergeState;
  
  console.log(`Status: ${state.eligibility}`);
  console.log(`Mergeable: ${state.mergeable}`);
  console.log(`Can merge: ${state.canMerge}`);
  
  // Show blockers
  if (state.blockers.length > 0) {
    console.log('Blocked by:');
    state.blockers.forEach(b => {
      console.log(`  - ${b.message}`);
    });
  }
  
  // Show CI checks
  state.checks.forEach(check => {
    console.log(`${check.name}: ${check.state}`);
  });
}
```

## Understanding Merge Eligibility

### Status Types

- **ready** - PR/MR can be merged immediately
- **blocked** - One or more checks are failing
- **pending** - Waiting for checks to complete
- **terminal** - PR/MR is already closed/merged
- **unauthorized** - You don't have permission
- **unknown** - Status cannot be determined

### Common Blockers

| Blocker | Description | Resolution |
|---------|-------------|------------|
| `conflicts` | Merge conflicts exist | Resolve conflicts in the branch |
| `ci` | CI checks failing | Fix failing tests/builds |
| `ci_pending` | CI still running | Wait for checks to complete |
| `draft` | PR/MR is marked as draft | Mark as ready for review |
| `approvals` | Missing required approvals | Get approvals from reviewers |
| `discussions` | Unresolved discussions | Resolve blocking discussions |

## Merging PRs/MRs

### Merge Methods

All forges support three merge strategies:

1. **Merge Commit** - Creates a merge commit preserving all commits
2. **Squash** - Combines all commits into one
3. **Rebase** - Replays commits on top of base branch

### Via UI

1. Open the PR/MR
2. Check merge status shows "Ready to merge"
3. Click **Merge** button
4. Choose merge method
5. Confirm merge

### Via API

```typescript
// Get current merge state
const currentState = await driver.prMergeState(prNumber);

if (!currentState.available || !currentState.mergeState.canMerge) {
  console.error('Cannot merge:', currentState.reason);
  return;
}

// Perform merge
const result = await driver.mergePR(prNumber, {
  method: 'squash', // or 'merge' or 'rebase'
  expectedHeadSha: currentState.mergeState.headSha,
});

if (result.merged) {
  console.log('✅ Merged successfully');
  console.log(`Commit: ${result.mergeCommitSha}`);
  console.log(`URL: ${result.url}`);
} else {
  console.error('❌ Merge failed:', result.error);
  
  // Handle specific errors
  if (result.code === 'conflicts') {
    console.log('Conflicts detected - resolve them first');
  } else if (result.code === 'head_changed') {
    console.log('Branch was updated - refresh and try again');
  }
}
```

## Viewing Diffs

Get complete file changes for any PR/MR:

```typescript
const diff = await driver.prDiff(prNumber);

if (diff.available) {
  console.log(`Files changed: ${diff.files.length}`);
  console.log(`Additions: +${diff.additions}`);
  console.log(`Deletions: -${diff.deletions}`);
  
  diff.files.forEach(file => {
    console.log(`\n${file.status}: ${file.path}`);
    if (file.previousPath) {
      console.log(`  (renamed from ${file.previousPath})`);
    }
    console.log(`  +${file.additions} -${file.deletions}`);
    
    if (file.patch) {
      console.log('Patch:', file.patch.slice(0, 200));
    } else if (file.patchUnavailableReason) {
      console.log(`  Patch unavailable: ${file.patchUnavailableReason}`);
    }
  });
  
  if (diff.truncated) {
    console.log(`\n⚠️  ${diff.reason}`);
  }
}
```

## Forge-Specific Notes

### GitHub

- All features work as before
- Uses `gh` CLI for all operations
- Supports protected branch rules

### GitLab

- Uses `glab api` for direct API access
- Respects approval rules and discussions
- Cannot override merge rules via CLI
- Pipeline details require `api` scope

### Gitea

- Uses `tea api` for REST API calls
- Supports Gitea Actions and external CI
- Review decision shows as "unknown"
- No built-in approval system

### Forgejo

- Same as Gitea (uses `tea` CLI)
- Works with Codeberg and self-hosted instances
- Full compatibility with Gitea features

## Error Handling

### Permission Errors (403)

```
You do not have permission to merge this PR
```

**Solution:** Ask a maintainer with merge permissions to merge, or get your permissions updated.

### Not Found (404)

```
Pull request #123 was not found
```

**Solution:** Verify PR number and that you have access to the repository.

### Conflicts (409)

```
Merge conflicts must be resolved
```

**Solution:** 
1. Pull latest from base branch
2. Resolve conflicts locally
3. Push updated branch
4. Try merge again

### Head Changed (409)

```
The pull request has been updated since you last viewed it
```

**Solution:** Refresh merge state and try again with new SHA.

## Best Practices

### Before Merging

1. ✅ Check merge state is "ready"
2. ✅ Review all CI checks are passing
3. ✅ Ensure required approvals are met
4. ✅ Verify diff looks correct
5. ✅ Check for conflicts

### Choosing Merge Method

- **Merge Commit** - Preserve full history
  - Use for: Feature branches, release merges
  
- **Squash** - Clean linear history
  - Use for: Small features, bug fixes
  
- **Rebase** - Linear history without merge commit
  - Use for: Fast-forward merges, clean history

### Safety Checks

All merge operations include:
- SHA verification (prevents race conditions)
- Permission checks (fail fast on auth errors)
- Conflict detection (before attempting merge)
- State validation (ensures PR/MR is open)

## Troubleshooting

### Merge State Shows "Unknown"

**Causes:**
- CLI not authenticated
- Network issues
- API rate limiting

**Solution:**
```bash
# Re-authenticate
glab auth login  # or gh/tea
```

### CI Checks Not Showing

**Causes:**
- Token lacks required scopes
- CI not configured
- API access restricted

**Solution:**
- Verify CLI authentication has required scopes
- Check CI is enabled on repository
- Review merge state shows checksTier and reason

### Merge Hangs or Times Out

**Causes:**
- Large repository
- Slow network
- API throttling

**Solution:**
- Retry operation
- Check forge status page
- Wait and try again

## Examples

### Complete Workflow

```bash
# 1. Check merge state
cez pr merge-state 42

# 2. View diff
cez pr diff 42

# 3. Merge if ready
cez pr merge 42 --method squash

# 4. Verify merge
cez pr view 42
```

### Automated Merge on CI Success

```typescript
async function autoMerge(prNumber: number) {
  // Poll for ready state
  let attempts = 0;
  const maxAttempts = 30; // 5 minutes
  
  while (attempts < maxAttempts) {
    const state = await driver.prMergeState(prNumber, { refresh: true });
    
    if (!state.available) {
      console.error('Cannot check merge state:', state.reason);
      return;
    }
    
    if (state.mergeState.eligibility === 'ready') {
      // Ready to merge
      const result = await driver.mergePR(prNumber, {
        method: 'squash',
        expectedHeadSha: state.mergeState.headSha,
      });
      
      if (result.merged) {
        console.log('✅ Auto-merged successfully');
        return;
      } else {
        console.error('Merge failed:', result.error);
        return;
      }
    } else if (state.mergeState.eligibility === 'pending') {
      // Wait for checks
      console.log('Waiting for checks...');
      await new Promise(resolve => setTimeout(resolve, 10_000));
      attempts++;
    } else {
      // Blocked
      console.log('Merge blocked:', state.mergeState.blockers);
      return;
    }
  }
  
  console.log('Timeout waiting for checks');
}
```

## Related Documentation

- [Multi-Forge Support](multi-forge-support.md) - General forge setup
- [Issue Trackers](issue-trackers.md) - Jira and Linear integration
- [Reference](reference.md) - Full API documentation
