# High Priority Improvements Implementation Plan

**Date:** 2026-10-07  
**Status:** In Progress  
**Priority:** High

## Context

Two critical improvements identified from codebase analysis:

1. **Stabilize experimental runners** (OpenCode, Junie, pi)
2. **Multi-forge parity** (GitLab/Gitea/Forgejo features matching GitHub)

## 1. Stabilize Experimental Runners

### Current State

- OpenCode, Junie, and pi marked as "experimental" in docs
- `allowedTools` ignored by OpenCode, Junie, Cursor
- No streaming support for non-Claude backends
- Golden fixtures incomplete

### Implementation Tasks

#### 1.1 Remove "experimental" markers
- [ ] Update `docs/reference.md` - remove experimental warnings
- [ ] Update `docs/server-install/*.md` - update installation docs
- [ ] Add stability guarantees to runner documentation

#### 1.2 Implement `allowedTools` support
- [ ] **OpenCode runners**: Map `allowedTools` to OpenCode's permission system
- [ ] **Junie runner**: Implement tool filtering via ACP protocol
- [ ] **Cursor runner**: Add `--allowed-tools` flag mapping
- [ ] Add tests for tool restriction enforcement

#### 1.3 Add streaming support
- [ ] **OpenCode v2**: Implement partial message streaming
- [ ] **Junie/ACP**: Add delta streaming via ACP protocol
- [ ] **pi runner**: Implement JSONL streaming chunks
- [ ] Update UI mappers to handle streaming deltas

#### 1.4 Complete test coverage
- [ ] Add golden fixtures for all experimental runners
- [ ] Add integration tests with tool restrictions
- [ ] Add streaming tests for each runner
- [ ] Ensure dry-run mode works for all

## 2. Multi-Forge Parity

### Current State

GitLab/Gitea/Forgejo missing:
- ❌ `prMergeState` (merge eligibility details)
- ❌ `mergePR` (automatic PR/MR merging)
- ❌ `prDiff` (full file diffs)
- ❌ CI/CD checks display
- ❌ Comment counts (always 0)

### Implementation Tasks

#### 2.1 GitLab Implementation
- [ ] **prMergeState**: Use `glab api` to fetch MR merge status
  - Mergeable status
  - Review decisions (approvals)
  - CI pipeline status
  - Merge methods available
- [ ] **mergePR**: Implement via `glab mr merge`
  - Support merge/squash/rebase methods
  - Handle merge conflicts
  - Respect approval rules
- [ ] **prDiff**: Fetch MR diffs via `glab api`
  - File changes with patches
  - Additions/deletions
  - Binary file detection
- [ ] **Comments/Reviews**: Use GraphQL API for counts
- [ ] **CI Checks**: Parse pipeline status from API

#### 2.2 Gitea Implementation
- [ ] **prMergeState**: Use `tea` API calls
  - Mergeable field from API
  - Review status
  - Checks rollup
- [ ] **mergePR**: Implement via `tea pulls merge`
- [ ] **prDiff**: Fetch via Gitea REST API
- [ ] **Comments**: Parse from API responses
- [ ] **CI Checks**: Support Gitea Actions/Drone

#### 2.3 Forgejo Implementation
- [ ] Same as Gitea (Forgejo is Gitea fork, uses `tea` CLI)
- [ ] Verify compatibility with Forgejo-specific features

#### 2.4 Shared Infrastructure
- [ ] Create common types for forge-agnostic merge state
- [ ] Add caching layer for expensive API calls
- [ ] Error handling and graceful degradation
- [ ] Update contract schemas for new fields

## 3. Documentation Updates

- [ ] Update `docs/multi-forge-support.md` with new features
- [ ] Remove limitations section for implemented features
- [ ] Add examples for merge operations
- [ ] Update API documentation

## 4. Testing Strategy

### Unit Tests
- Each forge driver gets comprehensive test suite
- Mock CLI outputs for all operations
- Test error cases and degradation

### Integration Tests
- Real CLI tests against test repositories
- Dry-run mode coverage
- Golden fixtures for all operations

### E2E Tests
- Full workflow tests with each forge
- Merge conflict handling
- CI check integration

## 5. Backward Compatibility

- All changes are additive to `ForgeDriver` interface
- Existing optional methods remain optional
- New fields in responses are optional
- Old clients continue to work

## 6. Rollout Plan

### Phase 1: Stabilize Runners (Week 1)
1. Remove experimental markers
2. Implement allowedTools for OpenCode
3. Add streaming for OpenCode v2
4. Update documentation

### Phase 2: Multi-Forge Core (Week 2)
1. Implement GitLab prMergeState
2. Implement GitLab mergePR
3. Implement GitLab prDiff
4. Add comprehensive tests

### Phase 3: Complete Multi-Forge (Week 3)
1. Implement Gitea/Forgejo features
2. Add CI checks display
3. Implement comment counts
4. Final testing and documentation

### Phase 4: Junie/pi Runners (Week 4)
1. Implement allowedTools for Junie
2. Add streaming for Junie/pi
3. Complete golden fixtures
4. Final stability pass

## 7. Success Criteria

### Runner Stability
- ✅ All runners work with `allowedTools` restrictions
- ✅ Streaming works for OpenCode, Junie, pi
- ✅ 100% test coverage with golden fixtures
- ✅ No "experimental" markers in user-facing docs

### Multi-Forge Parity
- ✅ GitLab/Gitea/Forgejo can merge PRs/MRs
- ✅ Merge state shows all blocking issues
- ✅ Full diffs available for all forges
- ✅ CI checks display correctly
- ✅ Comment counts accurate

## 8. Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| CLI API changes break | Medium | High | Version detection, fallback modes |
| Performance degradation | Low | Medium | Caching, lazy loading |
| Auth token scope issues | High | Medium | Clear error messages, docs |
| Self-hosted forge differences | Medium | Low | Degrade gracefully, version checks |

## 9. Maintenance Notes

- Keep CLI command docs synced with actual versions
- Monitor forge API deprecations
- Update golden fixtures on CLI updates
- Keep error messages user-friendly
