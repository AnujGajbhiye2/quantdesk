# QuantDesk

Self-hosted Bloomberg-terminal-style swing-trading research platform. Dense, dark,
monospace, keyboard-driven. Local SQLite. No cloud.

> **Research tool. Not financial advice. Backtest results are hypothetical and subject
> to survivorship bias, look-ahead error, and other limitations. Past performance does
> not predict future results.**

---

## What it does

- **Terminal dashboard** - multi-panel UI: live quotes, market summary strip, candlestick
  chart, gainers/losers, scan results, signals, trade ideas, strategy edge
- **Backtest engine** - run user-defined strategies against historical OHLCV data;
  reports return %, CAGR, win rate, Sharpe, max drawdown, trade count
- **Signal scanner** - runs any strategy across a watchlist, surfaces current swing-trade
  signals with human-readable reasons
- **Trade ideas** - risk-sized entries with entry price, stop, target, R/R ratio, qty
- **Paper trading** - simulate entries, track open/closed positions, per-strategy hit rates
- **Multi-market** - US equities (S&P 500, Nasdaq-100), Indian equities (Nifty 200),
  pluggable adapter interface for any provider
- **Automated intraday paper-trading** - unattended loop: ingests 15m bars from Alpaca,
  runs multi-strategy consensus scan, applies psychology guards (daily-loss halt,
  max-trades/day, anti-revenge filter, no-late-entry), risk-sizes entries at 1% equity/trade,
  opens paper trades automatically, sweeps stops/targets, sends Telegram notifications

---

## Tech stack

| Concern | Choice | Notes |
|---|---|---|
| Framework | Next.js 15 (App Router) + React 19 + TypeScript strict | `"strict": true` throughout |
| Styling | Tailwind CSS | Terminal theme via CSS variables |
| Charts | lightweight-charts v5 | v5 API - use `addSeries(CandlestickSeries, ...)` not removed `addCandlestickSeries()` |
| Indicators | `@ixjb94/indicators` | Pure TS, zero native deps |
| Database | SQLite via `better-sqlite3` | Synchronous, single-user local |
| Data fetch | `yahoo-finance2` / Alpaca / Twelve Data | Yahoo (default, no key); Alpaca (free IEX real-time, paper keys); Twelve Data optional |
| Scheduling | `node-cron` | In-process EOD refresh |
| Validation | `zod` | All adapter outputs and strategy configs |
| Testing | Vitest | Unit tests for engine, indicators, paper broker |

**lightweight-charts v5:** `addCandlestickSeries()` removed. Use unified form:
```ts
import { createChart, CandlestickSeries, ColorType } from 'lightweight-charts';
const chart = createChart(container, { layout: { background: { type: ColorType.Solid, color: '#0a0e14' }, textColor: '#c9d1d9' } });
const candles = chart.addSeries(CandlestickSeries, { upColor: '#26a641', downColor: '#f85149', borderVisible: false });
```
Markers: use `createSeriesMarkers` (imported), not `series.setMarkers()`. Charts init in `useEffect` only.

---

## Quickstart (local dev)

```bash
npm install
cp .env.local.example .env.local   # fill in keys - see Environment variables section

# Build the database incrementally (rate-limited, resumable)
npm run poll -- --universe scripts/universe/sp500.json
npm run poll -- --universe scripts/universe/nifty200.json

npm run dev
# Open http://localhost:3000
```

Dashboard populates once the DB has bars. Run `npm run refresh` any time for latest EOD bars.

---

## Production deployment

QuantDesk is a **self-hosted single-user tool**. It uses a local SQLite database and a
persistent in-process cron scheduler. This means it **cannot** run on serverless platforms
(Vercel, Netlify, Cloudflare Workers) - it needs a long-lived Node.js process and persistent
disk storage.

### Where to host

