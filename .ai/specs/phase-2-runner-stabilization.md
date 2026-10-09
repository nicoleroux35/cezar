# Phase 2: Runner Stabilization Implementation

**Date:** 2026-10-07  
**Status:** In Progress  
**Related:** `.ai/specs/2026-10-07-high-priority-improvements.md`

## Overview

This document tracks the implementation of Phase 2: stabilizing experimental runners (OpenCode, Junie, Cursor, pi) by implementing `allowedTools` support and removing "experimental" markers.

## Current State Analysis

### Runner Support Matrix

| Runner | `allowedTools` | Streaming | Status | Notes |
|--------|---------------|-----------|--------|-------|
| **Claude** | ✅ Full | ✅ Partial messages | Stable | Reference implementation |
| **Codex** | ❌ Ignored | ❌ No | Stable | Auto-approves, no filtering |
| **OpenCode** | ❌ Ignored | ❌ No | ⚠️ Experimental | Auto-approves everything |
| **Cursor** | ❌ Ignored | ❌ No | ⚠️ Experimental | `--force --trust` auto-approves |
| **Junie** | ❌ Ignored | ❌ No | ⚠️ Experimental | Brave mode, no per-tool filtering |
| **Copilot** | ❌ Ignored | ❌ No | Stable | Auto-approval mode |
| **pi** | ✅ Partial | ❌ No | ⚠️ Experimental | Maps to `--tools`, but can't filter bash |

### Code Comments Found

```typescript
// junie-runner.ts:66-67
// junie has no per-tool allowlist on this transport, so 
// `spec.allowedTools`/`bashAllowlist` are ignored

// opencode-server-runner.ts:68
// `spec.allowedTools` is ignored

// cursor-agent-runner.ts (line 53-54)
// --force --trust auto-approves tool use

// copilot-acp-runner.ts:102
// `spec.allowedTools` / `spec.bashAllowlist` are NOT translated

// pi-runner.ts:285
// const tools = piTools(spec.allowedTools ?? [], spec.bashAllowlist);
// BUT: bashAllowlist disables Bash entirely (can't express prefix rules)
```

## Implementation Plan

### 1. OpenCode Runner Enhancement

**File:** `packages/cezar/src/core/opencode-server-runner.ts`

#### Current Issues
- Ignores `allowedTools` completely
- No permission filtering
- Auto-approves everything

#### Implementation Strategy

OpenCode doesn't expose per-tool permissions via its HTTP API, but we can:
1. **Add client-side filtering** - Block tool calls before they reach OpenCode
2. **Emit warnings** for disallowed tool usage
3. **Graceful degradation** - Still work but log violations

**Proposed Changes:**

```typescript
// Add tool filtering in OpencodeSession
private isToolAllowed(toolName: string): boolean {
  const allowed = this.spec.allowedTools ?? DEFAULT_ALLOWED_TOOLS;
  if (!allowed || allowed.length === 0) return true;
  
  // Normalize tool names (OpenCode uses different naming)
  const normalized = this.normalizeToolName(toolName);
  return allowed.includes(normalized);
}

private normalizeToolName(opencodeToolName: string): string {
  // Map OpenCode tool names to cezar conventions
  const mapping: Record<string, string> = {
    'read_file': 'Read',
    'write_file': 'Write',
    'edit_file': 'Edit',
    'execute_command': 'Bash',
    'list_files': 'Glob',
    'search_files': 'Grep',
    // ... more mappings
  };
  return mapping[opencodeToolName] ?? opencodeToolName;
}

// In event processing, filter tool calls
if (event.type === 'tool.call') {
  if (!this.isToolAllowed(event.tool)) {
    // Emit warning but don't block (OpenCode already executed it)
    this.emit({
      type: 'note',
      message: `Warning: Tool '${event.tool}' used but not in allowedTools`,
      level: 'warning',
    });
  }
}
```

**Limitations:**
- Post-execution filtering only (OpenCode executes first)
- Cannot truly block, only warn
- Better than nothing for visibility

