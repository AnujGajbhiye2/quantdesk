# Data providers - policies

## Canonical symbol notation is Yahoo notation

Canonical internal symbols (`symbols.symbol`, universe JSONs, strategy regime
indices) use Yahoo-style notation: `NVDA`, `RELIANCE.NS`, `^GSPC`. Adapters
translate to their own notation via `toProviderSymbol()` - that is the contract
(`DataProvider.ts`). Market/currency classification code (`format/fx.ts`,
`market/markets.ts`) keys off this canonical notation, not off any provider.

## Index symbols stay on Yahoo - permanently

`^GSPC`, `^NSEI`, `^IXIC`, `^DJI` (see `scripts/universe/reference.json`) feed
regime gates, the backtest/compare benchmark, and eval scripts. Most paid
providers either do not serve indices (or serve them only on a separate paid
plan, e.g. Polygon's `I:SPX`), and none serve `^NSEI` on the plans we would buy.

Policy: provider migration (`npm run migrate-provider`) applies to tradeable
equities only and skips `^`-prefixed symbols by default. A mixed-provider DB is
fully supported - `symbols.provider_id` is per-row and ingest routes per symbol.

Documented fallback if Yahoo ever dies: switch the benchmark/regime index to a
servable ETF proxy (SPY) - one-line changes in `reference.json` and each
strategy's `regime.index`.

## Adding a new adapter

Follow `_template.ts` and the recipe in `IMPROVEMENT_PLAN.md` WS1 section 1.4:
adjusted prices always, ET calendar dates for daily bars, `validateBars()`
before returning, rate limits/pagination inside the adapter, one `register()`
line in `registry.ts`, one case in `scripts/lib/provider-from-env.ts`, mocked
tests mirroring `yahoo.test.ts` / `alpaca.test.ts`.
