"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import DublinClock from "./DublinClock";
import CommandBar, { type CommandBarHandle } from "./CommandBar";
import ScanResultsPanel, { type PlaceholderSymbol } from "./ScanResultsPanel";
import GainersLosersPanel from "./GainersLosersPanel";
import SignalDashboardPanel from "./SignalDashboardPanel";
import TradesPanel, { type MarksMap } from "./TradesPanel";
import TradeIdeasPanel from "./TradeIdeasPanel";
import StrategyEdgePanel from "./StrategyEdgePanel";
import MarketSummaryStrip from "./MarketSummaryStrip";
import GoToSymbolOverlay from "./GoToSymbolOverlay";
import WatchlistSidebar from "./WatchlistSidebar";
import QuickTradeConfirm from "./QuickTradeConfirm";
import AccountStrip from "./AccountStrip";
import RiskPanel from "./RiskPanel";
import { useKeyboardNav } from "./useKeyboardNav";
import { useTableSort } from "./useTableSort";
import type { WatchlistItem } from "@/app/api/watchlist/route";
import type { AccountSummary } from "@/core/paper/account";
import type { RiskExposure } from "@/core/risk/exposure";
import type { MarketRow } from "@/core/market/snapshot";
import type { TradeBook } from "@/core/paper/tradebook";
import type { ConsensusSignal } from "@/core/scan/consensus";
import type { EdgeSummary } from "@/core/edge/context";
import type { EnrichedTradeIdea } from "@/core/signals/gate";
import type { PaperTrade, Signal, TradeIdea, SymbolMeta } from "@/core/types";
import { marketOf, ALL_MARKETS, type Market } from "@/core/market/markets";

interface QuoteRow {
  symbol: string;
  price: number;
  time: string;
}

interface Props {
  initialRows: MarketRow[];
  initialTrades: PaperTrade[];
  initialStrategies: { id: string; name: string }[];
  allSymbols: {
    symbol: string;
    name: string;
    assetClass: SymbolMeta["assetClass"];
    currency: string;
    exchange?: string;
    providerId: string;
    inDb: boolean;
  }[];
}