| Option | Cost | Notes |
|---|---|---|
| VPS (DigitalOcean, Hetzner, Linode) | $4-6/mo | Cheapest reliable choice |
| Home server / Raspberry Pi | ~$0 running cost | Fine if you have stable broadband |
| Cloud VM (AWS EC2 t3.micro, GCP e2-micro) | ~$5-10/mo | Free tier available on some |

Any Linux machine with Node.js 20+ and 512 MB RAM is sufficient.

### Step-by-step VPS deploy

**1. Provision server and install Node.js**
```bash
# On the server (Ubuntu 22.04 example)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs git
```

**2. Clone and build**
```bash
git clone <your-repo-url> quantdesk
cd quantdesk
npm install
npm run build          # must pass before you can start
```

**3. Create `.env.local` with production values**
```bash
cp .env.local.example .env.local
nano .env.local
```

Minimum required for full functionality:
```env
# Telegram alerts (stops + targets for open paper trades)
TELEGRAM_BOT_TOKEN=<your-bot-token>
TELEGRAM_CHAT_ID=<your-chat-id>

# Data provider (Yahoo requires no key; add Twelve Data key for better global coverage)
TWELVE_DATA_API_KEY=<optional-key>

# Alpaca - free paper account at alpaca.markets (required for auto-trading + intraday data)
# Use paper trading keys (start with PK...), NOT live trading keys
ALPACA_KEY_ID=<paper-key-id>
ALPACA_SECRET_KEY=<paper-secret>

# Automated intraday paper-trading (safe to enable - paper only, never real money)
AUTO_TRADE_ENABLED=1           # 0 = off, 1 = on
AUTO_TRADE_DRY_RUN=1           # 1 = Telegram only (no DB writes), 0 = live paper trades
AUTO_TRADE_TIMEFRAME=15m       # intraday bar timeframe
AUTO_TRADE_MIN_CONSENSUS=2     # strategies that must agree to enter
AUTO_TRADE_MAX_TRADES_PER_DAY=5
AUTO_TRADE_DAILY_LOSS_HALT_PCT=0.03   # halt if day P&L < -3% equity

# Risk controls - adjust to your actual paper budget
RISK_MAX_POSITION_PCT=25
RISK_MAX_OPEN_RISK_PCT=6
RISK_MAX_OPEN_TRADES=8
RISK_HALT_DRAWDOWN_PCT=20

# EOD refresh timing (default 21:05 Europe/Dublin = ~16:05 ET, Mon-Fri)
REFRESH_CRON=5 21 * * 1-5
REFRESH_TZ=Europe/Dublin

# Alert when price within 2% of stop or target (default 2)
ALERT_PROXIMITY_PCT=2
```

**4. Populate the database**
```bash
# First run - downloads full history (takes 20-60 min per universe, rate-limited)
npm run poll -- --universe scripts/universe/sp500.json
npm run poll -- --universe scripts/universe/nifty200.json

# Subsequent runs - incremental update only
npm run refresh
```

**5. Run with PM2 (keeps process alive across reboots)**
```bash
npm install -g pm2
pm2 start "npm start" --name quantdesk
pm2 save                          # persist across reboots
pm2 startup                       # follow the printed command to enable at boot
```

Check logs: `pm2 logs quantdesk`

**6. (Optional) Nginx reverse proxy**

Expose on port 80/443 instead of 3000:
```bash
sudo apt-get install -y nginx
sudo nano /etc/nginx/sites-available/quantdesk
```