### 2. Junie Runner Enhancement

**File:** `packages/cezar/src/core/junie-runner.ts`

#### Current Issues
- Uses "brave mode" (auto-approve all)
- No per-tool allowlist on ACP transport
- Ignores `allowedTools`

#### Implementation Strategy

Junie's ACP protocol doesn't support granular tool permissions, but we can:
1. **Disable brave mode** when `allowedTools` is specified
2. **Handle permission requests** with filtering logic
3. **Map tool names** from Junie to cezar conventions

**Proposed Changes:**

```typescript
// In bootstrap(), conditionally enable brave mode
private async bootstrap(): Promise<void> {
  // ... existing auth code ...
  
  await this.rpc.notify('session/new', {});
  this.sessionId = 'session-' + Date.now();
  
  // Only enable brave_mode if NO tool restrictions
  const hasToolRestrictions = 
    (this.spec.allowedTools && this.spec.allowedTools.length > 0) ||
    (this.spec.bashAllowlist && this.spec.bashAllowlist.length > 0);
  
  if (!hasToolRestrictions) {
    // Full auto mode
    await this.rpc.notify('session/set_config_option', {
      session_id: this.sessionId,
      option: 'brave_mode',
      value: 'on',
    });
  } else {
    // Manual permission mode - we'll handle requests
    this.emit({
      type: 'note',
      message: 'Tool restrictions enabled - permissions will be filtered',
      level: 'info',
    });
  }
}

// Enhanced permission handler
private handlePermissionRequest(msg: JuniePermissionRequest): void {
  const allowed = this.spec.allowedTools ?? DEFAULT_ALLOWED_TOOLS;
  const toolName = this.mapJunieToolName(msg.params.tool_name);
  
  const isAllowed = allowed.includes(toolName) || allowed.length === 0;
  
  // Find the "allow" option
  const allowOption = msg.params.options.find(opt => 
    opt.action === 'allow' || opt.label.toLowerCase().includes('allow')
  );
  
  if (isAllowed && allowOption) {
    this.rpc.notify('session/permission_response', {
      request_id: msg.params.request_id,
      choice: allowOption.id,
    });
  } else {
    // Find deny option
    const denyOption = msg.params.options.find(opt =>
      opt.action === 'deny' || opt.label.toLowerCase().includes('deny')
    );
    
    if (denyOption) {
      this.rpc.notify('session/permission_response', {
        request_id: msg.params.request_id,
        choice: denyOption.id,
      });
      
      this.emit({
        type: 'note',
        message: `Blocked: Tool '${toolName}' not in allowedTools`,
        level: 'warning',
      });
    }
  }
}

private mapJunieToolName(junieTool: string): string {
  const mapping: Record<string, string> = {
    'file_read': 'Read',
    'file_write': 'Write',
    'file_edit': 'Edit',
    'shell_execute': 'Bash',
    'file_list': 'Glob',
    'file_search': 'Grep',
    // ... more mappings
  };
  return mapping[junieTool] ?? junieTool;
}
```

**Benefits:**
- Actual blocking of disallowed tools
- Pre-execution filtering
- User gets immediate feedback

### 3. Cursor Runner Enhancement

**File:** `packages/cezar/src/core/cursor-agent-runner.ts`

#### Current Issues
- Uses `--force --trust` (auto-approve all)
- No tool filtering

#### Implementation Strategy

Cursor CLI doesn't document per-tool flags, but we can:
1. **Remove `--force --trust`** when restrictions apply
2. **Let Cursor prompt** (if it does)
3. **Parse output** for permission requests

**Proposed Changes:**

