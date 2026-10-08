# Workflow Enhancements: Parameters, Outputs, Conditionals, and Skill Composition

**Date:** 2026-10-07  
**Status:** Implementation Complete

## Overview

Four high-impact enhancements to the workflow and skills system:

1. **Step Parameters** — pass typed parameters to skills and prompts via `{{params.*}}`
2. **Output Capture** — capture step outputs and pass them to subsequent steps via `{{outputs.*}}`
3. **Conditional Execution** — skip or execute steps based on previous step results
4. **Skill Composition** — compose meta-skills from multiple skill definitions via `includes:`

## 1. Step Parameters

### Syntax

```yaml
steps:
  - name: Security review
    skill: code-review
    params:
      severity: high
      focus: security
      depth: thorough
```

### Templating in Skills

Skills access parameters via `{{params.key}}`:

```markdown
---
name: code-review
description: Review code with configurable focus
---

Review the code changes with {{params.severity}} severity.
Focus on: {{params.focus}}
Analysis depth: {{params.depth}}
```

### Rules

- Parameters are per-step, not global
- Unknown `{{params.*}}` tokens are left unchanged (no silent empty substitution)
- Parameters can be any JSON value (strings, numbers, booleans, arrays, objects)
- The `{{task}}` token is preserved and substituted by the engine as before

## 2. Output Capture

### Syntax

```yaml
steps:
  - name: Analyze issues
    skill: find-security-issues
    output: issues
    
  - name: Fix issues
    prompt: "Fix the following issues: {{outputs.issues}}"
```

### Behavior

- The `output:` field names the capture
- Output is the last agent turn's text, with protocol markers stripped:
  - `CEZ:DONE`, `CEZ:MONITORING`, `CEZ:PR=`, `CEZ:ISSUE=`, `CEZ:TITLE=` are removed
- Subsequent steps access via `{{outputs.name}}`
- Check step outputs are captured too (stdout, capped at 20KB)

### Example

```yaml
steps:
  - name: Count failures
    command: npm test --json | jq '.numFailedTests'
    output: failCount
    
  - name: Report
    prompt: "Found {{outputs.failCount}} failing tests. Fix them."
```

## 3. Conditional Execution

### Syntax

```yaml
steps:
  - name: Run tests
    command: npm test
    
  - name: Fix failures
    skill: debug-tests
    if: previous.failed
    
  - name: Deploy
    skill: deploy-production
    if: step.tests.done
```

### Supported Conditions

| Condition | Meaning |
|-----------|---------|
| `always` | Always execute (bypass condition) |
| `previous.failed` | Previous step failed |
| `previous.done` | Previous step succeeded |
| `step.<id>.failed` | Specific step failed |
| `step.<id>.done` | Specific step succeeded |

### Rules

- Conditions are evaluated **before** the step starts
- A failed condition **skips** the step (status: `skipped`)
- Skipped steps do not break the workflow
- First step cannot use `previous.*` (no previous step exists)
- Unknown conditions default to `false` (skip)

### Example: Error Recovery

```yaml
steps:
  - id: lint
    name: Lint code
    command: npm run lint
    
  - id: fix-lint
    name: Auto-fix lint issues
    command: npm run lint -- --fix
    if: previous.failed
    
  - id: tests
    name: Run tests
    command: npm test
    
  - id: fix-tests
    name: Fix test failures
    skill: debug-and-fix-tests
    if: step.tests.failed
```

## 4. Skill Composition

### Syntax

```markdown
---
name: full-review
description: Complete code review across all dimensions
includes:
  - code-quality
  - security-scan
  - performance-check
---

Additional review notes specific to this workflow.
```

### Behavior

- `includes:` lists skill names to merge into this skill
- Included skills are composed **recursively** (an included skill can include others)
- Cycle detection prevents infinite recursion
- Bodies are merged with HTML comments marking boundaries:
  ```html
  <!-- BEGIN: code-quality -->
  ... code-quality body ...
  <!-- END: code-quality -->
  
  <!-- BEGIN: security-scan -->
  ... security-scan body ...
  <!-- END: security-scan -->
  
  <!-- BEGIN: full-review -->
  ... parent skill body ...
  <!-- END: full-review -->
  ```
- Parent body comes **last** (override behavior)
- Missing included skills leave a comment: `<!-- Skill "missing-name" not found -->`

### Example: Meta-Skills

**Base skills:**

```markdown
# .ai/cezar/skills/lint.md
---
name: lint
---
Run the linter and report issues.
```

```markdown
# .ai/cezar/skills/type-check.md
---
name: type-check
---
Run TypeScript type checking.
```

```markdown
# .ai/cezar/skills/test.md
---
name: test
---
Run the test suite.
```

**Composed skill:**

```markdown
# .ai/cezar/skills/quality-gate.md
---
name: quality-gate
includes:
  - lint
  - type-check
  - test
---

This is a comprehensive quality gate. All three checks must pass.
```

Using it:

```yaml
name: pre-commit
steps:
  - skill: quality-gate
    prompt: "{{task}}"
```