```nginx
server {
    listen 80;
    server_name your.domain.com;   # or your server IP

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/quantdesk /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

For HTTPS use Certbot: `sudo apt install certbot python3-certbot-nginx && sudo certbot --nginx`.

### What runs automatically (once deployed)

| What | When | How |
|---|---|---|
| EOD data refresh | 21:05 Mon-Fri (Dublin time, ~16:05 ET) | `node-cron` inside the Next.js process |
| Paper trade sweep (stop/target hit detection) | After every EOD refresh | Part of `postRefreshTasks()` |
| Telegram stop/target proximity alerts | Every 15 min Mon-Fri | `node-cron` inside the Next.js process |
| **Intraday bar ingest** | Every 15 min, 09:00-16:00 ET Mon-Fri | `node-cron` (requires `AUTO_TRADE_ENABLED=1`) |
| **Auto paper-trade loop** | Every 15 min, 09:00-16:00 ET Mon-Fri | `node-cron` (requires `AUTO_TRADE_ENABLED=1`) |

**All five run automatically as long as `npm start` / PM2 is alive.** No extra cron jobs,
no separate worker process, no intervention needed.

Alerts fire when an open paper trade's live price comes within `ALERT_PROXIMITY_PCT` (default 2%)
of its stop or target level. One alert per state change with hysteresis - no spam.

### Keeping data fresh

```bash
# Manual incremental refresh (picks up any missed bars)
npm run refresh

