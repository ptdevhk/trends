#!/usr/bin/env bash
# ai-model-check.sh — Validate AI_MODEL against AI_API_BASE
#
# Checks:
# 1. AI_MODEL is set and has provider/ prefix format
# 2. AI_API_KEY is set
# 3. The model is reachable at the configured API endpoint
#
# Usage:
#   ./scripts/ai-model-check.sh           # reads from .env
#   AI_MODEL=openai/gpt-4o-mini ./scripts/ai-model-check.sh
#
# Exit codes: 0 = pass, 1 = fail, 2 = warning

set -euo pipefail

# Load .env if present
if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

MODEL="${AI_MODEL:-}"
API_BASE="${AI_API_BASE:-${OPENAI_API_BASE:-https://api.openai.com/v1}}"
API_KEY="${AI_API_KEY:-${OPENAI_API_KEY:-}}"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
NC='\033[0m'

errors=0
warnings=0

echo "AI Model Compatibility Check"
echo "============================="

# Check 1: AI_MODEL is set
if [ -z "$MODEL" ]; then
  echo -e "${RED}FAIL${NC}: AI_MODEL is not set"
  errors=$((errors + 1))
else
  echo -e "${GREEN}PASS${NC}: AI_MODEL is set to '$MODEL'"
fi

# Check 2: provider/ prefix format
if [ -n "$MODEL" ]; then
  if [[ "$MODEL" != */* ]]; then
    echo -e "${YELLOW}WARN${NC}: AI_MODEL lacks provider/ prefix (expected format: provider/model-name). BFF requires this format; Convex strips it automatically."
    warnings=$((warnings + 1))
  else
    echo -e "${GREEN}PASS${NC}: AI_MODEL has provider/ prefix format"
  fi
fi

# Check 3: AI_API_KEY is set
if [ -z "$API_KEY" ]; then
  echo -e "${RED}FAIL${NC}: AI_API_KEY / OPENAI_API_KEY is not set"
  errors=$((errors + 1))
else
  masked="${API_KEY:0:8}...${API_KEY: -4}"
  echo -e "${GREEN}PASS${NC}: API key is set ($masked)"
fi

# Check 4: Model is reachable at API endpoint
if [ -n "$MODEL" ] && [ -n "$API_KEY" ]; then
  # Strip provider/ prefix for the API call (matching Convex resolveChatCompletionModel behavior)
  STRIPPED_MODEL="${MODEL#*/}"
  MODELS_URL="${API_BASE%/}/models"

  echo ""
  echo "Checking model availability at $MODELS_URL ..."

  HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" \
    -H "Authorization: Bearer $API_KEY" \
    "$MODELS_URL" 2>/dev/null || echo "000")

  if [ "$HTTP_CODE" = "200" ]; then
    # Try to find the model in the list
    MODELS_RESPONSE=$(curl -s -H "Authorization: Bearer $API_KEY" "$MODELS_URL" 2>/dev/null || echo "")
    if echo "$MODELS_RESPONSE" | grep -q "\"$STRIPPED_MODEL\""; then
      echo -e "${GREEN}PASS${NC}: Model '$STRIPPED_MODEL' found in API models list"
    else
      echo -e "${YELLOW}WARN${NC}: Model '$STRIPPED_MODEL' not found in /v1/models list. It may still work (some providers don't list all models)."
      warnings=$((warnings + 1))
    fi
  elif [ "$HTTP_CODE" = "000" ]; then
    echo -e "${YELLOW}WARN${NC}: Could not connect to $MODELS_URL (network error)"
    warnings=$((warnings + 1))
  else
    echo -e "${YELLOW}WARN${NC}: API returned HTTP $HTTP_CODE for $MODELS_URL (may still work with chat completions)"
    warnings=$((warnings + 1))
  fi
fi

# Check 5: Known-model warning
KNOWN_MODELS="gpt-4o-mini gpt-4o gpt-4-turbo gpt-4 gpt-3.5-turbo openai/gpt-4o-mini openai/gpt-4o openai/gpt-4-turbo-preview deepseek/deepseek-chat deepseek/deepseek-reasoner"
if [ -n "$MODEL" ]; then
  STRIPPED="${MODEL#*/}"
  if echo "$KNOWN_MODELS" | grep -qw "$MODEL" || echo "$KNOWN_MODELS" | grep -qw "$STRIPPED"; then
    echo -e "${GREEN}PASS${NC}: Model is in the known-good list"
  else
    echo -e "${YELLOW}WARN${NC}: Model '$MODEL' is not in the known-good list. Untested model — verify manually."
    warnings=$((warnings + 1))
  fi
fi

# Summary
echo ""
echo "============================="
if [ "$errors" -gt 0 ]; then
  echo -e "${RED}RESULT: FAIL${NC} ($errors error(s), $warnings warning(s))"
  exit 1
elif [ "$warnings" -gt 0 ]; then
  echo -e "${YELLOW}RESULT: WARNING${NC} (0 errors, $warnings warning(s))"
  exit 2
else
  echo -e "${GREEN}RESULT: PASS${NC} (0 errors, 0 warnings)"
  exit 0
fi
