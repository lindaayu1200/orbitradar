# orbitradar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/lindaayu1200/orbitradar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/lindaayu1200/orbitradar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token launch radar for make.fun's token-radar-01 bounty: it reads one sealed DefiLlama snapshot, fits every pre-token protocol's implied value from comparable trading peers (with leave-one-out and walk-forward held-out tests on every fitted term, and tested-not-kept terms shown rather than hidden), estimates token-launch odds with a logistic model fitted on all 758 protocols, and ranks 200 protocols with costed, net-of-fees farm plans (FARM / THIN / SKIP verdicts with dollars per hour).

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>
```

The ranked board lands in `out/board.json`, the dashboard data in `out/data.js`, and the judge's dossier in `out/dossier.json`.

## Model

- Value = TVL x fitted peer multiple x growth term x age term x token odds, with a P25-P75 range from the peer set's own ratio quartiles.
- Every candidate term must lower held-out error in BOTH a leave-one-out test and a walk-forward test or it is listed as tested, not kept.
- Token odds come from a logistic fit over the whole snapshot (age, growth, size, watchlist flag) with its Brier score reported against the base rate.
- The page re-derives its own audit checks on load: watchlist coverage, rank monotonicity, protocol accounting and a board checksum.

---

<sub>Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
