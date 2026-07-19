# Essence of Poker

This project explores the mathematical essence of poker.

The working premise is that poker can be expressed through a small set of
core mathematical objects and transformations. The goal is to make those ideas
precise, testable, and executable.

## Starting Point

We will build the project in layers:

1. Define the fundamental concepts.
2. Express them as mathematical objects.
3. Implement the smallest executable model.
4. Validate the model against poker situations.
5. Expand only when the essence demands it.

## Rank Encoding

For Texas Hold'em, ranks are encoded from strongest to weakest:

| Rank | Value | Symbol |
| --- | ---: | --- |
| Ace | 1 | A |
| King | 2 | K |
| Queen | 3 | Q |
| Jack | 4 | J |
| Ten | 5 | T |
| Nine | 6 | 9 |
| Eight | 7 | 8 |
| Seven | 8 | 7 |
| Six | 9 | 6 |
| Five | 10 | 5 |
| Four | 11 | 4 |
| Three | 12 | 3 |
| Two | 13 | 2 |

## Suit Tiebreaker

Suits are used only as a tiebreaker when ranks are identical:

| Suit | Value | Symbol |
| --- | ---: | --- |
| Spades | 1 | s |
| Hearts | 2 | h |
| Diamonds | 3 | d |
| Clubs | 4 | c |

For example, `Kh Kc` is ordered as:

1. `Kh`
2. `Kc`

## Hero-Relative Suits

Absolute suits are used for dealing and tie-breaking, but the model perceives
suits from hero's perspective:

- Hero's `Card1` suit is always `Suit 1`.
- Hero's `Card2` suit is also `Suit 1` if it matches `Card1`.
- Hero's `Card2` suit is `Suit 2` if it differs from `Card1`.

For example:

| Hole Cards | Card1 | Card2 |
| --- | --- | --- |
| `Ah Kh` | `A, Suit 1` | `K, Suit 1` |
| `Ah Kc` | `A, Suit 1` | `K, Suit 2` |

Board cards keep the same perspective:

- Flop cards are ordered as `Card1`, `Card2`, and `Card3` by rank first, then
  suit.
- Turn is `Card1` of the turn.
- River is `Card1` of the river.
- If a board card matches an existing hero-relative suit, it keeps that label.
- The first new suit encountered on the ordered board becomes `Suit 3`.
- The next new suit becomes `Suit 4`.

## Five-Card Hand Buckets

Exactly five cards collapse into `7,462` distinct hand-strength gradations,
ordered from best to worst.

The nine classic categories are used:

1. Straight flush
2. Four of a kind
3. Full house
4. Flush
5. Straight
6. Three of a kind
7. Two pair
8. One pair
9. High card

Each bucket includes:

- a `gradation`, where `1` is best and `7462` is worst;
- a `category_name`, such as `Full house`;
- a `subcategory_name`, such as `6s full`;
- a `subsubcategory_name`, such as `6s full of Ks`;
- a full `name`, such as `A-K-J-8-2 high`;
- the underlying `Rank` values in this project's ordering.

The full-deck combo distribution can be computed with:

```python
from essence_of_poker.hand_buckets import FULL_DECK, count_hand_buckets

counts = count_hand_buckets(FULL_DECK)
```

## Assets

An asset is a five-slot object. Each slot is either empty or contains a card.
Every asset also has an associated partial deck.

The consistency condition is:

- no duplicate cards inside the five slots;
- no duplicate cards inside the partial deck;
- no card may appear both in a slot and in the partial deck.

Therefore, if the associated deck is the full deck, all five asset slots must be
empty.

```python
from essence_of_poker.assets import asset_from_cards, empty_asset

asset = empty_asset()
partial_asset = asset_from_cards((card_1, card_2))
```

## NLHE Portfolio

At showdown, hero has exactly `21` five-card assets:

```text
C(7, 5) = 21
```

These are grouped into four hero-relative asset categories:

