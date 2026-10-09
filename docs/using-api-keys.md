# Using Coding Agents with API Keys and Custom Endpoints

Cezar supports using coding agents with API keys and custom endpoints instead of official authentication methods. This is useful when:

- Using proxy services like [cc-switch](https://github.com/farion1231/cc-switch)
- Working with custom endpoints or self-hosted models
- Bypassing official login flows in CI/CD environments
- Using BYOK (Bring Your Own Key) approaches
- Routing providers through custom gateways or load balancers

## Supported Providers

All major providers support both API key authentication AND custom endpoints:

### Claude

```bash
# API key only
export ANTHROPIC_API_KEY=sk-ant-...

# Custom endpoint (with or without API key)
export ANTHROPIC_BASE_URL=https://custom-endpoint.com

# Both (most common with proxies)
export ANTHROPIC_API_KEY=your-key
export ANTHROPIC_BASE_URL=https://your-proxy.com/claude
```

### Codex

```bash
# OpenAI API
export OPENAI_API_KEY=sk-...
export OPENAI_BASE_URL=https://custom-endpoint.com

# Or Azure OpenAI
export AZURE_OPENAI_API_KEY=...
export AZURE_OPENAI_ENDPOINT=https://your-resource.openai.azure.com
```

### OpenCode, Pi, Kilo

These multi-provider agents support any combination of:

**API Keys:**
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

**Custom Endpoints:**
```bash
export OPENAI_BASE_URL=https://custom-openai.com
export ANTHROPIC_BASE_URL=https://custom-anthropic.com
export AZURE_OPENAI_ENDPOINT=https://custom-azure.com
export OPENROUTER_BASE_URL=https://custom-openrouter.com
export GROQ_BASE_URL=https://custom-groq.com
export MISTRAL_BASE_URL=https://custom-mistral.com
```

### Cursor

```bash
export CURSOR_API_KEY=...
export CURSOR_BASE_URL=https://custom-cursor.com
```

### Gemini / Antigravity

```bash
export GEMINI_API_KEY=...
export GOOGLE_GENERATIVE_AI_API_KEY=...
export GOOGLE_API_BASE_URL=https://custom-google-api.com
```

### HTTP Agent (for any OpenAI-compatible endpoint)

```bash
export CEZ_HTTP_AGENT_CONFIG='{"endpoint":"https://api.example.com/v1/chat/completions","apiKey":"your-key","model":"model-name"}'
```

## Using cc-switch

[cc-switch](https://github.com/farion1231/cc-switch) is a proxy that allows using Claude Code and other agents with alternative API keys or endpoints.

1. **Start cc-switch** following its documentation

2. **Configure your environment** with both the base URL and API keys:

```bash
# Point providers to cc-switch endpoint
export ANTHROPIC_BASE_URL=http://localhost:8000
export OPENAI_BASE_URL=http://localhost:8000

# Set your API keys
export ANTHROPIC_API_KEY=your-cc-switch-key
export OPENAI_API_KEY=your-cc-switch-key
```

3. **Start cezar** - providers will automatically show as "Connected"

```bash
npm run dev
# or
cezar serve
```

### When cc-switch writes the config file instead of exporting

cc-switch can also switch providers by writing the endpoint into the agent's OWN config file — `~/.claude/settings.json`'s `env` block, or a `[model_providers.<id>]` entry in `~/.codex/config.toml` — and never exports anything. Cezar reads those files too, so a setup configured that way still shows as "Connected" with nothing in the environment:

- **Claude**: an `ANTHROPIC_BASE_URL`, `ANTHROPIC_AUTH_TOKEN` or `ANTHROPIC_API_KEY` in the `env` block of `~/.claude/settings.json`.
- **Codex**: the `model_provider` selected in `~/.codex/config.toml` must name a `[model_providers.<id>]` entry that carries its own endpoint and credential — `requires_openai_auth = false`, an `experimental_bearer_token`, or an `env_key` whose variable is set. A `base_url` alone is not enough, because the built-in `openai` provider keeps its ChatGPT login even when pointed elsewhere. (For such a custom provider `codex login status` answers "Not logged in" while the CLI runs fine, so cezar would otherwise call a working setup disconnected.)

A named agent account (Settings → Agent accounts) is probed against its OWN config directory, not the default one.

## Using Other Proxies or Custom Infrastructure

The same pattern works for any proxy or custom gateway:

```bash
# Enterprise API gateway
export ANTHROPIC_BASE_URL=https://api-gateway.company.com/anthropic
export OPENAI_BASE_URL=https://api-gateway.company.com/openai
export ANTHROPIC_API_KEY=internal-token
export OPENAI_API_KEY=internal-token

# Load balancer
export ANTHROPIC_BASE_URL=https://lb.internal/claude
export ANTHROPIC_API_KEY=your-key

# Self-hosted proxy
export OPENAI_BASE_URL=http://proxy.local:8080
export OPENAI_API_KEY=local-key
```

## Zero Configuration

Cezar automatically detects both API keys and custom endpoints — in your environment, or written into the coding agents' own config files by a provider switcher such as cc-switch. When either is present:

- The provider shows as "Connected" in Settings → Providers
- No CLI authentication is required
- Tasks can be created using that provider immediately

## Priority

When multiple authentication methods are present, Cezar uses this priority:

1. **Custom endpoints or API keys** (checked first via `precheck`)
2. **CLI authentication** (checked if no endpoint/key is found)

This means custom configurations take precedence over official logins.

## CI/CD Usage

Custom endpoints and API keys are particularly useful in CI/CD environments:

```yaml
# .github/workflows/example.yml
env:
  ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
  ANTHROPIC_BASE_URL: ${{ secrets.ANTHROPIC_BASE_URL }}
  OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
  OPENAI_BASE_URL: ${{ secrets.OPENAI_BASE_URL }}

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

- Check that environment variables are set: `env | grep -E 'API_KEY|BASE_URL|ENDPOINT'`
- Verify variable names are exact (e.g., `ANTHROPIC_API_KEY`, not `ANTHROPIC_KEY`)
- Ensure values are not empty
- Restart cezar after setting variables

### Verify environment variables

```bash
# Check if keys/endpoints are visible
echo $ANTHROPIC_API_KEY
echo $ANTHROPIC_BASE_URL

# Or list all relevant variables
env | grep -E 'API_KEY|BASE_URL|ENDPOINT'
```

### Check provider status

```bash
# From cezar CLI
cezar --version  # Ensure cezar can see the environment

# Or use curl (when server is running)
curl http://localhost:3000/api/v1/providers/status
```

### Connection fails despite correct configuration

- Test the custom endpoint directly with curl:
  ```bash
  curl -X POST $ANTHROPIC_BASE_URL/v1/messages \
    -H "x-api-key: $ANTHROPIC_API_KEY" \
    -H "Content-Type: application/json" \
    -d '{"model":"claude-3-5-sonnet-20241022","messages":[{"role":"user","content":"hi"}],"max_tokens":100}'
  ```
- Verify the endpoint is reachable from your network
- Check if the endpoint requires specific headers or auth format

## Security Notes

- API keys and base URLs in environment variables are visible to subprocesses
- Keys are redacted in cezar's logs and event streams
- Never commit sensitive values to version control
- Use `.env` files (gitignored) for local development:

```bash
# .env (add to .gitignore)
ANTHROPIC_API_KEY=sk-ant-...
ANTHROPIC_BASE_URL=https://...
OPENAI_API_KEY=sk-...
OPENAI_BASE_URL=https://...
```

Then load with:
```bash
export $(cat .env | xargs)
cezar serve
```

## See Also

- [HTTP_AGENT_README.md](../HTTP_AGENT_README.md) - HTTP agent for any OpenAI-compatible endpoint
- [AGENTS.md](../AGENTS.md) - Agent architecture and least-privilege environment
- [docs/adding-issue-tracker.md](./adding-issue-tracker.md) - Similar integration patterns
- [Provider authentication tests](../packages/cezar/src/server/provider-auth-runtime.test.ts)
