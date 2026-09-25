# Zero-conf demo LLM for dev (p2 phase a): routes the interview agent
# through a shared demo endpoint via the existing DI_LLM__* env
# overrides — the server config schema needs no change. Provide the
# endpoint via DI_DEMO_LLM_* env vars (e.g. in .env, loaded by mise).
# STT/TTS keep whatever the caller set (local stack from dev-env.sh, or
# unset). Source before starting the di server, e.g.
# `source scripts/dev-env-demo-llm.sh`.
export DI_LLM__PROVIDER=openai
export DI_LLM__BASE_URL="${DI_DEMO_LLM_BASE_URL:?set DI_DEMO_LLM_BASE_URL}"
export DI_LLM__MODEL="${DI_DEMO_LLM_MODEL:?set DI_DEMO_LLM_MODEL}"
export DI_LLM__API_KEY="${DI_DEMO_LLM_API_KEY:?set DI_DEMO_LLM_API_KEY}"