| Category | Count | Meaning |
| --- | ---: | --- |
| 0-category | 1 | 0 hole cards + 5 community cards |
| H_1-category | 5 | H_1 + 4 community cards |
| H_2-category | 5 | H_2 + 4 community cards |
| H_1-plus-H_2-category | 10 | H_1 + H_2 + 3 community cards |

The portfolio can be built with:

```python
from essence_of_poker.portfolio import build_nlhe_portfolio

portfolio = build_nlhe_portfolio(hole_cards, community_cards)
```

Asset titles use compact card-position names: `H_1` and `H_2` for hero's
holding cards, `F_1` through `F_3` for the flop, `T` for turn, and `R` for
river. The asset definitions keep stable codes such as `1.1`, `2.1`, `3.5`,
and `4.10`.

## Prior Dashboard

Before any cards are dealt, the 21 portfolio assets are still evaluated in the
ordered NLHE deal space. That means assets do not generally share the generic
five-card prior: `H_1`, `H_2`, `F_1`, `F_2`, and `F_3` are ordered labels, and
that ordering changes the distribution of many assets. The generated dashboard
data therefore folds exact priors across the 169 canonical starting-hand
classes.

The dashboard groups assets into the four portfolio categories, colors the nine
classic hand categories, and tracks whether each asset is active. Before any
cards are dealt, all assets are active.

The Config page supports 2-player through 6-player tables. Hero is always shown
as `Hero`; opponents are shown by occupied position. For example, a six-player
table with Hero on `CO` shows opponent pages `LJ`, `HJ`, `BTN`, `SB`, and `BB`.

Use `Deal holding`, `Deal flop`, `Deal turn`, and `Deal river` to advance the
current hand. `New hand` resets the dashboard and rotates Hero to the next
position. The left/right controls replay the visible state at street and action
granularity without moving into future undealt streets.

The dashboard has three chart modes. `Bell` shows the same exact distributions
as a density-style shape. `CDF natural` uses the fixed pre-deal background
distribution for each asset. `CDF straight` switches each chart to its own
distribution-adjusted x-axis, so the prior cumulative line is straight.

Generate the dashboard data with:

```bash
python3 -m pip install -r requirements.txt
node scripts/generate_preflop_primary_prior_cache.mjs
node scripts/split_preflop_aggregate_cache.mjs
node scripts/split_preflop_hidden_villain_cache.mjs
python3 -m essence_of_poker.dashboard_data
```

`scripts/generate_preflop_primary_prior_cache.mjs` is an exact, longer-running
data job. It enumerates each canonical holding class in the ordered street
sample space: holding class, board set, flop subset, and ordered turn/river.
The raw `preflop_primary_prior_cache.json` file is ignored because it is large;
the repository stores the compressed
`essence_of_poker/data/preflop_primary_prior_cache.json.gz` artifact, which the
builder reads directly on a clean checkout.

The preflop hand-aggregate cache and hidden-opponent primary-asset cache are
backend-owned generated data. Some endpoint and file names still use
`hidden-villain` as the stable data-contract key. The dashboard fetches
immutable per-class payloads through:

- `/api/data/preflop-aggregate/<classKey>`
- `/api/data/preflop-hidden-villain/<classKey>`

This keeps the browser from downloading large startup JSON for data that is only
needed after a holding class is known.

## Empirical Range Calibration

The calibration pipeline is isolated in `essence_of_poker.calibration`. It is
designed to ingest PHH-style hand histories first, then later accept commercial
or PokerCraft-derived adapters through the same canonical schema.

The durable local store is SQLite:

```bash
npm run calibration:import -- /path/to/phh-or-jsonl --db data/calibration.sqlite3
npm run calibration:train -- --db data/calibration.sqlite3 --model-key range-action-v1 --folds 5
```

The importer preserves:

- source/site and hand id;
- played date, which is used as a noisy era/skill signal;
- stake size, also used as a noisy skill proxy;
- table size, positions, stacks, board, hole cards when available;
- full street-by-street action history.