export default function Dashboard({
  initialRows,
  initialTrades,
  initialStrategies,
  allSymbols,
}: Props) {
  const [rows, setRows] = useState<MarketRow[]>(initialRows);
  const [trades, setTrades] = useState<PaperTrade[]>(initialTrades);
  const [marks, setMarks] = useState<MarksMap>(new Map());
  const [book, setBook] = useState<TradeBook | null>(null);
  const [signals, setSignals] = useState<Signal[]>([]);
  const [consensus, setConsensus] = useState<ConsensusSignal[]>([]);
  const [scanningAll, setScanningAll] = useState(false);
  const [ideas, setIdeas] = useState<EnrichedTradeIdea[]>([]);
  const [signalEdges, setSignalEdges] = useState<Record<string, EdgeSummary | null>>({});
  const [ideaBusy, setIdeaBusy] = useState(false);
  const [strategies] = useState(initialStrategies);
  const [scanStratId, setScanStratId] = useState(
    initialStrategies[0]?.id ?? "",
  );
  const [gotoOpen, setGotoOpen] = useState(false);
  const [watchlistOpen, setWatchlistOpen] = useState(false);
  const [watchlistItems, setWatchlistItems] = useState<WatchlistItem[]>([]);
  const [ideasFocus, setIdeasFocus] = useState(false);
  const [pendingIdea, setPendingIdea] = useState<EnrichedTradeIdea | null>(null);
  const [account, setAccount] = useState<AccountSummary | null>(null);
  const [backtestWinRates, setBacktestWinRates] = useState<Record<string, number>>({});
  const [riskExposure, setRiskExposure] = useState<RiskExposure | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [scanStatus, setScanStatus] = useState("");
  const [marketFilter, setMarketFilter] = useState<Market | "ALL">("ALL");
  const [quotes, setQuotes] = useState(new Map<string, QuoteRow>());
  const cmdRef = useRef<CommandBarHandle>(null);
  const router = useRouter();

  // Build a symbol -> market map from allSymbols (already has assetClass/exchange)
  const symbolMarketMap = useRef(new Map<string, Market>());
  useEffect(() => {
    symbolMarketMap.current.clear();
    for (const s of allSymbols) {
      symbolMarketMap.current.set(
        s.symbol,
        marketOf({
          symbol: s.symbol,
          assetClass: s.assetClass,
          exchange: s.exchange,
        }),
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allSymbols]);

  // Core equity markets always get a tab (even with zero symbols ingested, so
  // the user can see the bucket exists); other buckets appear when present.
  const CORE_MARKETS: Market[] = ["US", "EU", "NSE", "BSE"];
  const presentMarkets = ALL_MARKETS.filter(
    (m) =>
      CORE_MARKETS.includes(m) ||
      allSymbols.some((s) => symbolMarketMap.current.get(s.symbol) === m),
  );

  // Ingested-symbol count per market for the tab labels
  const marketCounts = useMemo(() => {
    const counts = new Map<Market | "ALL", number>([["ALL", rows.length]]);
    for (const r of rows) {
      const m = symbolMarketMap.current.get(r.symbol);
      if (m) counts.set(m, (counts.get(m) ?? 0) + 1);
    }
    return counts;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows]);

  const inMarket = useCallback(
    (symbol: string) =>
      marketFilter === "ALL" ||
      symbolMarketMap.current.get(symbol) === marketFilter,
    [marketFilter],
  );

  const filteredRows = useMemo(
    () => rows.filter((r) => inMarket(r.symbol)),
    [rows, inMarket],
  );

  // Curated symbols not yet in DB, for the current market filter.
  // These are shown greyed in ScanResultsPanel with a one-click ingest button.
  const inDbSet = useMemo(() => new Set(rows.map((r) => r.symbol)), [rows]);
  const filteredPlaceholders = useMemo((): PlaceholderSymbol[] => {
    return allSymbols
      .filter(
        (s) =>
          !s.inDb &&
          !inDbSet.has(s.symbol) &&
          (marketFilter === "ALL" ||
            symbolMarketMap.current.get(s.symbol) === marketFilter),
      )
      .map((s) => ({
        symbol: s.symbol,
        name: s.name,
        assetClass: s.assetClass as string,
        currency: s.currency,
        exchange: s.exchange,
        providerId: s.providerId,
      }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allSymbols, inDbSet, marketFilter]);

  // Market filter applies to EVERY panel, not just the scan table
  const visibleSignals = useMemo(
    () => signals.filter((s) => inMarket(s.symbol)),
    [signals, inMarket],
  );
  const visibleConsensus = useMemo(
    () => consensus.filter((c) => inMarket(c.symbol)),
    [consensus, inMarket],
  );
  const visibleIdeas = useMemo(
    () => ideas.filter((i) => inMarket(i.symbol)),
    [ideas, inMarket],
  );
  const visibleTrades = useMemo(
    () => trades.filter((t) => inMarket(t.symbol)),
    [trades, inMarket],
  );

  const visibleRows = useMemo(
    () =>
      filteredRows.map((row) => {
        const quote = quotes.get(row.symbol);
        if (
          !quote ||
          quote.time.slice(0, 10) < row.latestTime ||
          !isFinite(quote.price)
        )
          return row;
        const changePct =
          row.prevClose !== 0
            ? ((quote.price - row.prevClose) / row.prevClose) * 100
            : 0;
        return {
          ...row,
          last: quote.price,
          changePct,
          priceSource: "quote" as const,
          quoteTime: quote.time,
        };
      }),
    [filteredRows, quotes],
  );

  // Header-click sorting. Sorted in the Dashboard (not inside the panels) so
  // the j/k keyboard selection index always matches what is on screen.
  const scanSort = useTableSort(visibleRows, {
    symbol: (r) => r.symbol,
    name:   (r) => r.name,
    last:   (r) => r.last,
    chg:    (r) => r.changePct,
    vol:    (r) => r.volume,
  });
  const ideasSort = useTableSort(visibleIdeas, {
    symbol: (i) => i.symbol,
    entry:  (i) => i.entryPrice,
    qty:    (i) => i.qty,
    risk:   (i) => i.riskAmount,
    rr:     (i) => i.rr,
    conv:   (i) => i.conviction?.score ?? null,
  });

  // All-strategies x all-symbols scan ('s' key / SCAN ALL button)
  const runScanAll = useCallback(async () => {
    setScanningAll(true);
    setScanStatus("scanning all strategies...");
    try {
      const res = await fetch("/api/scan-all", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = (await res.json()) as {
        consensus: ConsensusSignal[];
        signals: Signal[];
        ideas: EnrichedTradeIdea[];
        edges: Record<string, EdgeSummary | null>;
        scanned: number;
        totalStrategies: number;
        durationMs: number;
      };
      setConsensus(data.consensus);
      setSignals(data.signals);
      setIdeas(data.ideas ?? []);
      setSignalEdges(data.edges ?? {});
      setScanStatus(
        `${data.scanned} symbols x ${data.totalStrategies} strategies: ` +
          `${data.consensus.length} consensus signal(s) in ${data.durationMs}ms`,
      );
    } catch (err) {
      setScanStatus(
        `error: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setScanningAll(false);
    }
  }, []);

  // --- Account / budget ---

  const loadAccount = useCallback(async () => {
    try {
      const res = await fetch("/api/paper", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "risk" }),
      });
      if (!res.ok) return;
      const { account: acct, exposure } = (await res.json()) as {
        account: AccountSummary | null;
        exposure: RiskExposure;
      };
      setAccount(acct);
      setRiskExposure(exposure);
    } catch {
      // strip stays stale; non-critical
    }
  }, []);

  useEffect(() => {
    void loadAccount();
  }, [loadAccount]);

  // Backtested win rate per strategy (global scope) for TRUST/WATCH/AVOID verdicts
  useEffect(() => {
    fetch("/api/edge?scope=global")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { rows?: { strategyId: string; winRate: number }[] } | null) => {
        if (!d?.rows) return;
        setBacktestWinRates(
          Object.fromEntries(d.rows.map((r) => [r.strategyId, r.winRate])),
        );
      })
      .catch(() => {
        // verdicts degrade to WATCH without backtest data; non-critical
      });
  }, []);

  const setBudget = useCallback(async (amount: number) => {
    try {
      const res = await fetch("/api/paper", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "account-set", startingBalance: amount }),
      });
      if (!res.ok) {
        const { error } = (await res.json()) as { error?: string };
        setScanStatus(`budget: ${error ?? "request failed"}`);
        return;
      }
      const { account: acct } = (await res.json()) as {
        account: AccountSummary | null;
      };
      setAccount(acct);
      setScanStatus(`budget set to $${amount.toFixed(2)}`);
    } catch (err) {
      setScanStatus(
        `budget error: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }, []);

  // --- Watchlist ([w] toggle, [p] pin selected row) ---

  const loadWatchlist = useCallback(async () => {
    try {
      const res = await fetch("/api/watchlist");
      if (!res.ok) return;
      const { items } = (await res.json()) as { items: WatchlistItem[] };
      setWatchlistItems(items);
    } catch {
      // keep stale items; sidebar is non-critical
    }
  }, []);

  const toggleWatchlist = useCallback(() => {
    setWatchlistOpen((open) => {
      if (!open) void loadWatchlist();
      return !open;
    });
  }, [loadWatchlist]);

  const mutateWatchlist = useCallback(
    async (action: "add" | "remove", symbol: string) => {
      try {
        const res = await fetch("/api/watchlist", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action, symbol }),
        });
        if (!res.ok) {
          const { error } = (await res.json()) as { error?: string };
          setScanStatus(`watchlist: ${error ?? "request failed"}`);
          return;
        }
        const { items } = (await res.json()) as { items: WatchlistItem[] };
        setWatchlistItems(items);
        if (action === "add") {
          setWatchlistOpen(true);
          setScanStatus(`pinned ${symbol}`);
        }
      } catch (err) {
        setScanStatus(
          `watchlist error: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    },
    [],
  );

  const { selected, setSelected } = useKeyboardNav({
    count: scanSort.sorted.length,
    onActivate: (i) => {
      if (scanSort.sorted[i])
        router.push(`/backtest?symbol=${scanSort.sorted[i].symbol}`);
    },
    onCommand: () => cmdRef.current?.focus(),
    onGoToSymbol: () => setGotoOpen(true),
    onScanAll: () => void runScanAll(),
    onWatchlist: toggleWatchlist,
    onPin: (i) => {
      if (scanSort.sorted[i]) void mutateWatchlist("add", scanSort.sorted[i].symbol);
    },
    onFocusIdeas: () => setIdeasFocus(true),
    enabled: !gotoOpen && !ideasFocus && pendingIdea === null,
  });

  // Trade-ideas focus zone ([i]): j/k over idea rows, Enter pre-fills a paper
  // trade, second Enter (in QuickTradeConfirm) opens it, Escape backs out.
  const { selected: ideaSelected, setSelected: setIdeaSelected } =
    useKeyboardNav({
      count: ideasSort.sorted.length,
      onActivate: (i) => {
        const idea = ideasSort.sorted[i];
        if (!idea) return;
        if (!idea.gate.passed) {
          setScanStatus(`idea gated - ${idea.gate.reason}`);
          return;
        }
        setPendingIdea(idea);
      },
      onFocusIdeas: () => setIdeasFocus(false),
      onWatchlist: toggleWatchlist,
      onEscape: () => setIdeasFocus(false),
      enabled: ideasFocus && pendingIdea === null && !gotoOpen,
    });

  // Entering the ideas zone pre-selects the first row so Enter works at once
  useEffect(() => {
    if (ideasFocus) setIdeaSelected(visibleIdeas.length > 0 ? 0 : -1);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ideasFocus]);

  const handleMarketRefresh = useCallback(
    (newRows: MarketRow[]) => {
      setRows(newRows);
      setSelected(-1);
    },
    [setSelected],
  );

  const refreshQuotes = useCallback(async (sourceRows: MarketRow[]) => {
    const symbols = sourceRows.slice(0, 100).map((r) => r.symbol);
    if (symbols.length === 0) return;
    try {
      const res = await fetch(
        `/api/quotes?symbols=${encodeURIComponent(symbols.join(","))}`,
      );
      if (!res.ok) return;
      const data = (await res.json()) as { quotes?: QuoteRow[] };
      setQuotes(new Map((data.quotes ?? []).map((q) => [q.symbol, q])));
    } catch {
      setQuotes(new Map());
    }
  }, []);

  useEffect(() => {
    void refreshQuotes(filteredRows);
  }, [filteredRows, refreshQuotes]);

  // Load marks and book on initial mount
  useEffect(() => {
    const init = async () => {
      const [markRes, bookRes] = await Promise.all([
        fetch("/api/paper", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "mark", useQuotes: false }),
        }),
        fetch("/api/paper", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "tradebook" }),
        }),
      ]);
      if (markRes.ok) {
        const { marks: markResults } = (await markRes.json()) as {
          marks: { trade: { id: string }; unrealizedPnl: number; unrealizedPnlPct: number; markPrice: number }[];
        };
        setMarks(new Map(markResults.map((m) => [m.trade.id, { unrealizedPnl: m.unrealizedPnl, unrealizedPnlPct: m.unrealizedPnlPct, markPrice: m.markPrice }])));
      }
      if (bookRes.ok) {
        const { book: newBook } = (await bookRes.json()) as { book: TradeBook };
        setBook(newBook);
      }
    };
    void init();
  // Run once on mount only
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSignals = useCallback(
    (sigs: Signal[], newIdeas?: EnrichedTradeIdea[], newEdges?: Record<string, EdgeSummary | null>) => {
      setSignals(sigs);
      if (newIdeas) setIdeas(newIdeas);
      if (newEdges) setSignalEdges(newEdges);
    },
    [],
  );

  const handleTakeIdea = useCallback(async (idea: EnrichedTradeIdea) => {
    setIdeaBusy(true);
    try {
      const res = await fetch("/api/paper", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "open",
          strategyId: idea.strategyId,
          symbol: idea.symbol,
          side: idea.side,
          entryPrice: idea.entryPrice,
          entryTime: idea.time,
          stopPrice: idea.stopPrice,
          targetPrice: idea.targetPrice,
          qty: idea.qty,
          // WHY snapshot for the trade journal - frozen at decision time
          journal: {
            reason: idea.reason,
            rr: idea.rr,
            riskAmount: idea.riskAmount,
            conviction: idea.conviction ?? null,
            edge: idea.edge ?? null,
            signalTime: idea.time,
          },
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      // Refresh trades list
      const tRes = await fetch("/api/paper", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "list" }),
      });
      if (tRes.ok) {
        const { trades: newTrades } = (await tRes.json()) as {
          trades: PaperTrade[];
        };
        setTrades(newTrades);
      }
      setScanStatus(
        `Paper trade opened: ${idea.side.toUpperCase()} ${idea.symbol} x${idea.qty.toFixed(2)}`,
      );
      void loadAccount();
    } catch (err) {
      setScanStatus(
        `error opening trade: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setIdeaBusy(false);
    }
  }, [loadAccount]);

  const confirmPendingIdea = useCallback(async () => {
    if (!pendingIdea) return;
    await handleTakeIdea(pendingIdea);
    setPendingIdea(null);
  }, [pendingIdea, handleTakeIdea]);

  // Pull new bars from providers, then re-read market + trades data
  const refreshAll = useCallback(async () => {
    setRefreshing(true);
    try {
      // Fetch any bars newer than what the DB holds (incl. today's live bar)
      setScanStatus("fetching new bars...");
      try {
        const iRes = await fetch("/api/ingest", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mode: "refresh" }),
        });
        if (iRes.ok) {
          const { totalBars, errors } = (await iRes.json()) as {
            totalBars: number;
            errors: number;
          };
          setScanStatus(
            `refresh: ${totalBars} new bar(s)` +
              (errors > 0 ? `, ${errors} symbol error(s)` : ""),
          );
        } else {
          setScanStatus("refresh failed - showing stored data");
        }
      } catch {
        setScanStatus("refresh failed - showing stored data");
      }

      // Run EOD sweep (auto-close stops/targets), then refresh UI
      await fetch("/api/paper", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "sweep" }),
      });

      const [mRes, tRes, markRes, bookRes] = await Promise.all([
        fetch("/api/market"),
        fetch("/api/paper", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "list" }),
        }),
        fetch("/api/paper", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "mark", useQuotes: false }),
        }),
        fetch("/api/paper", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "tradebook" }),
        }),
      ]);
      if (mRes.ok) {
        const { rows: newRows } = (await mRes.json()) as { rows: MarketRow[] };
        setRows(newRows);
        void refreshQuotes(newRows);
        setSelected(-1);
      }
      if (tRes.ok) {
        const { trades: newTrades } = (await tRes.json()) as {
          trades: PaperTrade[];
        };
        setTrades(newTrades);
      }
      if (markRes.ok) {
        const { marks: markResults } = (await markRes.json()) as {
          marks: { trade: { id: string }; unrealizedPnl: number; unrealizedPnlPct: number; markPrice: number }[];
        };
        setMarks(new Map(markResults.map((m) => [m.trade.id, { unrealizedPnl: m.unrealizedPnl, unrealizedPnlPct: m.unrealizedPnlPct, markPrice: m.markPrice }])));
      }
      if (bookRes.ok) {
        const { book: newBook } = (await bookRes.json()) as { book: TradeBook };
        setBook(newBook);
      }
      void loadAccount();
    } finally {
      setRefreshing(false);
    }
  }, [setSelected, loadAccount]);

  // Quick scan from the signal-dashboard strategy picker
  const quickScan = useCallback(async () => {
    if (!scanStratId) return;
    setScanStatus("scanning...");
    try {
      const res = await fetch("/api/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ strategyId: scanStratId }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = (await res.json()) as {
        signals: Signal[];
        ideas: EnrichedTradeIdea[];
        edges: Record<string, EdgeSummary | null>;
        scanned: number;
        durationMs: number;
      };
      setSignals(data.signals);
      setIdeas(data.ideas ?? []);
      setSignalEdges(data.edges ?? {});
      setScanStatus(
        `${data.signals.length} signal(s), ${(data.ideas ?? []).length} idea(s) across ${data.scanned} symbol(s) in ${data.durationMs}ms`,
      );
    } catch (err) {
      setScanStatus(
        `error: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }, [scanStratId]);

  // Auto-run quick scan when strategy changes (if signals already shown)
  useEffect(() => {
    if (signals.length > 0) void quickScan();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scanStratId]);

  return (
    <>
      {gotoOpen && (
        <GoToSymbolOverlay
          allSymbols={allSymbols}
          onClose={() => setGotoOpen(false)}
        />
      )}

      {watchlistOpen && (
        <WatchlistSidebar
          items={watchlistItems}
          strategies={strategies}
          onUnpin={(symbol) => void mutateWatchlist("remove", symbol)}
          onClose={() => setWatchlistOpen(false)}
          onNavigate={(symbol) => router.push(`/backtest?symbol=${symbol}`)}
        />
      )}

      {pendingIdea && (
        <QuickTradeConfirm
          idea={pendingIdea}
          busy={ideaBusy}
          account={account}
          strategyName={
            strategies.find((s) => s.id === pendingIdea.strategyId)?.name
          }
          onConfirm={() => void confirmPendingIdea()}
          onCancel={() => setPendingIdea(null)}
        />
      )}

      <div className="flex flex-col h-full" style={{ minHeight: "100vh" }}>
        {/* Status bar */}
        <div
          className="flex items-center justify-between px-4 py-2 shrink-0 gap-4"
          style={{
            background: "var(--bg-panel-header)",
            borderBottom: "1px solid var(--border)",
          }}
        >
          <div className="flex items-center gap-4 shrink-0">
            <span
              style={{
                color: "var(--color-accent)",
                fontWeight: 700,
                letterSpacing: "0.1em",
                fontSize: "var(--fs-sm)",
              }}
            >
              QUANTDESK
            </span>
            <nav className="flex gap-3" style={{ fontSize: "var(--fs-xs)" }}>
              <a
                href="/"
                style={{ color: "var(--color-accent)", textDecoration: "none" }}
              >
                DASH
              </a>
              <a
                href="/backtest"
                style={{ color: "var(--text-muted)", textDecoration: "none" }}
              >
                BACKTEST
              </a>
              <a
                href="/compare"
                style={{ color: "var(--text-muted)", textDecoration: "none" }}
              >
                COMPARE
              </a>
              <a
                href="/paper"
                style={{ color: "var(--text-muted)", textDecoration: "none" }}
              >
                PAPER
              </a>
              <a
                href="/journal"
                style={{ color: "var(--text-muted)", textDecoration: "none" }}
              >
                JOURNAL
              </a>
            </nav>
          </div>

          <CommandBar
            ref={cmdRef}
            onMarketRefresh={handleMarketRefresh}
            onSignals={handleSignals}
          />

          <div className="flex items-center gap-3 shrink-0">
            <button
              onClick={() => void refreshAll()}
              disabled={refreshing}
              title="Refresh market data"
              style={{
                background: "var(--bg-panel)",
                border: "1px solid var(--border)",
                color: refreshing ? "var(--color-accent)" : "var(--text-muted)",
                fontFamily: "var(--font-mono)",
                fontSize: "var(--fs-xs)",
                padding: "2px 8px",
                cursor: "pointer",
                letterSpacing: "0.04em",
              }}
            >
              {refreshing ? "REFRESHING..." : "REFRESH"}
            </button>
            <span
              style={{
                color: "var(--text-muted)",
                fontSize: "var(--fs-xs)",
                whiteSpace: "nowrap",
              }}
            >
              [/] cmd &nbsp; [g] symbol &nbsp; [s] scan &nbsp; [w] watchlist &nbsp; [p] pin &nbsp; [i] ideas &nbsp; [j/k] nav
            </span>
            <DublinClock />
          </div>
        </div>

        {/* Strategy picker bar for signal dashboard */}
        <div
          className="flex items-center gap-3 px-4 py-1 shrink-0"
          style={{
            background: "var(--bg-panel-header)",
            borderBottom: "1px solid var(--border)",
          }}
        >
          <span
            style={{
              color: "var(--text-muted)",
              fontSize: "var(--fs-xs)",
              letterSpacing: "0.06em",
            }}
          >
            SIGNAL SCAN:
          </span>
          <select
            value={scanStratId}
            onChange={(e) => setScanStratId(e.target.value)}
            style={{
              background: "var(--bg-panel)",
              border: "1px solid var(--border)",
              color: "var(--text-primary)",
              fontFamily: "var(--font-mono)",
              fontSize: "var(--fs-xs)",
              padding: "1px 6px",
            }}
          >
            {strategies.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
            {strategies.length === 0 && <option value="">no strategies</option>}
          </select>
          <button
            onClick={() => void quickScan()}
            style={{
              background: "var(--bg-panel)",
              border: "1px solid var(--border)",
              color: "var(--color-accent)",
              fontFamily: "var(--font-mono)",
              fontSize: "var(--fs-xs)",
              padding: "1px 10px",
              cursor: "pointer",
            }}
          >
            SCAN
          </button>
          <button
            onClick={() => void runScanAll()}
            disabled={scanningAll}
            title="Run every strategy against every symbol [s]"
            style={{
              background: scanningAll ? "var(--bg-panel-header)" : "var(--bg-panel)",
              border: "1px solid var(--color-accent)",
              color: "var(--color-accent)",
              fontFamily: "var(--font-mono)",
              fontSize: "var(--fs-xs)",
              padding: "1px 10px",
              cursor: scanningAll ? "wait" : "pointer",
              fontWeight: 700,
            }}
          >
            {scanningAll ? "SCANNING..." : "SCAN ALL [s]"}
          </button>
          {scanStatus && (
            <span
              style={{ color: "var(--text-muted)", fontSize: "var(--fs-xs)" }}
            >
              {scanStatus}
            </span>
          )}
        </div>

        {/* Market filter tabs */}
        {presentMarkets.length > 0 && (
          <div
            className="flex items-center gap-1 px-4 py-1 shrink-0 overflow-x-auto"
            style={{
              background: "var(--bg-panel-header)",
              borderBottom: "1px solid var(--border)",
            }}
          >
            {(["ALL", ...presentMarkets] as (Market | "ALL")[]).map((m) => (
              <button
                key={m}
                onClick={() => {
                  setMarketFilter(m);
                  setSelected(-1);
                }}
                title="filters every panel below - scan, signals, ideas, trades"
                style={{
                  background:
                    marketFilter === m
                      ? "var(--color-accent)"
                      : "var(--bg-panel)",
                  border: "1px solid var(--border)",
                  color: marketFilter === m ? "#0a0e14" : "var(--text-muted)",
                  fontFamily: "var(--font-mono)",
                  fontSize: "var(--fs-xs)",
                  padding: "1px 10px",
                  cursor: "pointer",
                  fontWeight: marketFilter === m ? 700 : 400,
                  letterSpacing: "0.06em",
                }}
              >
                {m} ({marketCounts.get(m) ?? 0})
              </button>
            ))}
          </div>
        )}

        {/* Market summary ticker - moved to top per user request */}
        <div className="shrink-0 h-18">
          <MarketSummaryStrip rows={visibleRows} />
        </div>

        {/* Paper trading budget strip */}
        <AccountStrip account={account} onSetBudget={(amt) => void setBudget(amt)} />

        {/* Main content - page-scroll, 12-col grid */}
        <div className="flex-1 overflow-y-auto" style={{ minHeight: 0 }}>
          <div
            className="grid grid-cols-12 gap-px"
            style={{ background: "var(--border)" }}
          >
            {/* Row 1: Scan (7) + Gainers/Losers (5) */}
            <div className="col-span-7 h-95">
              <ScanResultsPanel
                rows={scanSort.sorted}
                selected={selected}
                placeholders={filteredPlaceholders}
                onIngestDone={() => void refreshAll()}
                sort={{ click: scanSort.clickHeader, indicator: scanSort.indicator }}
              />
            </div>
            <div className="col-span-5 h-95">
              <GainersLosersPanel rows={visibleRows} />
            </div>

            {/* Row 2: Signal dashboard (6) + Trade ideas (6) */}
            <div className="col-span-6 h-80">
              <SignalDashboardPanel
                rows={visibleRows}
                signals={visibleSignals}
                consensus={visibleConsensus}
                edges={signalEdges}
              />
            </div>

            {/* Row 3: Trade ideas (6) */}
            <div className="col-span-6 h-80">
              <TradeIdeasPanel
                ideas={ideasSort.sorted}
                onTake={(idea) => setPendingIdea(idea)}
                busy={ideaBusy}
                strategyNames={Object.fromEntries(strategies.map((s) => [s.id, s.name]))}
                focused={ideasFocus}
                selected={ideaSelected}
                sort={{ click: ideasSort.clickHeader, indicator: ideasSort.indicator }}
              />
            </div>

            {/* Row 4: Risk gauges (4) + Strategy edge (8) */}
            <div className="col-span-4 h-40">
              <RiskPanel exposure={riskExposure} account={account} />
            </div>
            <div className="col-span-8 h-40">
              <StrategyEdgePanel book={book} backtestWinRates={backtestWinRates} />
            </div>

            {/* Row 5: Recent trades (full width) */}
            <div className="col-span-12 h-70">
              <TradesPanel trades={visibleTrades} marks={marks} />
            </div>
          </div>
        </div>

        {/* Disclaimer */}
        <div
          className="px-4 py-1 shrink-0 text-center"
          style={{
            background: "var(--bg-base)",
            borderTop: "1px solid var(--border)",
            color: "var(--text-muted)",
            fontSize: "var(--fs-xs)",
            letterSpacing: "0.04em",
          }}
        >
          Research tool. Not financial advice. Backtests are hypothetical and
          subject to survivorship and look-ahead error.
        </div>
      </div>
    </>
  );
}
