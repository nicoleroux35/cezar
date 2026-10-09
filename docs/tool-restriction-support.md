# Tool Restriction Support by Backend

This table shows how each backend handles `allowedTools` and `bashAllowlist` specifications.

## Support Matrix

| Backend | `allowedTools` | `bashAllowlist` | Implementation | Status |
|---------|---------------|-----------------|----------------|--------|
| **Claude** | ✅ Full | ✅ Full | CLI `--allowedTools` flag with per-tool filtering | Stable |
| **Codex** | ❌ Ignored | ❌ Ignored | Auto-approves all (architectural limitation) | Stable |
| **Junie** | ✅ Filtered | ✅ Filtered | Disables brave_mode, filters permission requests | Stable |
| **OpenCode** | ⚠️ Warnings | ⚠️ Warnings | Post-execution detection and logging | Stable |
| **Cursor** | ⚠️ Prompt hint | ⚠️ Prompt hint | Guidance via system prompt | Stable |
| **Copilot** | ❌ Ignored | ❌ Ignored | Auto-approves all (architectural limitation) | Stable |
| **pi** | ✅ Mapped | ⚠️ Warning | Maps to `--tools` flag; bash is all-or-nothing | Stable |

## Support Levels

### ✅ Full Support
The backend enforces tool restrictions at runtime. Disallowed tools are blocked before execution.

**Backends:** Claude

### ✅ Filtered
The backend filters permission requests according to the allowlist. Disallowed tools are denied.

**Backends:** Junie

### ✅ Mapped
The backend accepts tool restrictions via CLI flags and enforces them.

**Backends:** pi (with limitations)

### ⚠️ Warnings
The backend executes tools first, then emits warnings for disallowed usage. Provides visibility without blocking.

**Backends:** OpenCode

### ⚠️ Prompt Hint
Restrictions are communicated to the agent via the system prompt. No enforcement mechanism.

**Backends:** Cursor

### ❌ Ignored
The backend does not support tool restrictions. Auto-approves all tool usage.

**Backends:** Codex, Copilot

## Detailed Behavior

### Claude (Full Support)
```typescript
allowedTools: ['Read', 'Write', 'Edit']
// ✅ Only these tools will be available
// ✅ Bash blocked completely
// ✅ Other tools blocked with clear errors

bashAllowlist: ['git', 'npm']
// ✅ Only commands starting with these prefixes allowed
// ✅ Other bash commands blocked
```

### Junie (Filtered)
```typescript
allowedTools: ['Read', 'Write']
// ✅ brave_mode disabled
// ✅ Permission requests filtered
// ✅ Disallowed tools denied with warnings
// ⚠️ Agent sees denial, may adapt or fail

bashAllowlist: ['git']
// ✅ Bash included if specified
// ⚠️ Cannot enforce command prefixes (limitation)
```

### OpenCode (Warnings)
```typescript
allowedTools: ['Read', 'Write']
// ⚠️ Tools execute normally
// ⚠️ Warnings emitted for disallowed usage
// ℹ️  Provides visibility into tool usage
// ❌ Cannot block proactively (API limitation)

// Example output:
// ⚠️  Tool restriction: 'Bash' (execute_command) was used but not in allowedTools
```

### Cursor (Prompt Hint)
```typescript
allowedTools: ['Read', 'Edit']
// ⚠️ --force --trust flags omitted
// ⚠️ Restrictions added to system prompt
// ℹ️  Agent receives guidance but no enforcement
// ❌ May still use other tools

bashAllowlist: ['git', 'npm']
// ⚠️ Communicated in prompt
// ❌ No CLI-level enforcement
```

### pi (Mapped with Limitations)
```typescript
allowedTools: ['Read', 'Write', 'Bash']
// ✅ Maps to --tools=read,write,bash
// ✅ Other tools blocked by pi CLI
// ✅ Works as expected for non-bash tools

bashAllowlist: ['git', 'npm']
// ⚠️ Bash included if in allowedTools
// ⚠️ Warning emitted: cannot enforce prefixes
// ❌ All bash commands allowed (pi limitation)

// Example output:
// ⚠️  Warning: pi cannot enforce bash command prefixes - all bash commands 
//     are allowed when Bash tool is enabled
```

### Codex & Copilot (Ignored)
```typescript
allowedTools: ['Read', 'Write']
// ❌ Completely ignored
// ❌ All tools auto-approved
// ℹ️  Architectural limitation (auto-approval mode)
```

## Recommendations

### For Maximum Security
Use **Claude** - only backend with full pre-execution enforcement.

### For Good Visibility
Use **Junie** or **OpenCode**:
- Junie: Filters at permission time
- OpenCode: Logs violations after execution

### For Development/Testing
Any backend with prompt hints (**Cursor**) or warnings (**OpenCode**, **pi**) provides some guidance.

### When Security Is Critical
- Use Claude exclusively
- Or restrict to Junie with careful tool selection
- Avoid Codex/Copilot for restricted environments

## Migration Notes

### From Previous Versions

Prior to this update, several backends ignored `allowedTools` completely. Now:

- **Junie**: Now filters permissions (was: ignored)
- **OpenCode**: Now emits warnings (was: silently ignored)
- **Cursor**: Now provides prompt guidance (was: ignored)
- **pi**: Now emits bash allowlist warnings (was: silently dropped bash)

All changes are **backward compatible** - existing workflows continue to work.

### Future Improvements

We continue working with backend vendors to improve support:

- **OpenCode**: Request pre-execution permission API
- **Cursor**: Request `--allowed-tools` CLI flag
- **pi**: Request bash command prefix filtering
- **Codex/Copilot**: Architectural changes unlikely

## See Also

- [Workflows](reference.md#workflows) - How to specify `allowedTools`
- [Skills](reference.md#skills) - Tool restrictions in skills
- [Security](../SECURITY.md) - Security considerations
