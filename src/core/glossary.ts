/**
 * Plain-language glossary for every metric and term in the UI.
 * Single source of truth - InfoTips, legends and subtitles read from here so
 * an explanation is written once and stays consistent everywhere.
 *
 * Tone: explain to a smart person who has never traded. Every entry ends with
 * why the number matters for making (or not losing) money.
 */

export interface GlossaryEntry {
  /** Display term. */
  term: string;
  /** Full explanation incl. the "how this helps you make money" line. */
  text: string;
}

export const GLOSSARY = {
  sharpe: {
    term: 'Sharpe ratio',
    text:
      'Return per unit of risk taken (annualised). Two strategies can both make 20% - the one that got there without stomach-churning swings has the higher Sharpe.\n' +
      'Rule of thumb: < 0.5 weak, 0.5-1 ok, > 1 good, > 2 excellent.\n' +
      'Why it matters: a high-return strategy you abandon during a rough patch earns you nothing. Sharpe measures whether you can actually live with the ride.',
  },
  maxDrawdown: {
    term: 'Max drawdown',
    text:
      'The worst peak-to-trough fall in account value during the test. -30% means at some point you watched a third of your money disappear before it recovered.\n' +
      'Why it matters: this is the pain you must sit through without quitting. If you would stop trading after losing 15%, never run a strategy with a 30% historical drawdown.',
  },
  profitFactor: {
    term: 'Profit factor',
    text:
      'Total money won divided by total money lost. 2.0 = winners brought in twice what losers cost. Below 1.0 = the strategy loses money overall.\n' +
      'Why it matters: a 40% win rate can still be very profitable if the profit factor is high - it tells you whether wins pay for the losses, which is the whole game.',
  },
  winRate: {
    term: 'Win rate',
    text:
      'Share of closed trades that made money. 60% = 6 winners out of 10.\n' +
      'Why it matters: alone it is misleading - tiny wins and huge losses can hide behind a 70% win rate. Always read it together with profit factor and avg win/loss. Its real use: comparing LIVE win rate against the backtest exposes strategies that only worked on paper.',
  },
  rr: {
    term: 'R:R (reward-to-risk)',
    text:
      'Distance to target divided by distance to stop. 2.0x = you stand to make twice what you risk.\n' +
      'Why it matters: at 2:1 you can be wrong more often than right and still profit. The quality gate hides ideas below 1.5x because they are not worth taking.',
  },
  totalReturn: {
    term: 'Total return',
    text:
      'How much the account grew over the whole tested window, in percent. +300% over 10 years and +300% over 1 year are very different - check the tested window.\n' +
      'Why it matters: the headline number, but never read it alone - a huge return with a brutal max drawdown or 3 trades behind it is not an edge you can use.',
  },
  cagr: {
    term: 'CAGR',
    text:
      'Compound annual growth rate - the smoothed per-year return over the whole test, as if growth had been steady.\n' +
      'Why it matters: comparable across strategies and against simply holding an index fund. If a strategy CAGRs less than buy-and-hold with more effort and risk, skip it.',
  },
  exposure: {
    term: 'Exposure',
    text:
      'Percentage of time the strategy actually held a position. 30% = your money sat in cash 70% of the time.\n' +
      'Why it matters: low exposure with good returns is efficient - capital is free for other trades the rest of the time.',
  },
  numTrades: {
    term: 'Trade count',
    text:
      'Closed trades in the test. Statistical fuel.\n' +
      'Why it matters: under ~15 trades, every other metric is basically noise - a 100% win rate on 3 trades means nothing. Trust numbers built on 30+ trades.',
  },
  avgHold: {
    term: 'Avg hold / EST HOLD',
    text:
      'How long the strategy typically stays in a trade, in trading days. EST HOLD on an open trade = the historical median hold of WINNING trades, projected as a date range.\n' +
      'Why it matters: tells you when to expect resolution. If a trade is far past its estimated window and going nowhere, the edge has likely expired - the system force-exits at the max-hold cap for exactly that reason.',
  },
  timeExit: {
    term: 'Time exit (TIME / EXPIRED)',
    text:
      'A position closed because it hit the maximum hold (default 21 trading days), not because of a stop, target or signal.\n' +
      'Why it matters: you wanted max-month holds, so EVERY number on this platform - backtests, comparisons, edge stats - is computed under that same rule. No stat assumes patience you do not have.',
  },
  qualityGate: {
    term: 'Quality gate',
    text:
      'Automatic filter on trade ideas. An idea is GATED (greyed out, not actionable) when: R:R < 1.5, or the strategy wins < 40% on this asset class, or there are fewer than 15 historical trades to judge it by.\n' +
      'Why it matters: it keeps statistically bad or unproven bets off your action list. A gated row tells you the system is filtering, not broken.',
  },
  signalVsIdea: {
    term: 'Signal vs Trade Idea',
    text:
      'SIGNAL DASHBOARD = the raw opinion of every strategy on every symbol right now (buy / sell / exit), before any filtering or sizing.\n' +
      'TRADE IDEAS = only the signals that passed the quality gate, converted into an executable order: entry, stop, target, position size and risk amount.\n' +
      'Why it matters: signals are research; ideas are the short list you can actually act on.',
  },
  consensus: {
    term: 'Consensus',
    text:
      'How many independent strategies agree on the same direction for a symbol, e.g. 4/11 LONG. The strength bar = share of all strategies agreeing.\n' +
      'Why it matters: one strategy firing can be noise; several unrelated approaches pointing the same way at once is a materially stronger setup.',
  },
  edgeTier: {
    term: 'Edge / signal brightness',
    text:
      'Each signal is weighted by how well its strategy actually backtested on that symbol (win rate, profit factor, sample size). Bright rows = proven edge; dim rows = weak or unproven.\n' +
      'Why it matters: it makes untrustworthy signals literally harder to see, so your eye lands on the setups with statistical support.',
  },
  strategyEdge: {
    term: 'Strategy Edge panel',
    text:
      'The live scorecard: real paper-trading results per strategy - trades YOU took, not simulations. Compared against the backtest, it answers the only question that matters: does the edge survive contact with reality?\n' +
      'Why it matters: TRUST = live results track the backtest, the strategy is behaving as advertised. AVOID = live results are materially worse - it was likely curve-fit; stop following it. WATCH = not enough live trades yet to judge.',
  },
  trustVerdict: {
    term: 'TRUST / WATCH / AVOID',
    text:
      'TRUST: 10+ live trades and live win rate within 5 points of the backtested one - the strategy does in practice what it promised on paper.\n' +
      'WATCH: fewer than 10 live trades - keep paper trading it, not enough evidence either way.\n' +
      'AVOID: 10+ live trades and live win rate materially below backtest - the edge is not real for you; stop taking its signals.\n' +
      'Why it matters: this is the "can I follow it blindly" answer, built from your own track record.',
  },
  accountCash: {
    term: 'Budget / cash / in trades / equity',
    text:
      'BUDGET = what you started with. Opening a trade reserves its entry cost from CASH; IN TRADES = cost currently locked in open positions; closed P&L settles back into cash.\n' +
      'EQUITY = budget + realized + unrealized P&L - your account marked to market. Equity at or below $0 = BANKRUPT: this configuration lost everything; reset and rethink.\n' +
      'Why it matters: forces position sizing discipline a real broker would - you cannot take trades you cannot afford.',
  },
  liveBar: {
    term: 'LIVE bar',
    text:
      "Today's price bar while the market is still open - it is incomplete and keeps changing until the close.\n" +
      'Why it matters: signals and backtests deliberately ignore it (half-formed bars create phantom signals). Charts and prices show it so you stay current.',
  },
  estHoldSource: {
    term: 'EST HOLD source',
    text:
      'symbol = median computed from this strategy\'s winning trades on this exact symbol (best). universe = global fallback across all symbols when there is not enough local history.\n' +
      'Why it matters: a symbol-specific estimate is more honest than a universe average.',
  },
} as const;

export type GlossaryKey = keyof typeof GLOSSARY;

/** Lookup helper - returns the entry, throwing at build time if the key drifts. */
export function gloss(key: GlossaryKey): GlossaryEntry {
  return GLOSSARY[key];
}
