# Workflow Enhancements Guide

This guide covers the advanced workflow features added to cezar: **parameters**, **outputs**, **conditionals**, and **skill composition**.

## Quick Start

### 1. Step Parameters

Pass configuration to skills and prompts:

```yaml
steps:
  - skill: code-review
    params:
      severity: high
      focus: security
```

Access in skills with `{{params.key}}`:

```markdown
---
name: code-review
---
Review code with {{params.severity}} severity, focusing on {{params.focus}}.
```

### 2. Output Capture

Capture step results for use in later steps:

```yaml
steps:
  - name: Find issues
    skill: analyze-code
    output: issues
    
  - name: Fix issues
    prompt: "Fix these: {{outputs.issues}}"
```

### 3. Conditional Execution

Run steps based on previous results:

```yaml
steps:
  - name: Run tests
    command: npm test
    
  - name: Fix failures
    skill: debug-tests
    if: previous.failed
```

Available conditions:
- `always` — always run
- `previous.done` — previous step succeeded
- `previous.failed` — previous step failed
- `step.<id>.done` — specific step succeeded
- `step.<id>.failed` — specific step failed

### 4. Skill Composition

Compose meta-skills from multiple skills:

```markdown
---
name: quality-gate
includes:
  - lint
  - test
  - security-scan
---
All checks must pass.
```

## Complete Examples

### Example 1: Parameterized Security Scan

**Workflow:**
```yaml
name: security-pipeline
steps:
  - skill: security-scan
    params:
      depth: thorough
      severity: high
    output: findings
    
  - prompt: "Create a report for: {{outputs.findings}}"
    if: step.security-scan.done
```

**Skill:**
```markdown
---
name: security-scan
---
Run security scan with {{params.depth}} depth.
Only report {{params.severity}} severity issues or higher.
```

### Example 2: Conditional Error Recovery

```yaml
name: test-with-recovery
steps:
  - id: tests
    command: npm test
    
  - id: auto-fix
    skill: fix-tests
    if: step.tests.failed
    
  - id: retry
    command: npm test
    if: step.auto-fix.done
    
  - id: manual-review
    skill: deep-debug
    if: step.retry.failed
```

### Example 3: Composed Quality Gate

**Base skills:**
```markdown
# lint.md
---
name: lint
---
Run linter.
```

```markdown
# test.md
---
name: test
---
Run tests.
```

**Composed skill:**
```markdown
# quality-gate.md
---
name: quality-gate
includes:
  - lint
  - test
---
Complete quality check.
```

**Usage:**
```yaml
steps:
  - skill: quality-gate
    prompt: "{{task}}"
```

### Example 4: Multi-Stage Data Pipeline

```yaml
name: data-analysis
steps:
  - name: Extract data
    command: node scripts/extract.js
    output: raw-data
    
  - name: Transform
    prompt: "Transform this data: {{outputs.raw-data}}"
    output: transformed
    
  - name: Analyze
    skill: statistical-analysis
    params:
      data: "{{outputs.transformed}}"
      method: regression
    output: results
    
  - name: Visualize
    prompt: "Create charts for: {{outputs.results}}"
    if: step.analyze.done
```

## How It Works

### Execution Context

Each workflow run maintains an execution context:
- **Outputs** — captured from previous steps
- **Step Results** — status of each step (done/failed/skipped)
- **Parameters** — configuration passed to steps

### Templating

The engine applies templating before executing each step:

1. **Preserve** `{{task}}` token (substituted later by the engine)
2. **Substitute** `{{params.key}}` with step parameters
3. **Substitute** `{{outputs.name}}` with captured outputs
4. **Leave unchanged** unknown tokens

### Condition Evaluation

Before each step:
1. Evaluate the `if:` condition (if present)
2. If false, skip the step (status: `skipped`)
3. If true (or no condition), execute the step

### Output Capture

After each step completes:
1. Extract the output text (last agent turn or command stdout)
2. Strip protocol markers (`CEZ:DONE`, `CEZ:MONITORING`, etc.)
3. Store in execution context under the `output:` name

### Skill Composition