# Re-poll full history for a universe (rarely needed)
npm run poll -- --universe scripts/universe/sp500.json
```

### Security notes

- QuantDesk has no user authentication. If you expose it on a public IP, add HTTP basic auth
  via nginx (`htpasswd`) or restrict access by IP/VPN.
- Never commit `.env.local` - it is gitignored via `.env*` in `.gitignore`.
- The SQLite file `data/quantdesk.db` is gitignored. Back it up periodically:
  `cp data/quantdesk.db data/quantdesk.db.bak`

---

## Scripts

| Script | Purpose |
|---|---|
| `npm run dev` | Next.js dev server on port 3000 |
| `npm run build` | TypeScript check + production build |
| `npm run test` | All Vitest unit tests |
| `npm run test:watch -- <file>` | Single file in watch mode |
| `npm run ingest -- --universe <json>` | Bulk-download history for a universe |
| `npm run refresh` | Incremental EOD update + paper trade stop/target sweep |
| `npm run poll -- --universe <json>` | Rate-limited resumable poller |
| `npm run build-universe` | Regenerate sp500.json / nifty200.json from live sources |
| `npm run validate-universe` | Verify S&P/NIFTY universe counts and required benchmarks |

---

## Full project structure

```
quantdesk/
├── package.json
├── tsconfig.json                      # strict: true
├── next.config.ts
├── .env.local.example                 # all supported API key vars
├── QUANTDESK_BUILD_SPEC.md            # build spec (single source of truth)
├── docs/
│   ├── USAGE.md                       # step-by-step usage guide
│   └── AUTHORING_STRATEGIES.md        # strategy authoring guide with indicator catalogue
├── data/
│   └── quantdesk.db                   # SQLite (gitignored)
├── scripts/
│   ├── ingest.ts                      # CLI: bulk-download history
│   ├── refresh.ts                     # CLI: incremental EOD update
│   ├── poll.ts                        # CLI: rate-limited resumable poller
│   ├── build-universe.ts              # CLI: build universe JSON from provider
│   ├── validate-universe.ts           # CLI: verify universe counts
│   └── universe/
│       ├── sp500.json                 # S&P 500 symbol universe
│       └── nifty200.json              # Nifty 200 symbol universe
└── src/
    ├── instrumentation.ts             # Next.js instrumentation (DB init on startup)
    ├── app/
    │   ├── layout.tsx                 # root layout with disclaimer footer
    │   ├── globals.css                # terminal theme CSS variables
    │   ├── page.tsx                   # main terminal dashboard
    │   ├── backtest/page.tsx          # backtest runner + candlestick chart
    │   ├── paper/page.tsx             # paper trading + tradebook
    │   └── api/
    │       ├── backtest/route.ts      # POST: run backtest for strategy + symbol
    │       ├── bars/route.ts          # GET: OHLCV bars for a symbol + timeframe
    │       ├── ingest/route.ts        # POST: trigger ingest for a universe
    │       ├── market/route.ts        # GET: market summary (indices, status)
    │       ├── paper/route.ts         # GET/POST/PATCH/DELETE: paper trades
    │       ├── quotes/route.ts        # GET: live quotes for watchlist
    │       ├── scan/route.ts          # POST: run scanner across universe
    │       ├── search/route.ts        # GET: symbol typeahead search
    │       └── strategies/route.ts    # GET: list registered strategies
    ├── hooks/
    │   ├── useKeyboardNav.ts          # keyboard navigation + tab-switch hook
    │   ├── usePersistedState.ts       # SSR-safe localStorage state hook
    │   └── useTableSort.ts            # generic header-click sort with persistence
    ├── components/
    │   ├── dashboard/
    │   │   ├── Dashboard.tsx          # main layout, tab orchestration, symbol state
    │   │   └── WatchlistSidebar.tsx   # collapsible watchlist with live quotes
    │   ├── panels/
    │   │   ├── ScanResultsPanel.tsx   # raw scan output table
    │   │   ├── GainersLosersPanel.tsx # top movers by % change
    │   │   ├── SignalDashboardPanel.tsx  # scanner signals with side/reason/strategy
    │   │   ├── TradeIdeasPanel.tsx    # risk-sized trade ideas (entry, stop, target, R/R)
    │   │   ├── StrategyEdgePanel.tsx  # per-strategy backtest edge summary
    │   │   ├── RiskPanel.tsx          # open risk exposure summary
    │   │   ├── TradesPanel.tsx        # paper trade list with unrealized P&L
    │   │   ├── TradesTable.tsx        # backtest trade record table
    │   │   ├── MetricsPanel.tsx       # backtest metrics (return, Sharpe, drawdown)
    │   │   ├── MarketSummaryStrip.tsx # index quotes + market open/closed status
    │   │   └── AccountStrip.tsx       # paper account equity + budget strip
    │   ├── charts/
    │   │   ├── PriceChart.tsx         # lightweight-charts: candles + volume + markers
    │   │   ├── EquityCurveChart.tsx   # backtest equity curve chart
    │   │   ├── MonthlyReturnsHeatmap.tsx  # calendar heatmap of monthly returns
    │   │   └── SignalTimeline.tsx     # per-symbol signal history timeline
    │   ├── trade/
    │   │   ├── NewPaperTrade.tsx      # new paper trade entry form
    │   │   ├── QuickTradeConfirm.tsx  # one-click confirm overlay for trade ideas
    │   │   └── ExitProjection.tsx     # exit price projection display
    │   ├── overlays/
    │   │   ├── CommandBar.tsx         # keyboard command palette
    │   │   └── GoToSymbolOverlay.tsx  # symbol switcher overlay with typeahead
    │   └── primitives/
    │       ├── Panel.tsx              # generic panel wrapper
    │       ├── EmptyState.tsx         # empty state display
    │       ├── InfoTip.tsx            # glossary tooltip
    │       ├── EdgeBadge.tsx          # conviction tier badge
    │       ├── ResizeHandle.tsx       # drag-to-resize handle (react-resizable-panels)
    │       ├── DublinClock.tsx        # timezone clock (Europe/Dublin)
    │       ├── Sparkline.tsx          # mini sparkline chart
    │       └── SymbolTypeahead.tsx    # symbol search input with suggestions
    └── core/
        ├── types.ts                   # Bar, SymbolMeta, Signal, TradeIdea, PaperTrade
        ├── db/
        │   ├── client.ts              # better-sqlite3 singleton + schema migrations
        │   ├── bars.ts                # bar read/write queries
        │   ├── signals.ts             # signal read/write queries
        │   └── paper.ts               # paper trade read/write/update queries
        ├── data/
        │   ├── DataProvider.ts        # adapter INTERFACE (extensibility contract)
        │   ├── registry.ts            # maps providerId -> adapter instance
        │   ├── schemas.ts             # zod BarSchema, SymbolMetaSchema
        │   ├── ingest.ts              # bulk ingest orchestration
        │   ├── intraday-ingest.ts     # intraday bar ingest for auto-trade universe
        │   ├── poller.ts              # incremental EOD refresh logic
        │   ├── resample.ts            # resample daily -> weekly bars
        │   ├── universe.ts            # load/validate symbol universe JSON + autoTradeUniverse()
        │   └── providers/
        │       ├── yahoo.ts           # Yahoo Finance adapter (default, no key needed)
        │       ├── alpaca.ts          # Alpaca Markets adapter (free IEX real-time, intraday + batch)
        │       ├── twelve-data.ts     # Twelve Data adapter (requires API key)
        │       └── _template.ts       # copy-me stub for new providers
        ├── indicators/
        │   ├── registry.ts            # name -> compute fn, uniform signature, NaN-padded output
        │   ├── crosses.ts             # cross-detection helpers (golden/death cross etc.)
        │   └── helpers.ts             # indicator utility functions
        ├── strategy/
        │   ├── Strategy.ts            # Strategy interface + StrategyContext + StrategyDecision
        │   ├── registry.ts            # register() + list() + get()
        │   ├── context.ts             # makeContext(): frozen bars[0..i], structural no-look-ahead
        │   ├── validate.ts            # look-ahead probe + smoke backtest (auto-runs in dev/test)
        │   └── examples/
        │       ├── rsi-reversion.ts   # RSI oversold/overbought mean reversion
        │       ├── ma-crossover.ts    # fast/slow MA cross
        │       ├── macd-momentum.ts   # MACD histogram momentum
        │       ├── bollinger-reversion.ts  # Bollinger band mean reversion
        │       ├── donchian-breakout.ts    # Donchian channel breakout
        │       ├── atr-trend.ts            # ATR-based trend following
        │       ├── roc-momentum.ts         # Rate of change momentum
        │       └── stoch-reversal.ts       # Stochastic oscillator reversal
        ├── backtest/
        │   ├── engine.ts              # bar-by-bar simulator (fills at next bar open)
        │   ├── fills.ts               # fill price math: slippage, stop/target, P&L
        │   └── metrics.ts             # return %, CAGR, win rate, Sharpe, max drawdown
        ├── market/
        │   ├── hours.ts               # isUsMarketOpen(), isNearMarketClose() - DST-aware ET, NYSE holidays
        │   ├── markets.ts             # market hours, open/closed status per exchange
        │   └── snapshot.ts            # index/market snapshot queries
        ├── paper/
        │   ├── broker.ts              # open/close paper positions, mark-to-market
        │   ├── auto-trade.ts          # automated intraday paper-trading engine (runAutoTrade)
        │   └── tradebook.ts           # aggregate stats per strategy
        ├── scan/
        │   └── scanner.ts             # run strategy across watchlist -> signals
        ├── signals/
        │   └── recommend.ts           # signal -> TradeIdea with risk-based sizing
        ├── risk/
        │   └── sizing.ts              # position sizing (risk% of equity to stop)
        ├── market/
        │   ├── markets.ts             # market hours, open/closed status per exchange
        │   └── snapshot.ts            # index/market snapshot queries
        └── format/
            └── currency.ts            # currency glyph formatting (USD→$, INR→₹, EUR→€)