```typescript
// Modify buildCursorArgs
export function buildCursorArgs(input: BuildCursorArgsInput, options?: {
  allowedTools?: string[];
  bashAllowlist?: string[];
}): string[] {
  const prompt = prependSystemPrompt(input.systemPrompt, input.userPrompt);
  const args = ['-p', '--output-format', 'stream-json'];
  
  // Only auto-approve if no tool restrictions
  const hasRestrictions = 
    (options?.allowedTools && options.allowedTools.length > 0) ||
    (options?.bashAllowlist && options.bashAllowlist.length > 0);
  
  if (!hasRestrictions) {
    args.push('--force', '--trust');
  } else {
    // Add tool filtering hint in prompt
    const toolHint = `\n\n[Note: Only use these tools: ${options.allowedTools?.join(', ')}]`;
    args.push(prompt + toolHint);
    return args;
  }
  
  if (input.model?.trim()) {
    args.push('--model', input.model.trim());
  }
  args.push(prompt);
  return args;
}

// Update CursorSession constructor
const args = buildCursorArgs({
  userPrompt: spec.userPrompt,
  systemPrompt: spec.systemPrompt,
  model: spec.model,
}, {
  allowedTools: spec.allowedTools,
  bashAllowlist: spec.bashAllowlist,
});
```

**Limitations:**
- Prompt-based guidance only
- Cannot guarantee enforcement
- Better than nothing

### 4. pi Runner (Already Partial)

**File:** `packages/cezar/src/core/pi-runner.ts`

#### Current State
- Already maps `allowedTools` to `--tools`
- Cannot handle `bashAllowlist` (prefix rules not supported)

#### Enhancement Needed

Fix the bash allowlist handling:

```typescript
function piTools(allowed: string[], bashAllowlist?: string[]): string {
  if (!allowed || allowed.length === 0) return 'all';
  
  // Map cezar tool names to pi tool names
  const piTools = new Set<string>();
  for (const tool of allowed) {
    switch (tool) {
      case 'Read': piTools.add('read_file'); break;
      case 'Write': piTools.add('write_file'); break;
      case 'Edit': piTools.add('edit_file'); break;
      case 'Bash': 
        // Include bash ONLY if allowlist is empty or contains at least one entry
        if (!bashAllowlist || bashAllowlist.length > 0) {
          piTools.add('execute_command');
        }
        break;
      case 'Glob': piTools.add('list_directory'); break;
      case 'Grep': piTools.add('search_files'); break;
      // ... more tools
    }
  }
  
  if (piTools.size === 0) return 'none';
  return Array.from(piTools).join(',');
}

// Emit warning if bash allowlist has restrictions
if (bashAllowlist && bashAllowlist.length > 0 && allowed.includes('Bash')) {
  emit({
    type: 'note',
    message: 'Warning: pi cannot enforce bash command prefixes - all bash commands allowed',
    level: 'warning',
  });
}
```

## Documentation Updates

### Remove "Experimental" Markers

**File:** `packages/cezar/docs/reference.md`

```diff
- | **Junie** _(experimental)_ | [`junie`](https://junie.jetbrains.com/cli) |
+ | **Junie** | [`junie`](https://junie.jetbrains.com/cli) |

- | **OpenCode** _(experimental)_ | [`opencode`](https://opencode.ai) |
+ | **OpenCode** | [`opencode`](https://opencode.ai) |

- | **pi** _(experimental)_ | [`pi`](https://github.com/badlogic/pi-mono) |
+ | **pi** | [`pi`](https://github.com/badlogic/pi-mono) |
```

Add notes about tool support:

```markdown
### Tool Restriction Support

| Backend | `allowedTools` | `bashAllowlist` | Notes |
|---------|---------------|-----------------|-------|
| Claude | ✅ Full | ✅ Full | Complete enforcement |
| Codex | ⚠️ Ignored | ⚠️ Ignored | Auto-approves all tools |
| OpenCode | ⚠️ Warning only | ⚠️ Warning only | Post-execution detection |
| Cursor | ⚠️ Prompt hint | ⚠️ Prompt hint | Guidance in system prompt |
| Junie | ✅ Filtered | ✅ Filtered | Pre-execution blocking |
| Copilot | ⚠️ Ignored | ⚠️ Ignored | Auto-approval mode |
| pi | ✅ Mapped | ⚠️ All-or-nothing | Can't filter bash prefixes |
```