Training rows are generated one action at a time. The first formal baseline is a
deterministic hashed softmax model with hand-level cross-validation and
temperature calibration. It predicts action probabilities rather than binary
labels. Player archetypes are also probabilistic: each player receives a soft
match against `complete_novice`, `calling_station`, `nit`, `tag`, `lag`, `gto`,
and `maniac` instead of a single hard class.

Run the calibration tests with:

```bash
python3 -m unittest tests.test_calibration_pipeline
```

For the PHH-scale corpus, use the compact importer and empirical baseline table
generator:

```bash
npm run calibration:import-compact -- data/phh/poker-hand-histories.zip --db data/calibration_compact.sqlite3
npm run calibration:baseline -- --db data/calibration_compact.sqlite3 --output essence_of_poker/data/empirical_baseline_tables.json
```

The baseline artifact contains action probabilities by street, position, player
count, stake bucket, year bucket, facing-aggression state, sizing bucket, and
hand class. It also includes a smoothing hierarchy and held-out fold metrics.

To create a reusable subset of action-rich hands for demos, audits, and later
model debugging:

```bash
npm run calibration:interesting -- --limit 1000 --min-score 12 --scan-limit 100000
```

This writes `data/interesting_hands.sqlite3` and `data/interesting_hands.jsonl`.
Hands are scored for multi-street action, high aggression, all-ins, multi-raise
streets, river decisions, large wagers, multiway pots, and complete boards.
Omit `--scan-limit` to scan the full registered PHH source archive.

Then serve the dashboard through the cache-aware local development server:

```bash
python3 -m essence_of_poker.server --port 8765
```

By default this uses an in-memory cache. To persist expensive exact results in
Redis across server restarts, start Redis separately and provide `REDIS_URL`:

```bash
REDIS_URL=redis://127.0.0.1:6379/0 python3 -m essence_of_poker.server --port 8765
```

Prewarm exact hero preflop win-share caches for all 169 canonical starting-hand
classes:

```bash
node scripts/prewarm_preflop_winshares_parallel.mjs --api http://127.0.0.1:8765 --workers 8
```

If you need manual control, the underlying shardable command is:

```bash
node scripts/prewarm_preflop_winshares.mjs --api http://127.0.0.1:8765 --shard-count 4 --shard-index 0
```

Use shard indexes `0`, `1`, `2`, and `3`.

Prewarm preflop multiway aggregate-equity caches for every canonical holding
class and every supported table size:

```bash
npm run prewarm:preflop-multiway -- --api http://127.0.0.1:8765 --players 2,3,4,5,6
```

These keys are intentionally canonical: preflop entries are keyed by the
starting-hand class, active player count, simulation count, and dashboard asset
version rather than by physical suits or seat labels.

## Hand History And Range Inference

PokerCraft/GG-style hand histories enter through a dedicated import boundary:

- `dashboard/pokercraft_parser.mjs` parses source text.
- `dashboard/hand_history_model.mjs` defines the canonical history shape.
- `dashboard/import_normalizer.mjs` converts imported hands into app-level
  table config, cards, board, and linear player actions.

Range inference is intentionally separate from the front-page UI. The current
preflop engine generates every legal two-card combo, scores combos with
deterministic hand features, calibrates smooth action likelihoods to target
frequencies, and updates weights through the action history. This keeps ranges
as latent state: users provide cards/actions/imported history, and the engine
derives hidden weighted ranges for later equity work.

## Production Build And Deployment Boundary

Production deploys should serve a built dashboard artifact, not the editable
`dashboard/` source directory. From a clean checkout, the reproducible sequence
is:

```bash
python3 -m pip install -r requirements.txt
python3 -m pip install -e .
npm install
python3 -m essence_of_poker.dashboard_data
node scripts/split_preflop_aggregate_cache.mjs
node scripts/split_preflop_hidden_villain_cache.mjs
python3 -m unittest
npm test
node scripts/performance_budgets.mjs
python3 -m essence_of_poker.build_dashboard --output dist/dashboard
node scripts/browser_smoke.mjs --dashboard-root dist/dashboard
```

The build command copies the static dashboard into `dist/dashboard`, computes a
content hash for every asset, injects the dashboard asset version into
`index.html`, and writes:

