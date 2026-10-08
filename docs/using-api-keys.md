# Using Coding Agents with API Keys

Cezar supports using coding agents with API keys instead of official authentication methods. This is useful when:

- Using proxy services like [cc-switch](https://github.com/farion1231/cc-switch)
- Working with custom endpoints or self-hosted models
- Bypassing official login flows in CI/CD environments
- Using BYOK (Bring Your Own Key) approaches

## Supported Providers

All major providers support API key authentication:

### Claude

```bash
export ANTHROPIC_API_KEY=sk-ant-...
```

### Codex

```bash
# OpenAI API
export OPENAI_API_KEY=sk-...

# Or Azure OpenAI
export AZURE_OPENAI_API_KEY=...
export AZURE_OPENAI_ENDPOINT=https://...
```

### OpenCode, Pi, Kilo

These multi-provider agents support any of:

```bash
export OPENAI_API_KEY=sk-...
export ANTHROPIC_API_KEY=sk-ant-...
export AZURE_OPENAI_API_KEY=...
export OPENROUTER_API_KEY=...
export GROQ_API_KEY=...
export MISTRAL_API_KEY=...
export GEMINI_API_KEY=...
export GOOGLE_GENERATIVE_AI_API_KEY=...
export DEEPSEEK_API_KEY=...
export XAI_API_KEY=...
export PERPLEXITY_API_KEY=...
export TOGETHER_API_KEY=...
export FIREWORKS_API_KEY=...
```

### Gemini / Antigravity

```bash
export GEMINI_API_KEY=...
# or
export GOOGLE_GENERATIVE_AI_API_KEY=...
```

### Cursor

```bash
export CURSOR_API_KEY=...
```

### HTTP Agent (for any OpenAI-compatible endpoint)

```bash
export CEZ_HTTP_AGENT_CONFIG='{"endpoint":"https://api.example.com/v1/chat/completions","apiKey":"your-key","model":"model-name"}'
```

## Using cc-switch

[cc-switch](https://github.com/farion1231/cc-switch) is a proxy that allows using Claude Code and other agents with alternative API keys or endpoints.

1. **Start cc-switch** following its documentation

2. **Configure your environment** with the API keys cc-switch expects

3. **Start cezar** - it will automatically detect the API keys and show providers as "Connected"

```bash
# Example with cc-switch
export ANTHROPIC_API_KEY=your-alternative-key
export OPENAI_API_KEY=your-alternative-key

# Start cezar
npm run dev
# or
cezar serve
```

## Zero Configuration

Cezar automatically detects API keys in your environment. When a supported API key is present:

- The provider shows as "Connected" in Settings → Providers
- No CLI authentication is required
- Tasks can be created using that provider immediately

## Priority

When both CLI authentication and API keys are present, Cezar uses this priority:

1. **API keys** (checked first via `precheck`)
2. **CLI authentication** (checked if no API key is found)

This means API keys take precedence over official logins.

## CI/CD Usage

API keys are particularly useful in CI/CD environments where interactive login isn't possible:

```yaml
# .github/workflows/example.yml
env:
  ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
  OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}

steps:
  - run: npx @open-mercato/cezar run --backend=claude --task="Review this PR"
```

## Custom Endpoints

For custom or self-hosted endpoints, use the HTTP agent:

```bash
# Local Ollama
export CEZ_HTTP_AGENT_CONFIG='{"endpoint":"http://localhost:11434/v1/chat/completions","model":"llama3"}'

# Custom proxy
export CEZ_HTTP_AGENT_CONFIG='{"endpoint":"https://your-proxy.com/v1/chat/completions","apiKey":"your-key","model":"gpt-4"}'

# Then use with:
cezar task create --backend=http --task="Your task"
```

## Troubleshooting

### Provider still shows "Not connected"

Make sure:
1. The environment variable is exported in the shell where cezar runs
2. The variable name is exact (e.g., `ANTHROPIC_API_KEY`, not `ANTHROPIC_KEY`)
3. The value is not empty
4. You've restarted cezar after setting the variable

### Verify environment variables

```bash
# Check if the key is visible
echo $ANTHROPIC_API_KEY

# Or list all relevant keys
env | grep -E 'API_KEY|ANTHROPIC|OPENAI|GEMINI'
```

### Check provider status

```bash
# From cezar CLI
cezar --version  # Ensure cezar can see the environment

# Or use curl (when server is running)
curl http://localhost:3000/api/v1/providers/status
```

## Security Notes

- API keys in environment variables are passed to agent subprocesses
- Keys are redacted in cezar's logs and event streams
- Never commit API keys to version control
- Use `.env` files (gitignored) for local development:

```bash
# .env (add to .gitignore)
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...
```

Then load with:
```bash
export $(cat .env | xargs)
cezar serve
```

## See Also

- [AGENTS.md](../AGENTS.md) - Agent architecture and least-privilege environment
- [docs/adding-issue-tracker.md](./adding-issue-tracker.md) - Similar integration patterns
- [Provider authentication tests](../packages/cezar/src/server/provider-auth-runtime.test.ts)
