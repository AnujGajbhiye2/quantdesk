# QuantDesk Roadmap - decision-grade upgrade

Goal: a platform trustworthy enough that a strategy it has PROVEN profitable (live paper
record matching backtest) can be followed with confidence. Inspired by the structure of
TauricResearch/TradingAgents (analyst perspectives, bull/bear debate, risk team, decision
log) - adapted deterministically, no LLM required (optional last phase).

Track progress here. Each phase ends with: npm run build green, phase tests green,
user verification. Update checkboxes as work lands. If a session dies mid-phase,
read this file first.

---

## Phase 1 - UX fixes (DONE)
- [x] `useTableSort` hook; clickable sortable headers on Scan Results, Signal Dashboard, Trade Ideas, Recent Trades (/compare kept its own working sort - hook available if consolidating later)
- [x] `InfoTip` component: [?] click/hover popover (replaces native title tooltips in Panel, MetricsPanel, WatchlistSidebar, AccountStrip)
- [x] Move MarketSummaryStrip ticker from page bottom to top (under filter tabs)
- [x] Market filter applies to signals, consensus, ideas, trades (not just scan table); ALL/US/EU/NSE/BSE tabs always visible with counts
- [x] CUR PRICE column in both paper-trade tables (markPrice via MarksMap)

## Phase 2 - explain everything (DONE)
- [x] `core/glossary.ts` - every metric/term: short, long, "how it makes you money"
- [x] Panel `subtitle` prop - visible one-liner on every panel (incl. Signal Dashboard vs Trade Ideas distinction)
- [x] /compare collapsible column legend ("what do these columns mean?") + InfoTip headers
- [x] MetricsPanel rows wired to glossary
- [x] Strategy Edge TRUST / WATCH / AVOID verdict per strategy (live vs backtest win rate, 10-trade minimum, 5pp tolerance)

## Phase 3 - risk management layer (DONE)
- [x] `core/risk/checks.ts` pure rules: position concentration (25%), total open risk (6%, stop-less = full cost), max open trades (8), drawdown circuit breaker (20%) - env-config, 16 tests
- [x] Enforced in `openPaperTrade` with named 409 errors explaining the rule and why it exists
- [x] `RiskPanel` exposure gauges on dashboard (green/amber/red vs each limit)
- [x] `.env.local.example` documented (RISK_* vars)

## Phase 4 - decision dossier per symbol (analyst team) (DONE)
- [x] Yahoo adapter: `getFundamentals` (quoteSummary) + `getNews` (search news), zod-validated, DB-cached (1d / 6h TTL)
- [x] `/api/dossier?symbol=X` aggregate endpoint (technicals, consensus, edges, signal track record, fundamentals, news, case)
- [x] `core/dossier/case.ts` deterministic bull/bear checklist - 7 factor families, every factor carries its numbers
- [x] `/symbol/[symbol]` dossier page: verdict bar + BULL/BEAR factor lists + 4 analyst desks + actions; DOSSIER link on backtest page
- [x] Graceful degradation (unavailable factors listed, not hidden); NSE/INR verified

## Phase 5 - conviction score + trade journal (trader agent + decision log)
- [ ] `core/signals/conviction.ts` 0-100 composite (edge 40 / consensus 20 / R:R 15 / realized hit-rate 15 / regime 10), STRONG/MODERATE/WEAK bands, tested
- [ ] Conviction shown on ideas (sortable), dossier, QuickTradeConfirm
- [ ] `journal` table: WHY snapshot at open, outcome reflection at close (manual + sweep paths)
- [ ] `/journal` page: chronological entries + per-strategy reflection summaries
- [ ] System report: strategy x market combos ranked by LIVE record with TRUST/WATCH/AVOID - the "follow it" list (with min-sample warnings + disclaimer)

## Phase 6 - optional LLM analyst (env-gated)
- [ ] `ANTHROPIC_API_KEY` set -> dossier "AI ANALYST" bull/bear narrative (claude-sonnet-4-6), labeled AI opinion; absent -> hidden, zero impact; never feeds signals/sizing/risk

---

## Done in earlier sessions (context for future readers)
- Part 3 UX/decision quality: edge badges, quality gate, watchlist (w/p), Enter-Enter quick trade, signal history timeline, /compare, Telegram stop/target monitor, panel [?] infos
- Data freshness fix (exclusive period2 + skip bug), partial-bar LIVE handling, local-first typeahead, click-to-backtest, EST HOLD
- Swing hold cap: engine time stop (21 bars default, `MAX_HOLD_BARS`), wired through backtest/compare/edge/sweep ('expired')
- New strategies: rsi2-pullback, down-streak, ema-pullback (long-only, trend-filtered, capped holds)
- Budget system: derived balance, insufficient-funds + BANKRUPT blocking, account strip, idea sizing vs cash, static FX for INR