- `dist/dashboard/asset-manifest.json`
- `dist/dashboard/build_info.json`

Generated artifacts follow an explicit repository policy checked by:

```bash
npm run artifacts:check
```

The policy is:

- `data/**`, including raw PHH archives and SQLite calibration databases, is
  local-only and must not be tracked.
- `dist/**` is build output and must not be tracked.
- monolithic generated cache JSON files under `essence_of_poker/data/` are
  local-generated intermediates and must not be tracked.
- per-class compressed generated payloads and generated manifests under
  `essence_of_poker/data/` may be tracked intentionally when they are part of
  the reproducible dashboard contract.

The server treats versioned static assets (`?v=...`) as immutable for one year.
The entry HTML and cache API are served with freshness-oriented/no-store
policies so deploys and exact cache reads are not pinned by the browser.
`/api/health` reports the active cache backend, build metadata, and whether the
required 169 preflop aggregate, hidden-opponent, and primary-prior class
artifacts are present.

Redis cache keys include both a schema version and the built dashboard asset
version. To prewarm for a specific production build, pass the same version that
appears in `dist/dashboard/build_info.json`:

```bash
VERSION=$(python3 -c 'import json; print(json.load(open("dist/dashboard/build_info.json"))["version"])')
node scripts/prewarm_preflop_winshares_parallel.mjs --api http://127.0.0.1:8765 --cache-version "$VERSION" --workers 8
npm run prewarm:preflop-multiway -- --api http://127.0.0.1:8765 --cache-version "$VERSION" --players 2,3,4,5,6
```

Cache-family and generated-data contract versions live in
`dashboard/version_registry.mjs`; the backend exposes the matching registry in
`/api/health` so deployed assets and server state can be checked together.

For local smoke-testing, serve the production artifact with the development
server:

```bash
REDIS_URL=redis://127.0.0.1:6379/0 \
python3 -m essence_of_poker.server --port 8765 --dashboard-root dist/dashboard
```

For production, host the WSGI boundary under a real WSGI server and put static
asset delivery behind the platform web server or reverse proxy:

```bash
ESSENCE_DASHBOARD_ROOT=dist/dashboard \
REDIS_URL=redis://127.0.0.1:6379/0 \
ESSENCE_CACHE_WRITE_TOKEN=change-me \
gunicorn essence_of_poker.wsgi:application
```

Cache writes are intentionally guarded. Without additional configuration, the
server accepts `PUT /api/cache/...` only from loopback clients, which is the
right default for local development. For a non-local deployment that allows
prewarmers or trusted clients to write cache entries, set
`ESSENCE_CACHE_WRITE_TOKEN` and send it as `X-Essence-Cache-Token` with cache
write requests.

Then prewarm exact hero preflop win-share caches through the same cache API the
dashboard uses:

```bash
node scripts/prewarm_preflop_winshares.mjs --api http://127.0.0.1:8765
npm run prewarm:preflop-multiway -- --api http://127.0.0.1:8765
```

For token-protected cache writes, either export `ESSENCE_CACHE_WRITE_TOKEN` for
the prewarm process or pass `--cache-write-token "$ESSENCE_CACHE_WRITE_TOKEN"`.

For multi-core warmup, run the shard command shown above against the production
server URL.

The deployment health contract is:

```bash
curl http://127.0.0.1:8765/api/health
```

The response includes `ok`, cache backend status, cache-write security mode,
whether `REDIS_URL` was configured and reachable, the served dashboard root, and
the build metadata.
If Redis is configured but unavailable, the server falls back to memory cache
and reports that in `/api/health`.

For CI environments that guarantee Playwright browsers are installed, add
`--require-browser` to make the browser smoke fail instead of skip when Chromium
is unavailable.

The full local verification gate is:

```bash
./scripts/verify.sh
```

## Open Questions

- What is the first primitive: cards, ranges, information, decisions, equity,
  payoff, or something more abstract?
- Is the essence game-theoretic, probabilistic, informational, or a synthesis?
- What is the smallest poker situation that demonstrates the theory?