## Complete Example

A workflow demonstrating all four enhancements:

```yaml
# .ai/cezar/workflows/security-pipeline.yaml
name: security-pipeline
description: Security analysis with conditional remediation

steps:
  - id: scan
    name: Security scan
    skill: security-audit
    params:
      depth: deep
      include_deps: true
    output: findings
    
  - id: report
    name: Generate report
    prompt: |
      Create a security report for these findings:
      {{outputs.findings}}
      
      Severity: {{params.severity}}
    params:
      severity: high
    output: report
    
  - id: auto-fix
    name: Auto-fix issues
    skill: security-auto-fix
    if: step.scan.done
    params:
      findings: "{{outputs.findings}}"
    
  - id: verify
    name: Re-scan after fixes
    command: npm audit --audit-level=high
    if: step.auto-fix.done
    
  - id: manual-review
    name: Manual security review
    skill: deep-security-review
    if: step.verify.failed
    params:
      focus: "Remaining vulnerabilities after auto-fix"
```

## Implementation

### Files Changed

1. **`packages/cezar/src/workflows/types.ts`**
   - Extended `workflowStepSchema` with `params`, `output`, `if`

2. **`packages/cezar/src/skills.ts`**
   - Added `includes?: string[]` to `Skill` interface
   - Parse `includes` from frontmatter in `readMarkdownSkills`

3. **`packages/cezar/src/workflows/execution-context.ts`** (new)
   - `ExecutionContext` — carries outputs, step results, parameters
   - `evaluateCondition()` — evaluate `if` conditions
   - `applyTemplating()` — substitute `{{params.*}}` and `{{outputs.*}}`
   - `composeSkillWithIncludes()` — merge included skills
   - `extractStepOutput()` — capture output text from agent turns

4. **`packages/cezar/src/workflows/execution-context.test.ts`** (new)
   - Unit tests for all execution-context utilities

### Integration Points

The workflow engine (`run.ts`) must be updated to:

1. Initialize an `ExecutionContext` at workflow start
2. Before each step:
   - Evaluate its `if` condition and skip if false
   - Apply templating to prompt/skill with step `params` and context `outputs`
   - Compose skills with their `includes`
3. After each step:
   - Record the step result (done/failed/skipped)
   - If the step has an `output:` field, capture its text

### Backward Compatibility

All features are **opt-in** and **backward-compatible**:

- Workflows without `params`/`output`/`if` work exactly as before
- Skills without `includes` work unchanged
- `{{params.*}}` and `{{outputs.*}}` tokens in old workflows are left as-is (no substitution)
- The `{{task}}` token continues to work

## Testing

Run the unit tests:

```bash
npm test -- packages/cezar/src/workflows/execution-context.test.ts
```

## Usage Examples

### Example 1: Parameterized Review

```yaml
name: custom-review
steps:
  - skill: code-review
    params:
      severity: critical
      focus: security
      files: "src/**/*.ts"
```

### Example 2: Multi-Stage with Outputs

```yaml
name: analyze-and-fix
steps:
  - name: Find bugs
    skill: static-analysis
    output: bugs
    
  - name: Fix them
    prompt: "Fix these bugs: {{outputs.bugs}}"
```

### Example 3: Conditional Cleanup

```yaml
name: test-with-cleanup
steps:
  - name: Run tests
    command: npm test
    
  - name: Generate coverage
    command: npm run coverage
    if: previous.done
    
  - name: Debug failures
    skill: debug-tests
    if: step.run-tests.failed
```

### Example 4: Composed Quality Gate

**Skill definitions:**

```markdown
# lint.md
---
name: lint
---
Run eslint and report violations.
```

```markdown
# security.md
---
name: security
---
Run security audit (npm audit, Snyk).
```

```markdown
# full-gate.md
---
name: full-gate
includes:
  - lint
  - security
---
Both checks must pass before merge.
```

**Workflow:**

```yaml
name: pr-gate
steps:
  - skill: full-gate
    prompt: "{{task}}"
```

## Future Enhancements

Possible additions:

1. **Parallel steps** — `parallel: [step1, step2, step3]`
2. **Step outputs as JSON** — parse structured data: `output: { type: json }`
3. **More conditions** — `outputs.count > 0`, `exitCode === 1`
4. **Global workflow parameters** — set once, available to all steps
5. **Output templates** — `output: "issue-{{runId}}"` for namespacing

## Migration Guide

No migration needed — all features are additive and opt-in.

To start using:

1. Add `params:` to any step that needs configuration
2. Add `output:` to steps whose results feed later steps
3. Add `if:` to steps that should run conditionally
4. Add `includes:` to skills that compose others

## Notes

- Parameters and outputs are **plain strings** in this version (no JSON parsing)
- Templating is **simple token replacement** (no expressions like `{{outputs.count + 1}}`)
- Conditions are **boolean only** (no numeric or string comparisons yet)
- Skill composition is **load-time** (includes are resolved when the skill is discovered)
