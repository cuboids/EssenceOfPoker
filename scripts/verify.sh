#!/usr/bin/env bash
set -euo pipefail

regenerate_data="${ESSENCE_REGENERATE_DATA:-0}"
if [[ "${1:-}" == "--regenerate-data" ]]; then
  regenerate_data="1"
fi

python3 scripts/check_artifact_policy.py
node scripts/lint.mjs
npm run typecheck
if [[ "$regenerate_data" == "1" ]]; then
  python3 -m essence_of_poker.dashboard_data
  node scripts/split_preflop_primary_prior_cache.mjs
else
  python3 scripts/check_generated_data_ready.py
fi
python3 -m unittest
node scripts/run_js_tests_tier.mjs all
node scripts/performance_budgets.mjs
python3 -m essence_of_poker.build_dashboard --output dist/dashboard
node scripts/browser_smoke.mjs --dashboard-root dist/dashboard