```

---

## Core contracts (`src/core/types.ts`)

```ts
// Single OHLCV bar. time is UTC. Daily = 'YYYY-MM-DD', intraday = full ISO timestamp.
interface Bar {
  time: string;
  open: number; high: number; low: number; close: number; volume: number;
}

type AssetClass = 'equity' | 'forex' | 'crypto' | 'commodity' | 'index';
type Timeframe   = '1m' | '5m' | '15m' | '1h' | '1d' | '1wk';

interface SymbolMeta {
  symbol: string;         // canonical internal id, e.g. 'NVDA', 'EURUSD', 'XAUUSD'
  providerSymbol: string; // what the provider calls it (mapping lives in the adapter)
  name: string;
  assetClass: AssetClass;
  currency: string;       // ISO 4217
  exchange?: string;
  providerId: string;     // which adapter owns this symbol
}

interface Signal {
  symbol: string;
  time: string;
  side: 'long' | 'short' | 'flat';
  strength?: number;  // 0..1 conviction
  reason: string;     // e.g. 'RSI(14)=28 < 30 oversold'
  strategyId: string;
}

interface TradeIdea {
  symbol: string; strategyId: string; side: 'long' | 'short';
  currency: string;       // ISO 4217 for this symbol
  entryPrice: number;     // last close; actual fill at next bar open
  stopPrice: number; targetPrice: number;
  qty: number;            // risk-based: risks riskPct of equity to stop
  riskAmount: number;     // (entry - stop) * qty
  rewardAmount: number;   // (target - entry) * qty
  rr: number;             // rewardAmount / riskAmount
  reason: string; time: string;
}

