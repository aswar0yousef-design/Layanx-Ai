# LayanX AI Runtime

LayanX supports three provider modes:
- local: Ollama only.
- cloud: OpenAI only when OPENAI_API_KEY is supplied.
- hybrid: local first with cloud available as a secondary model/provider.

## Configuration

Copy .env.example to .env and adjust the values. Never commit .env.

## Commands

- npm run layanx -- status
- npm run layanx -- check
- npm run build
- npm start

The CLI reports configured providers and models without printing credentials.

## Provider health

Ollama health is checked through its tags endpoint. OpenAI health is checked through its models endpoint. Generation uses each provider's dedicated generation endpoint.

## Security

API keys are read from environment variables only. They are not written to runtime summaries, source code, tests, or logs.
