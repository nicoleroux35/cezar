# HTTP Agent - Using Any OpenAI-Compatible Endpoint

The HTTP agent (`packages/cezar/src/core/http-agent-runner.ts`) allows you to use **any OpenAI-compatible API endpoint** with cezar, without needing the official CLI for that provider.

## Quick Start

Configure via the `CEZ_HTTP_AGENT_CONFIG` environment variable:

```bash
export CEZ_HTTP_AGENT_CONFIG='{"endpoint":"https://api.example.com/v1/chat/completions","apiKey":"your-key","model":"model-name"}'
```

Then use it in cezar:

```bash
# Create a task using the HTTP agent
cezar task create --backend=http --task="Your task description"

# Or in a workflow, specify backend: http
```

## Configuration Options

The `CEZ_HTTP_AGENT_CONFIG` JSON object supports:

| Field | Required | Description | Example |
|-------|----------|-------------|---------|
| `endpoint` | ✅ | The chat completions endpoint URL | `"https://api.groq.com/openai/v1/chat/completions"` |
| `apiKey` | ❌ | API key for authentication | `"gsk-..."` |
| `model` | ❌ | Default model to use | `"mixtral-8x7b-32768"` |
| `temperature` | ❌ | Sampling temperature (0-1) | `0.7` (default) |
| `maxTokens` | ❌ | Maximum tokens in response | `4096` (default) |

## Use Cases

### 1. Free-Tier Providers

Use free or low-cost providers like Groq, DeepInfra, or Together:

```bash
# Groq
export CEZ_HTTP_AGENT_CONFIG='{"endpoint":"https://api.groq.com/openai/v1/chat/completions","apiKey":"gsk-...","model":"mixtral-8x7b-32768"}'

# DeepInfra
export CEZ_HTTP_AGENT_CONFIG='{"endpoint":"https://api.deepinfra.com/v1/openai/chat/completions","apiKey":"...","model":"meta-llama/Meta-Llama-3-70B-Instruct"}'
```

### 2. Local Models (Ollama, LM Studio)

Run against local inference servers:

```bash
# Ollama
export CEZ_HTTP_AGENT_CONFIG='{"endpoint":"http://localhost:11434/v1/chat/completions","model":"llama3"}'

# LM Studio
export CEZ_HTTP_AGENT_CONFIG='{"endpoint":"http://localhost:1234/v1/chat/completions","model":"local-model"}'
```

### 3. Proxy Services (cc-switch)

Use with [cc-switch](https://github.com/farion1231/cc-switch) or other proxies:

```bash
# cc-switch typically runs on localhost:8000
export CEZ_HTTP_AGENT_CONFIG='{"endpoint":"http://localhost:8000/v1/chat/completions","apiKey":"your-key","model":"claude-sonnet-4"}'
```

### 4. Custom Endpoints

Point to your own API gateway or custom backend:

```bash
export CEZ_HTTP_AGENT_CONFIG='{"endpoint":"https://your-api.company.com/ai/chat","apiKey":"internal-key","model":"custom-model"}'
```

## How It Works

1. **No CLI Required**: The HTTP agent makes direct HTTP calls, no external binary needed
2. **OpenAI-Compatible**: Expects OpenAI's chat completions API format (most providers support this)
3. **Streaming**: Uses server-sent events (SSE) for real-time response streaming
4. **Simple Protocol**: Only text streaming - no tool calls or complex agentic features

## Protocol Mapping

The HTTP agent implements the `AgentRunner` interface but with limitations:

| Feature | Supported? | Notes |
|---------|-----------|-------|
| Text streaming | ✅ | Via SSE |
| Images in prompt | ✅ | Converted to data URLs |
| Tool calls | ❌ | Simple text-only |
| Multi-turn conversations | ✅ | Via `sendMessage()` |
| Token counting | ⚠️ | Rough estimate (1 token ≈ 4 chars) |

## Status in UI

The HTTP agent appears in **Settings → Providers** as "HTTP Agent":

- **Connected**: When `CEZ_HTTP_AGENT_CONFIG` is set with a valid endpoint
- **Not connected**: When the config is missing or invalid

## Comparison with Other Providers

| Provider | Requires CLI? | Tool Calls? | Best For |
|----------|--------------|-------------|----------|
| Claude | ✅ (or API key) | ✅ | Full agentic workflows |
| Codex | ✅ (or API key) | ✅ | Full agentic workflows |
| OpenCode | ✅ (or API key) | ✅ | Multi-provider support |
| **HTTP** | ❌ | ❌ | Simple tasks, custom endpoints, local models |

## Example: Complete Workflow

```bash
# 1. Set up HTTP agent with Groq
export CEZ_HTTP_AGENT_CONFIG='{
  "endpoint":"https://api.groq.com/openai/v1/chat/completions",
  "apiKey":"gsk-your-key-here",
  "model":"mixtral-8x7b-32768",
  "temperature":0.7,
  "maxTokens":8192
}'

# 2. Verify it shows as connected
cezar serve
# Open http://localhost:3000 → Settings → Providers
# "HTTP Agent" should show "Connected"

# 3. Use it in a task
cezar task create \
  --backend=http \
  --task="Write a function to parse JSON safely in TypeScript"

# 4. Or create a workflow that uses it
cat > .ai/cezar/workflows/quick-review.yml <<EOF
name: quick-review
steps:
  - name: review
    backend: http
    prompt: "Review the code for obvious issues: {{task}}"
EOF
```

## Troubleshooting

### "Not connected" in UI

- Check that `CEZ_HTTP_AGENT_CONFIG` is set: `echo $CEZ_HTTP_AGENT_CONFIG`
- Verify it's valid JSON: `echo $CEZ_HTTP_AGENT_CONFIG | jq .`
- Ensure the `endpoint` field is present

### Task fails with connection error

- Test the endpoint with curl:
  ```bash
  curl -X POST https://your-endpoint/v1/chat/completions \
    -H "Authorization: Bearer your-key" \
    -H "Content-Type: application/json" \
    -d '{"model":"test","messages":[{"role":"user","content":"hi"}]}'
  ```
- Check if the endpoint requires specific headers or auth format

### Empty or garbled responses

- Verify the endpoint is OpenAI-compatible
- Check if the model name is correct for that provider
- Try increasing `maxTokens` if responses are cut off

## Security Notes

- API keys in environment variables are visible to subprocesses
- Keys are redacted in cezar's logs and event streams
- Never commit `CEZ_HTTP_AGENT_CONFIG` with real keys to git
- Use `.env` files (gitignored) for local development

## See Also

- [docs/using-api-keys.md](docs/using-api-keys.md) - Using other providers with API keys
- [AGENTS.md](AGENTS.md) - Agent architecture and environment handling
- [packages/cezar/src/core/http-agent-runner.ts](packages/cezar/src/core/http-agent-runner.ts) - Implementation
