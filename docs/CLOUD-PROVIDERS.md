# Cloud model providers

LayanX supports a common provider interface for local and cloud models.

Configured cloud providers:
- OpenAI Responses API
- Anthropic Claude Messages API
- Google Gemini API

Set `LAYANX_AI_MODE=cloud` or `hybrid`, then enable only the providers you want. API keys are read from environment variables and are never included in provider summaries.

Example variables are in `.env.example`:
- `OPENAI_ENABLED` / `OPENAI_API_KEY`
- `ANTHROPIC_ENABLED` / `ANTHROPIC_API_KEY`
- `GEMINI_ENABLED` / `GEMINI_API_KEY`

In hybrid mode Ollama is priority 1; enabled cloud providers are registered after it and therefore participate in provider failover.

OpenAI uses the Responses API. Anthropic uses the Messages API. Gemini uses `generateContent`; the provider abstraction keeps the rest of LayanX independent of vendor-specific request and authentication formats.
