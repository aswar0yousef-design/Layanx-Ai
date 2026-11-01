# Unified model management

The unified council is opt-in and does not replace the existing mission execution or outcome verification.

## Routing

Simple conversation should use one fast model. Complex coding, research, and project tasks may use independent specialists from distinct providers. A final synthesizer produces one user-facing answer. A synthesized answer is **not** proof that a tool executed or that a project passed tests.

## Provider setup

Existing OpenAI, Anthropic, Gemini, and Ollama adapters remain available through the provider registry. Kimi may be configured through an OpenAI-compatible endpoint using a local-only API key; do not commit credentials, environment files, or vault contents.

## Safety and rollout

Keep the feature disabled for routine chat until integrated at the actual request entrypoint. Do not invoke multiple models for every message. Preserve local-only mode and spending limits. Require runtime evidence before marking missions completed. Run the entire TypeScript, unit, Windows, and acceptance suites before merging.

## Current limitations

The model management planner and council exist as separate modules. Production request routing is not yet connected. Kimi registration and provider configuration UI remain pending. Tests must confirm actual end-to-end delivery.
