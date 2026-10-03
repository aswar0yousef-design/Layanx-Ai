# LayanX Free AI Capacity Pool

The free pool is an optional layer on top of the existing ModelRegistry and ModelExecutionRouter. It does not replace local Ollama, paid providers, agent routing, verification, recovery, or security controls.

## Goals

- Aggregate multiple OpenAI-compatible gateways without duplicating the LayanX router.
- Keep provider/model identity separate when different gateways expose the same model name.
- Prefer configured free capacity only when explicitly enabled.
- Count reported input/output tokens per provider.
- Stop using a provider when its configured daily/monthly quota is exhausted.
- Temporarily cool down a provider after a 429/rate-limit response.
- Fail over through the existing ModelExecutionRouter.
- Keep all credentials outside Git.

## Enablement

Keep the default local-first behavior:

`LAYANX_FREE_POOL_ENABLED=false`

To enable the pool:

`LAYANX_FREE_POOL_ENABLED=true`

Set:

`LAYANX_FREE_POOL_CONFIG=.layanx/free-providers.json`

To make LayanX prefer free models whenever a request does not specify a stronger routing preference:

`LAYANX_AI_PREFER_FREE=true`

The free pool can be used alongside Ollama. Local Ollama remains selectable with `preferLocal=true`.

## Provider configuration

Copy `config/free-providers.example.json` to `.layanx/free-providers.json` and replace the placeholder model IDs with the model IDs actually exposed by the gateway.

Use `apiKeyEnv` rather than putting credentials in the JSON file. The environment variable is resolved only at runtime.

A provider can be a local FreeLLMAPI/OmniRoute gateway or any other OpenAI-compatible endpoint that the user is authorized to access.

## Quotas

`dailyTokenLimit` and `monthlyTokenLimit` are optional local safety caps. They are not claims about an upstream provider's real quota.

If upstream usage data is returned, LayanX records input + output tokens. If the provider does not return usage, LayanX cannot invent a token count.

## Routing

When `preferFree=true`, models tagged `free` receive a routing preference. The existing health gate still runs before execution. An unavailable, rate-limited, or exhausted provider is skipped and the existing failover path continues to the next candidate.

No second router is introduced.

## Security and terms

LayanX does not bypass provider limits, create fake accounts, rotate credentials to evade limits, or scrape private endpoints. Each provider remains subject to its own account limits and terms.

The pool is an optimization layer for legitimately available free capacity, not a guarantee of free inference.
