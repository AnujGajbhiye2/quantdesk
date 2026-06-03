# QuantDesk - How to Use

> **Research tool. Not financial advice. All results are hypothetical, subject to
> survivorship bias, look-ahead error, and other limitations. Past performance does
> not predict future results. Never risk money you cannot afford to lose.**

---

## Step 1: Install

```bash
git clone <repo-url>
cd quantdesk
npm install
```

---

## Step 2: Configure environment (optional but recommended)

```bash
cp .env.local.example .env.local
```

Open `.env.local`. The only key worth adding now:

```
TWELVE_DATA_API_KEY=your_key_here
```

Get a free key at [twelvedata.com](https://twelvedata.com) (no credit card needed).
- Free tier: 800 requests/day, 8 requests/minute.
- Yahoo Finance works without any key and is the default.

---

## Step 3: Build the database

QuantDesk stores all bars in a local SQLite file (`data/quantdesk.db`).
Run this once, then run it daily to keep data fresh.

### Quick start (sample universe - ~15 symbols, fast)

```bash
npm run ingest -- --universe scripts/universe/sp500-sample.json
```

### Build a real database over time

The poller fetches data under the rate limit and resumes where it left off:

```bash
# US stocks (S&P 500 top 100 + indices) - Yahoo Finance, no key needed
npm run poll -- --universe scripts/universe/sp500.json

# India (NIFTY 200) - Yahoo Finance .NS symbols, no key needed
npm run poll -- --universe scripts/universe/nifty200.json

# With Twelve Data (faster, 8 req/min cap per run)
npm run poll -- --universe scripts/universe/sp500.json --provider twelve-data --rate 8 --cap 800
```

The poller skips symbols that are already up-to-date. Run it every day; it
resumes automatically. After a few days the whole universe is filled in.

### Regenerate universe files (quarterly or when index membership changes)

```bash
npm run build-universe
```

---

## Step 4: Start the app

```bash
npm run dev
# Open http://localhost:3000
```

---

## Step 5: Explore the dashboard

The main dashboard shows:
- **Scan Results** (top-left): all ingested symbols with last price, % change, volume, sparkline.
  Click any row to jump to its backtest.
- **Gainers / Losers** (top-right): sorted by day change %.
- **Signal Dashboard** (middle): RSI, MACD state, MA cross, and latest strategy signal per symbol.
- **Trade Ideas** (below signals): concrete entry/stop/target/qty/R:R recommendations from the scan.
- **Recent Trades** (bottom): open and closed paper trades.
- **Market Strip** (footer): key tickers with sparklines.

**Market filter tabs**: click US / NSE / BSE / FOREX / GOLD / CRYPTO to filter all panels.

**Symbol search**: press `g` to open the symbol overlay. Type any symbol or company name.
Symbols not yet in the DB show a `+ ingest` badge - selecting them auto-downloads history.

**Keyboard shortcuts**:
- `/` - focus the command bar
- `g` - open go-to-symbol overlay
- `j / k` or arrow keys - navigate rows
- Enter - open selected symbol in backtest

---

## Step 6: Run a strategy scan

### Via the UI
1. In the strategy bar (below the nav), select a strategy from the dropdown.
2. Click **SCAN**.
3. Signal Dashboard updates with RSI / MACD / MA / signal per symbol.
4. Trade Ideas panel shows concrete entry/stop/target/qty for each actionable signal.

### Via the command bar
Press `/`, then type:
```
scan --strategy=rsi-reversion
scan --strategy=bollinger-reversion --symbols=AAPL,MSFT,NVDA
```

Available strategies:
| Strategy ID             | Description |
|------------------------|-------------|
| `rsi-reversion`        | Enter long when RSI < 30 (oversold); exit when RSI > 50 |
| `ma-crossover`         | Golden / death cross on SMA 50/200 |
| `macd-momentum`        | MACD line crosses signal line |
| `bollinger-reversion`  | Price drops below lower BB; exit at mid-band |
| `donchian-breakout`    | Close above N-bar high; ATR-based stop |
| `roc-momentum`         | Rate-of-change > threshold + EMA trend filter |
| `atr-trend`            | Price above EMA; ATR trailing stop |
| `stoch-reversal`       | Stochastic K/D bullish cross from oversold zone |

---

## Step 7: Read a trade idea

After scanning, the **TRADE IDEAS** panel shows each idea with:

| Column | Meaning |
|--------|---------|
| SYMBOL | Ticker |
| SIDE   | LONG or SHORT |
| ENTRY  | Expected fill price (last close; actual fill at next bar open) |
| STOP   | Stop-loss price (ATR-based or strategy-supplied) |
| TARGET | Profit target |
| QTY    | Shares/units sized to risk ~1% of $10,000 equity to the stop |
| RISK$  | Dollar amount at risk if stop is hit |
| R:R    | Reward-to-risk ratio (>= 2x = green, >= 1x = amber, < 1x = red) |
| REASON | Strategy's signal reason |

**How sizing works**: `qty = (equity * riskPct) / |entry - stop|`
Default: equity = $10,000, riskPct = 1%. To change this, pass `equity` and `riskPct`
in the scan body (API) or hardcode it in your use case.

**R:R guidance**: most swing-trading systems target R:R >= 1.5x. Ideas below 1x are shown
in red as a warning.

---

## Step 8: Take a paper trade

### From a trade idea (one click)
Click **TAKE** on any idea in the Trade Ideas panel. The trade opens immediately
with the displayed entry/stop/target/qty.

### Manual entry on the Paper Trades page
Navigate to `/paper`, fill in the form:
- Symbol, Side (LONG/SHORT), Qty, Entry Price
- Stop Price (optional but recommended - enables auto-close)
- Target Price (optional - enables auto-close on target hit)

Click **OPEN TRADE**.

---

## Step 9: EOD refresh (run once per trading day after market close)

```bash
npm run refresh
```

This:
1. Fetches the latest EOD bars for all symbols in the DB.
2. Runs the **EOD sweep**: checks every open paper trade against the new bar.
   - If `low <= stop price`: closes the trade at the stop (stopped out).
   - If `high >= target price`: closes at the target (target hit).
   - If both: stop fires first (conservative worst-case rule).
3. Prints a summary of closed trades with P&L.

You can also trigger the sweep from the UI:
- Dashboard: click **REFRESH** (runs sweep before refreshing the data).
- Paper page: click **EOD SWEEP**.

---

## Step 10: Review the tradebook

Navigate to `/paper` to see:
- Overall stats: total trades, open/closed, win rate, total P&L, avg P&L%, exposure.
- Performance by strategy: compare which strategies are working.
- All trades: entry/exit/stop/target/P&L for every paper trade.

---

## Backtest a strategy

Navigate to `/backtest`:
1. Enter a symbol (e.g. `AAPL`).
2. Select a strategy.
3. Toggle **1D** or **1W** chart.
4. Click **RUN**.

The chart shows candlesticks with entry (arrow) and exit (circle) markers.
The metrics panel shows total return, CAGR, Sharpe, max drawdown, win rate, etc.

All backtests use realistic fills:
- Signals fire on bar close.
- Fills happen at the next bar's open.
- Commission and slippage (0.05% default) are applied.
- If stop and target both hit in the same bar, the stop fires first.

---

## Add a custom strategy

See [`AUTHORING_STRATEGIES.md`](./AUTHORING_STRATEGIES.md) for the full guide.
Short version:
1. Create `src/core/strategy/examples/my-strategy.ts`.
2. Register in `src/core/strategy/registry.ts` - one line.
3. `npm run build && npm run test` - validation runs automatically.

---

## Scripts reference

| Command | What it does |
|---------|-------------|
| `npm run dev` | Start dev server on port 3000 |
| `npm run build` | TypeScript check + production build |
| `npm run test` | Run all Vitest unit tests |
| `npm run ingest -- --universe <path>` | Full history ingest for a universe file |
| `npm run refresh` | Incremental EOD update + paper trade sweep |
| `npm run poll -- --universe <path>` | Rate-limited resumable poller (runs daily) |
| `npm run build-universe` | Regenerate sp500.json / nifty200.json from live sources |

---

## Architecture in one paragraph

Data flows one way: **Providers** (Yahoo, Twelve Data) -> `ingest/refresh` -> **SQLite DB**
(`data/quantdesk.db`) -> **Strategies** (pure `onBar` functions) -> **Scanner** ->
**Signals + Trade Ideas** -> **Paper Broker** (open/sweep/close) -> **Tradebook**.
The UI reads from the DB; it never calls providers directly. Adding a new data provider
means one new adapter file + one registry line. Adding a new strategy means one new file
+ one registry line. Nothing else changes.