interface PaperTrade {
  id: string; strategyId: string; symbol: string;
  side: 'long' | 'short'; currency?: string;
  qty: number;
  entryTime: string; entryPrice: number;
  exitTime?: string; exitPrice?: number;
  stopPrice?: number; targetPrice?: number;
  status: 'open' | 'closed';
  pnl?: number; pnlPct?: number;
  costs: number;  // commission + slippage
  notes?: string;
}
```

---

## Strategy interface (`src/core/strategy/Strategy.ts`)

```ts
interface StrategyContext {
  readonly bars: ReadonlyArray<Bar>;  // frozen slice bars[0..i] ONLY - structural no-look-ahead
  readonly i: number;                 // current bar index
  readonly position: 'long' | 'short' | 'flat';
  indicator(id: string, params?: object): IndicatorOutput;  // causal slice 0..i, NaN during warmup
}

interface StrategyDecision {
  action: 'enter_long' | 'enter_short' | 'exit' | 'hold';
  stopPct?: number;    // stop distance as fraction of entry price (e.g. 0.05 = 5%)
  targetPct?: number;  // target distance as fraction (e.g. 0.10 = 10%)
  sizePct?: number;    // fraction of equity to allocate (0..1], default 1.0
  reason?: string;     // shown in signal UI and trade record
}

