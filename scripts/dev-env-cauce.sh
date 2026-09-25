# Zero-conf LLM for dev (p2 phase a): routes the interview agent through
# the CAUCE managed endpoint via the existing DI_LLM__* env overrides —
# the server config schema needs no change. STT/TTS keep whatever the
# caller set (local stack from dev-env.sh, or unset). Source before
# starting the di server, e.g. `source scripts/dev-env-cauce.sh`.
export DI_LLM__PROVIDER=openai
export DI_LLM__BASE_URL="${CAUCE_AI_BASE_URL:?set CAUCE_AI_BASE_URL}"
export DI_LLM__MODEL="${CAUCE_AI_MODEL:?set CAUCE_AI_MODEL}"
export DI_LLM__API_KEY="${CAUCE_AI_API_KEY:?set CAUCE_AI_API_KEY}"