When a skill is loaded:
1. Check for `includes:` in frontmatter
2. Recursively compose included skills
3. Merge bodies with boundary markers
4. Parent body comes last (can override)

## Advanced Patterns

### Pattern 1: Multi-Attempt with Escalation

```yaml
steps:
  - id: quick-fix
    skill: auto-fix
    params:
      speed: fast
    
  - id: thorough-fix
    skill: auto-fix
    params:
      speed: thorough
    if: step.quick-fix.failed
    
  - id: manual
    skill: deep-investigation
    if: step.thorough-fix.failed
```

### Pattern 2: Branch and Merge

```yaml
steps:
  - id: analyze
    skill: analyze-code
    output: issues
    
  # Branch: Different fixes for different issue types
  - id: fix-security
    prompt: "Fix security issues: {{outputs.issues}}"
    params:
      filter: security
    if: step.analyze.done
    
  - id: fix-performance
    prompt: "Fix performance issues: {{outputs.issues}}"
    params:
      filter: performance
    if: step.analyze.done
    
  # Merge: Verify all fixes
  - id: verify
    command: npm test
    if: always
```

### Pattern 3: Parameterized Retry Loop

```yaml
steps:
  - id: attempt-1
    skill: fix-issue
    params:
      strategy: conservative
    
  - id: attempt-2
    skill: fix-issue
    params:
      strategy: aggressive
    if: step.attempt-1.failed
    onFail:
      retry: attempt-1
      max: 1
```

## Best Practices

### Parameters

✅ **Do:**
- Use descriptive parameter names
- Document expected parameters in skill description
- Provide sensible defaults when possible

❌ **Don't:**
- Use parameters for data that should be outputs
- Pass large data structures (use outputs instead)

### Outputs

✅ **Do:**
- Name outputs clearly (`issues`, `report`, `count`)
- Capture structured summaries, not raw dumps
- Strip unnecessary noise from outputs

❌ **Don't:**
- Capture outputs you won't use
- Pass binary data through outputs
- Create circular dependencies

### Conditionals

✅ **Do:**
- Use conditionals for error recovery
- Skip expensive steps when prerequisites fail
- Document why a step is conditional

❌ **Don't:**
- Create deeply nested conditionals
- Use conditionals for flow control (use separate workflows)
- Make every step conditional (defeats the workflow structure)

### Skill Composition

✅ **Do:**
- Create focused base skills
- Compose related checks into meta-skills
- Document what each skill includes

❌ **Don't:**
- Create circular includes
- Include too many skills (composition becomes opaque)
- Duplicate content between included skills

## Testing

Test workflows with new features:

```bash
# Run a workflow with parameters
cez run --workflow security-pipeline

# Check the execution context in .ai/cezar/runs/<id>/
cat .ai/cezar/runs/<runId>/events.ndjson | grep output

# View composed skills
cez skill show full-review
```

## Troubleshooting

### Parameters not substituted

Check that:
- Parameter names match exactly (case-sensitive)
- Using `{{params.key}}` syntax (not `${params.key}`)
- Parameters defined in step YAML

### Outputs not captured

Check that:
- Step has `output:` field
- Step completed successfully
- Output name used in `{{outputs.name}}`

### Condition always false

Check that:
- Step IDs match exactly
- Previous step actually ran (not skipped)
- Using correct condition syntax

### Included skill not found

Check that:
- Skill name matches exactly
- Skill file exists in skills directories
- No typos in `includes:` list

## Migration from Old Workflows

Old workflows work unchanged. To migrate:

1. **Add parameters** to steps that need configuration
2. **Add outputs** where results feed later steps
3. **Add conditionals** for error recovery paths
4. **Compose skills** that are often used together

Example migration:

**Before:**
```yaml
steps:
  - skill: code-review
    prompt: "Review with high severity, focus on security"
```

**After:**
```yaml
steps:
  - skill: code-review
    params:
      severity: high
      focus: security
```

## See Also

- [Full specification](.ai/specs/2026-10-07-workflow-enhancements.md)
- [Example workflows](.ai/cezar/workflows/security-audit-example.yaml)
- [Example skills](.ai/cezar/skills/)