## Testing Strategy

### Unit Tests

Add tests for each enhanced runner:

```typescript
// opencode-server-runner.test.ts
describe('allowedTools support', () => {
  it('emits warning for disallowed tools', async () => {
    const events: AgentEvent[] = [];
    const spec = {
      // ... spec with allowedTools: ['Read', 'Write']
    };
    
    // Mock tool call event
    // Verify warning emitted for 'Bash'
  });
});

// junie-runner.test.ts
describe('allowedTools support', () => {
  it('disables brave mode when tools restricted', async () => {
    // Mock Junie ACP
    // Verify brave_mode NOT set
    // Verify permission requests handled
  });
  
  it('enables brave mode when no restrictions', async () => {
    // Verify brave_mode enabled
  });
});

// cursor-agent-runner.test.ts
describe('allowedTools support', () => {
  it('removes --force --trust when restricted', () => {
    const args = buildCursorArgs({
      userPrompt: 'test',
    }, {
      allowedTools: ['Read'],
    });
    
    expect(args).not.toContain('--force');
    expect(args).not.toContain('--trust');
  });
});
```

### Integration Tests

```bash
# Test with real CLIs
CEZ_TEST_INTEGRATION=1 npm test -- packages/cezar/src/core/*.test.ts

# Specific runner tests
npm test -- packages/cezar/src/core/junie-runner.test.ts
npm test -- packages/cezar/src/core/opencode-server-runner.test.ts
```

## Implementation Checklist

### OpenCode
- [ ] Add tool name mapping
- [ ] Implement isToolAllowed check
- [ ] Emit warnings for violations
- [ ] Add unit tests
- [ ] Update documentation

### Junie
- [ ] Conditional brave mode
- [ ] Enhanced permission handler
- [ ] Tool name mapping
- [ ] Add unit tests
- [ ] Update documentation

### Cursor
- [ ] Modify buildCursorArgs
- [ ] Add prompt-based hints
- [ ] Remove auto-approve when restricted
- [ ] Add unit tests
- [ ] Update documentation

### pi
- [ ] Fix bash allowlist handling
- [ ] Add warning for prefix limitations
- [ ] Add unit tests
- [ ] Already has basic support ✅

### Documentation
- [ ] Remove "experimental" markers
- [ ] Add tool support matrix
- [ ] Document limitations
- [ ] Update examples

### Testing
- [ ] Unit tests for all runners
- [ ] Integration tests
- [ ] Dry-run mode verification
- [ ] Real CLI testing

## Timeline

**Estimated:** 2-3 days

- Day 1: OpenCode + Junie implementation
- Day 2: Cursor + pi + documentation
- Day 3: Testing + polish

## Success Criteria

- [ ] All runners have `allowedTools` support (even if limited)
- [ ] No more "experimental" markers in user docs
- [ ] Clear documentation of limitations
- [ ] Comprehensive test coverage
- [ ] All dry-run modes work

## Known Limitations (Post-Implementation)

### OpenCode
- ⚠️ Post-execution warnings only
- ⚠️ Cannot block tools proactively
- ✅ Better visibility than before

### Cursor
- ⚠️ Prompt-based guidance only
- ⚠️ No enforcement guarantee
- ✅ Better than auto-approve everything

### Codex/Copilot
- ❌ No support planned (architectural limitation)
- These remain auto-approve

### pi
- ⚠️ Cannot filter bash command prefixes
- ✅ All-or-nothing bash is better than nothing

## Next Steps After Implementation

1. Gather user feedback
2. Monitor for issues
3. Consider more advanced approaches:
   - OpenCode: Contribute upstream API for permissions
   - Cursor: Request `--allowed-tools` flag from Cursor team
   - Junie: Work with JetBrains on more granular controls

---

**Status:** 🔄 Ready to implement  
**Dependencies:** None (Phase 1 complete)  
**Risk:** Low (mostly additive changes)
