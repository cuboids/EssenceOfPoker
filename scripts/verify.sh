#!/usr/bin/env bash
set -euo pipefail

python3 -m essence_of_poker.dashboard_data
node scripts/split_preflop_primary_prior_cache.mjs
python3 -m unittest
node --test tests/*.test.mjs
node scripts/performance_budgets.mjs
python3 -m essence_of_poker.build_dashboard --output dist/dashboard
node scripts/browser_smoke.mjs --dashboard-root dist/dashboard
