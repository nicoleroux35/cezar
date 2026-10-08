# API Key Authentication Implementation Summary

## What Was Changed

This implementation adds support for using coding agents with API keys instead of requiring official CLI authentication. This enables use cases like:

- Using proxy services like [cc-switch](https://github.com/farion1231/cc-switch)
- Working with custom endpoints or self-hosted models
- Bypassing official login flows in CI/CD environments
- Using BYOK (Bring Your Own Key) approaches

## Key Changes

### 1. Provider Authentication (`packages/cezar/src/core/provider-auth.ts`)

Added `precheck` functions to provider descriptors that detect API keys in environment variables **before** calling the CLI. When an API key is present, the provider is immediately marked as "connected" without spawning the CLI.

**Providers updated:**

- **Claude**: Checks `ANTHROPIC_API_KEY`
- **Codex**: Checks `OPENAI_API_KEY` or `AZURE_OPENAI_API_KEY`
- **OpenCode**: Checks any of 13 provider API keys (OpenAI, Anthropic, Groq, Mistral, etc.)
- **Pi**: Checks any of the same 13 provider API keys
- **Kilo**: Checks any of the same 13 provider API keys
- **Gemini**: Checks `GEMINI_API_KEY` or `GOOGLE_GENERATIVE_AI_API_KEY`
- **Antigravity**: Checks `GOOGLE_GENERATIVE_AI_API_KEY`
- **HTTP**: Already had precheck for `CEZ_HTTP_AGENT_CONFIG`

**Cache behavior updated:**

The `cacheTtlFor` function now excludes HTTP from the all-connected check, since HTTP returns "disconnected" when `CEZ_HTTP_AGENT_CONFIG` is unset (expected for most users). This prevents HTTP's disconnected state from forcing all other providers onto the short cache window.

### 2. Documentation (`docs/using-api-keys.md`)

Created comprehensive guide covering:
- Supported API keys for each provider
- How to use cc-switch with cezar
- Zero-config behavior
- CI/CD usage examples
- Custom endpoints with HTTP agent
- Troubleshooting steps
- Security notes

### 3. Tests (`packages/cezar/src/core/provider-auth.test.ts`)

Added new test suite "API key authentication (precheck)" with 13 tests covering:
- Detection of each provider's API keys
- Bypassing CLI calls when keys are present
- Fallback to CLI check when keys are empty
- Multiple providers with keys simultaneously

Updated existing tests to account for:
- 4 new providers (kilo, gemini, antigravity, http)
- New `PROBE_ROUND` calculation (excludes junie and http)
- New cache behavior (http excluded from all-connected check)

## How It Works

### Authentication Flow

1. **Precheck Phase** (new):
   - When `status()` is called, each provider's `precheck` function runs first
   - If an API key is found in environment variables, return `'connected'` immediately
   - If no key or empty key, return `undefined` to proceed to CLI check

2. **CLI Check Phase** (existing):
   - If precheck returned `undefined`, spawn the provider's CLI
   - Parse the CLI output to determine connection status
   - Cache the result

3. **Priority**:
   - API keys (precheck) take precedence over CLI authentication
   - This means `ANTHROPIC_API_KEY` overrides `claude auth login` state

### Zero Configuration

No configuration files are needed. Cezar automatically:
- Detects API keys in the environment
- Shows providers as "Connected" in Settings → Providers
- Allows tasks to use those providers immediately

### Example Usage

```bash
# Set API keys
export ANTHROPIC_API_KEY=sk-ant-...
export OPENAI_API_KEY=sk-...

# Start cezar - providers show as connected
npm run dev

# Or with cc-switch proxy
export ANTHROPIC_API_KEY=your-cc-switch-key
cezar serve
```

## Backward Compatibility

✅ **Fully backward compatible**

- Existing CLI authentication still works
- No breaking changes to APIs or behavior
- Users without API keys see no difference
- Tests updated to cover both paths

## Testing

All tests pass:
- `npm run typecheck` ✓
- `npm test -- packages/cezar/src/core/provider-auth.test.ts` ✓ (128/128 tests)
- New API key detection tests ✓ (13/13 tests)

## Files Modified

- `packages/cezar/src/core/provider-auth.ts` - Added precheck functions
- `packages/cezar/src/core/provider-auth.test.ts` - Added API key tests, updated fixtures
- `packages/cezar/src/server/provider-auth-runtime.test.ts` - Updated fixtures
- `docs/using-api-keys.md` - New documentation (created)

## Benefits

1. **Zero-config API key support**: Set environment variables and go
2. **Faster authentication checks**: No CLI spawn when API key is present
3. **Proxy-friendly**: Works with cc-switch and other proxies out of the box
4. **CI/CD ready**: No interactive login required in automated environments
5. **Multi-provider**: Same pattern works across all major providers

## Next Steps

Users can now:
1. Set their API keys in environment variables
2. Use cc-switch or other proxies transparently
3. Run cezar in CI/CD without interactive authentication
4. Mix and match CLI auth and API keys as needed
