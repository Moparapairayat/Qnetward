# 11. AI features call a hosted model through an OpenAI-compatible API

## Status

Accepted. Nothing is built yet; AI features are planned for Phase 5.

## Context

The product plan includes AI features: grouping alerts into a likely cause,
incident summaries, and questions in plain language. We will not use OpenAI,
and we can't run our own GPU servers for now, so models must come from a
hosted provider with an API key, preferably one with a free tier.

Free tiers have low rate limits and no SLA, and some may use the data they
receive for training. Qnetward handles customers' network and security data,
and the plan asks for an option where that data never leaves the tenant.

## Decision

- The backend talks to models through the OpenAI-compatible chat API, which
  most providers and self-hosted servers accept. That is a wire format, not a
  dependency on OpenAI. Configuration is `QNETWARD_AI_BASE_URL`,
  `QNETWARD_AI_API_KEY`, and `QNETWARD_AI_MODEL`; changing provider means
  changing those values, not code.
- Groq's free tier is the first provider for development and the beta.
  OpenRouter's free models are the fallback. Gemini's free tier is used only
  with demo or our own data, because its free-tier terms allow training on
  inputs. Re-check each provider's current limits and data terms before
  turning a feature on.
- AI is off by default per workspace. Turning it on shows that data goes to an
  outside provider.
- Prompts carry only what the feature needs, such as alert names, targets,
  latency and loss figures, and times. Never credentials, tokens, session
  data, or email addresses.
- Each workspace has a daily AI quota, so one tenant can't use up a shared
  free tier.
- If the provider fails or is not configured, AI parts are hidden and the
  rest of the product works as before.

## Consequences

- Moving to a paid provider, a self-hosted model, or a customer's own key
  later is a configuration change.
- Free-tier limits will cap usage during the beta, which the quota makes
  explicit.
- Customers who need data to stay in their boundary wait for a self-hosted
  or bring-your-own-key option.