interface Strategy {
  readonly id: string; readonly name: string; readonly description: string;
  readonly params: z.ZodTypeAny;  // every field must have .default()
  onBar(ctx: StrategyContext, rawParams: unknown): StrategyDecision;
  // onBar must be pure: no I/O, no Date.now(), no external state mutation
}
```

---

## Data provider interface (`src/core/data/DataProvider.ts`)

```ts
interface DataProvider {
  readonly id: string;
  readonly assetClasses: AssetClass[];
  toProviderSymbol(symbol: string): string;
  getHistory(symbol: string, timeframe: Timeframe, from: string, to: string): Promise<Bar[]>;
  getQuote?(symbol: string): Promise<{ price: number; time: string } | null>;
  search?(query: string): Promise<SymbolMeta[]>;
}
```

Optional batch method for multi-symbol efficiency (Alpaca implements it):
```ts
getHistoryBatch?(symbols: string[], timeframe: Timeframe, from: string, to: string): Promise<Record<string, Bar[]>>;
```

Adding a new provider = one new file in `providers/` + one line in `registry.ts`. Zero changes elsewhere.

---

## Backtest engine correctness rules (`src/core/backtest/engine.ts`)

Enforced structurally, not by convention:

1. **No look-ahead bias** - `strategy.onBar()` receives frozen `bars[0..i]`. `bars[i+1]` is `undefined` (structurally, not by promise).
2. **Fills at next open** - signals fire on bar `i` close; fills execute at bar `i+1` open.
3. **Slippage** - applied adverse to fill direction on every market fill.
4. **Conservative intrabar** - if both stop AND target are hit in one bar, stop fills first (worst outcome for the held position).
5. **Final-bar guard** - signal on last bar `n-1` is ignored (no next bar to fill on).
6. **Forced liquidation** - open positions at end-of-series close at final bar's close (no slippage, commission still applied).

---

## How to add a strategy

1. Create `src/core/strategy/examples/my-strategy.ts` implementing `Strategy`
2. `onBar(ctx, rawParams)` - call `this.params.parse(rawParams)` with a Zod schema (all fields with defaults)
3. Return `StrategyDecision`. `ctx.bars` is frozen `[0..i]` - look-ahead structurally impossible.
4. Register in `src/core/strategy/registry.ts` - one line
5. Write Vitest test; verify no look-ahead trap fires
6. `npm run build && npm run test`

See `docs/AUTHORING_STRATEGIES.md` for indicator catalogue and worked examples.

---

## How to add a data provider

1. Copy `src/core/data/providers/_template.ts` to `providers/new-provider.ts`
2. Implement `getHistory()`, `toProviderSymbol()`, optionally `getQuote()` and `search()`
3. Validate all outputs with `BarSchema`/`SymbolMetaSchema` from `schemas.ts`
4. Add API key to `.env.local.example`
5. Register in `src/core/data/registry.ts` - one line
6. `npm run build`

---

## Non-negotiable rules

- **No `any`** in core contracts: `types.ts`, adapters, engine, strategy interface
- **Indicator alignment** - outputs left-padded with `NaN` during warm-up so `output[i]` always maps to `bars[i]`
- **Pluggable surfaces only** - provider/strategy logic lives only in adapters and strategy examples; never in engine, DB, indicators, or UI
- **`better-sqlite3` is synchronous** - all DB access is sync; lives in API route handlers
- **Charts client-side only** - init inside `useEffect`, never at SSR time; use `addSeries(CandlestickSeries, ...)` not the removed `addCandlestickSeries()`

---

## Environment variables

See `.env.local.example` for the full list. Yahoo Finance requires no key and is active
by default. All other providers are stubs activated by adding their keys.

```
TWELVE_DATA_API_KEY=your_key_here
```

---

## Style conventions

- UI: dense, dark, monospace, keyboard-driven - terminal aesthetic, not marketing page
- Hyphens not em dashes in all code comments, UI copy, and docs
- Persistent disclaimer: "Research tool, not financial advice. Results are hypothetical."
- TypeScript strict throughout; no `any` in core contracts
- Comments only where WHY is non-obvious; no docblocks narrating what the code does

---

## Auto-trading quick-start

```bash
# 1. Get a free Alpaca paper account at https://app.alpaca.markets/signup
# 2. Add to .env.local (paper keys start with PK...)
ALPACA_KEY_ID=PKxxxxxxxx
ALPACA_SECRET_KEY=xxxxxxxx
TELEGRAM_BOT_TOKEN=<from @BotFather>
TELEGRAM_CHAT_ID=<your chat id>

# 3. Enable dry-run first (Telegram-only, no DB writes)
AUTO_TRADE_ENABLED=1
AUTO_TRADE_DRY_RUN=1

# 4. Start server and click TRIGGER NOW on /paper to test immediately
npm run dev

# 5. Once happy with Telegram signals, flip to live paper trades
AUTO_TRADE_DRY_RUN=0
# Restart server. Cron fires every 15 min during US RTH (9:30-16:00 ET).
```

Auto-trade flow per tick:
1. Ingest fresh 15m bars from Alpaca (IEX real-time feed, free)
2. Run all strategies → build consensus (default: ≥2 must agree)
3. Psychology filters: daily-loss halt, max-trades/day cap, no re-entry on stopped symbol, no entries within 30 min of close
4. Risk-size at 1% equity/trade → `openPaperTrade` (broker enforces budget + risk gates)
5. Telegram entry notification (symbol, qty, entry/stop/target, R:R, agreeing strategies)
6. EOD sweep closes positions that hit stop/target → Telegram exit notification

---

## Out of scope

Real-money order routing, user accounts, multi-tenant, in-app YouTube
transcription. Single-user local research tool only. Auto-trading is paper-only.
