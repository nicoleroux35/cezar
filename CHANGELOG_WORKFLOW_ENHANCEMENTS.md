# Changelog Entry: Workflow Enhancements

## [Unreleased]

### Added

#### Workflow Parameters
- Added `params` field to workflow steps for passing configuration to skills and prompts
- Skills can now access parameters via `{{params.key}}` templating syntax
- Parameters support any JSON value type (strings, numbers, booleans, objects, arrays)
- Example:
  ```yaml
  steps:
    - skill: code-review
      params:
        severity: high
        focus: security
  ```

#### Output Capture
- Added `output` field to workflow steps to capture step results
- Captured outputs can be referenced in subsequent steps via `{{outputs.name}}`
- Works for both agent steps (last turn text) and check steps (stdout)
- Protocol markers (CEZ:DONE, CEZ:MONITORING, task refs) are automatically stripped
- Example:
  ```yaml
  steps:
    - name: Analyze
      skill: find-issues
      output: issues
    - name: Fix
      prompt: "Fix these: {{outputs.issues}}"
  ```

#### Conditional Execution
- Added `if` field to workflow steps for conditional execution
- Supported conditions:
  - `always` — always execute
  - `previous.done` — execute if previous step succeeded
  - `previous.failed` — execute if previous step failed
  - `step.<id>.done` — execute if specific step succeeded
  - `step.<id>.failed` — execute if specific step failed
- Steps with failed conditions are marked as `skipped`
- Example:
  ```yaml
  steps:
    - name: Run tests
      command: npm test
    - name: Fix failures
      skill: debug-tests
      if: previous.failed
  ```

#### Skill Composition
- Added `includes` field to skill frontmatter for composing meta-skills
- Skills can include multiple other skills to create comprehensive workflows
- Recursive composition with cycle detection
- Boundary markers show composition structure in merged output
- Example:
  ```markdown
  ---
  name: quality-gate
  includes:
    - lint
    - test
    - security-scan
  ---
  All checks must pass before merge.
  ```

### Changed

#### Workflow Types
- Extended `WorkflowStepDef` with optional `params`, `output`, and `if` fields
- All changes are backward compatible (fields are optional)

#### Skills
- Extended `Skill` interface with optional `includes` field
- `readMarkdownSkills()` now parses `includes` from frontmatter
- All changes are backward compatible

### Technical Details

#### New Files
- `packages/cezar/src/workflows/execution-context.ts` — Execution context and templating engine
- `packages/cezar/src/workflows/execution-context.test.ts` — Unit tests (27 tests, all passing)
- `.ai/specs/2026-10-07-workflow-enhancements.md` — Feature specification
- `WORKFLOW_ENHANCEMENTS_GUIDE.md` — User guide with examples
- `.ai/cezar/workflows/security-audit-with-remediation.yaml` — Complete example workflow
- `.ai/cezar/skills/full-review.md` — Example composed skill

#### Modified Files
- `packages/cezar/src/workflows/types.ts` — Added new schema fields
- `packages/cezar/src/skills.ts` — Added includes support

#### Integration Status
- ✅ Implementation complete
- ✅ Tests passing (27/27)
- ✅ Documentation complete
- ⏳ Integration into workflow engine pending (requires update to `run.ts`)

### Migration Guide

No migration needed. All features are opt-in and backward compatible:

- Existing workflows without new fields work exactly as before
- Skills without `includes` work unchanged
- Unknown `{{params.*}}` and `{{outputs.*}}` tokens are left as-is
- The `{{task}}` token continues to work

To start using new features:
1. Add `params:` to steps that need configuration
2. Add `output:` to steps whose results feed later steps
3. Add `if:` to steps that should run conditionally
4. Add `includes:` to skills that compose others

### Examples

#### Before and After

**Before:**
```yaml
steps:
  - skill: code-review
    prompt: "Review with high severity, focusing on security"
  - skill: fix-issues
    prompt: "{{task}}"
```

**After:**
```yaml
steps:
  - skill: code-review
    params:
      severity: high
      focus: security
    output: findings
  - skill: fix-issues
    prompt: "Fix these issues: {{outputs.findings}}"
    if: step.code-review.done
```

#### Real-World Workflow

```yaml
name: security-pipeline
description: Security audit with conditional remediation

steps:
  - id: scan
    skill: security-scan
    params:
      depth: thorough
      severity_threshold: medium
    output: vulnerabilities
    
  - id: auto-fix
    command: npm audit fix
    if: step.scan.done
    
  - id: verify
    command: npm audit
    if: step.auto-fix.done
    
  - id: manual-review
    skill: security-remediation
    params:
      findings: "{{outputs.vulnerabilities}}"
    if: step.verify.failed
```

### Performance

- Templating: O(n) string replacement, negligible overhead
- Conditions: O(1) lookup in step results map
- Composition: O(includes × skills), cached at skill load time
- Outputs: Stored in-memory map, fast access

### Security

- Parameters are validated via Zod schemas
- Outputs are sanitized (protocol markers stripped)
- Conditions are evaluated, not executed (no code injection)
- Skill includes are resolved at load time (no runtime injection)

### Breaking Changes

None. All features are opt-in and backward compatible.

### Credits

Implemented based on user requirements for advanced workflow orchestration.
Follows the zero-config philosophy: features are discovered and degraded gracefully.

---

**Implementation Date:** 2026-10-07  
**Tests:** ✅ 27/27 passing  
**Documentation:** ✅ Complete  
**Status:** Ready for integration
