"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import DublinClock from "@/components/primitives/DublinClock";
import CommandBar, { type CommandBarHandle } from "@/components/overlays/CommandBar";
import ScanResultsPanel, { type PlaceholderSymbol } from "@/components/panels/ScanResultsPanel";
import GainersLosersPanel from "@/components/panels/GainersLosersPanel";
import SignalDashboardPanel from "@/components/panels/SignalDashboardPanel";
import TradesPanel, { type MarksMap } from "@/components/panels/TradesPanel";
import TradeIdeasPanel from "@/components/panels/TradeIdeasPanel";
import StrategyEdgePanel from "@/components/panels/StrategyEdgePanel";
import MarketSummaryStrip from "@/components/panels/MarketSummaryStrip";
import GoToSymbolOverlay from "@/components/overlays/GoToSymbolOverlay";
import WatchlistSidebar from "@/components/dashboard/WatchlistSidebar";
import QuickTradeConfirm from "@/components/trade/QuickTradeConfirm";
import AccountStrip from "@/components/panels/AccountStrip";
import RiskPanel from "@/components/panels/RiskPanel";
import { Group, Panel, useDefaultLayout } from "react-resizable-panels";
import ResizeHandle from "@/components/primitives/ResizeHandle";
import { useKeyboardNav } from "@/hooks/useKeyboardNav";
import { useTableSort } from "@/hooks/useTableSort";
import { usePersistedState } from "@/hooks/usePersistedState";
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
  const [scanningAll, setScanningAll] = useState(false);
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
  const [quotes, setQuotes] = useState(new Map<string, QuoteRow>());

  // Persisted UI prefs - survive full reloads and <a href> navigation
  const [marketFilter, setMarketFilter] = usePersistedState<Market | "ALL">("qd.v1.marketFilter", "ALL");
  const [tab, setTab] = usePersistedState<"scan" | "signals" | "risk">("qd.v1.tab", "scan");

  // Persisted scan results - bundled atomically so they rehydrate together
  interface ScanBundle {
    signals:      Signal[];
    consensus:    ConsensusSignal[];
    ideas:        EnrichedTradeIdea[];
    signalEdges:  Record<string, EdgeSummary | null>;
    scanStatus:   string;
  }
  const EMPTY_SCAN: ScanBundle = { signals: [], consensus: [], ideas: [], signalEdges: {}, scanStatus: "" };
  const [scanBundle, setScanBundle] = usePersistedState<ScanBundle>("qd.v1.scan", EMPTY_SCAN);
  const { signals, consensus, ideas, signalEdges, scanStatus } = scanBundle;
  const setSignals      = (s: Signal[])                              => setScanBundle((b) => ({ ...b, signals: s }));
  const setConsensus    = (c: ConsensusSignal[])                     => setScanBundle((b) => ({ ...b, consensus: c }));
  const setIdeas        = (i: EnrichedTradeIdea[])                   => setScanBundle((b) => ({ ...b, ideas: i }));
  const setSignalEdges  = (e: Record<string, EdgeSummary | null>)    => setScanBundle((b) => ({ ...b, signalEdges: e }));
  const setScanStatus   = (s: string)                                => setScanBundle((b) => ({ ...b, scanStatus: s }));
  const cmdRef = useRef<CommandBarHandle>(null);
  const router = useRouter();

  // SSR-safe storage shim — localStorage is undefined during server render
  const ssrSafeStorage = useMemo(() => ({
    getItem: (key: string) => (typeof window !== 'undefined' ? localStorage.getItem(key) : null),
    setItem: (key: string, value: string) => { if (typeof window !== 'undefined') localStorage.setItem(key, value); },
    removeItem: (key: string) => { if (typeof window !== 'undefined') localStorage.removeItem(key); },
  }), []);

  // Panel layout persistence via react-resizable-panels v4 useDefaultLayout hook
  const scanLayout     = useDefaultLayout({ id: 'qd-scan',     panelIds: ['scan-results', 'scan-gainers'],  storage: ssrSafeStorage });
  const signalsLayout  = useDefaultLayout({ id: 'qd-signals',  panelIds: ['sig-dashboard', 'sig-ideas'],    storage: ssrSafeStorage });
  const riskVLayout    = useDefaultLayout({ id: 'qd-risk-v',   panelIds: ['risk-top', 'risk-trades'],       storage: ssrSafeStorage });
  const riskTopLayout  = useDefaultLayout({ id: 'qd-risk-top', panelIds: ['risk-gauges', 'risk-edge'],      storage: ssrSafeStorage });

  // Build a symbol -> market map from allSymbols (already has assetClass/exchange).
  // useMemo (not ref+effect) so the map exists on first render and is a real
  // reactive dependency for marketCounts, inMarket, and filteredPlaceholders.
  const symbolMarketMap = useMemo(() => {
    const m = new Map<string, Market>();
    for (const s of allSymbols) {
      m.set(s.symbol, marketOf({ symbol: s.symbol, assetClass: s.assetClass, exchange: s.exchange }));
    }
    return m;
  }, [allSymbols]);

  // Core equity markets always get a tab (even with zero symbols ingested, so
  // the user can see the bucket exists); other buckets appear when present.
  const CORE_MARKETS: Market[] = ["US", "EU", "NSE", "BSE"];
  const presentMarkets = ALL_MARKETS.filter(
    (m) =>
      CORE_MARKETS.includes(m) ||
      allSymbols.some((s) => symbolMarketMap.get(s.symbol) === m),
  );

  // Ingested-symbol count per market for the tab labels
  const marketCounts = useMemo(() => {
    const counts = new Map<Market | "ALL", number>([["ALL", rows.length]]);
    for (const r of rows) {
      const m = symbolMarketMap.get(r.symbol);
      if (m) counts.set(m, (counts.get(m) ?? 0) + 1);
    }
    return counts;
  }, [rows, symbolMarketMap]);

  const inMarket = useCallback(
    (symbol: string) =>
      marketFilter === "ALL" ||
      symbolMarketMap.get(symbol) === marketFilter,
    [marketFilter, symbolMarketMap],
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
            symbolMarketMap.get(s.symbol) === marketFilter),
      )
      .map((s) => ({
        symbol: s.symbol,
        name: s.name,
        assetClass: s.assetClass as string,
        currency: s.currency,
        exchange: s.exchange,
        providerId: s.providerId,
      }));
  }, [allSymbols, inDbSet, marketFilter, symbolMarketMap]);

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
  }, undefined, 'qd.v1.scanSort');
  // ideasSort removed - sorting is now handled by TanStack inside TradeIdeasPanel.

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
    onFocusIdeas: () => { setTab("signals"); setIdeasFocus(true); },
    onTabSwitch: (idx) => {
      const tabs = ["scan", "signals", "risk"] as const;
      if (tabs[idx]) { setTab(tabs[idx]); setSelected(-1); }
    },
    enabled: !gotoOpen && !ideasFocus && pendingIdea === null,
  });

  // Trade-ideas focus zone ([i]): j/k over idea rows, Enter pre-fills a paper
  // trade, second Enter (in QuickTradeConfirm) opens it, Escape backs out.
  const { selected: ideaSelected, setSelected: setIdeaSelected } =
    useKeyboardNav({
      count: visibleIdeas.length,
      onActivate: (i) => {
        const idea = visibleIdeas[i];
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
          orderType: "limit",  // resting limit - pending until market hits entry
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
        `Limit order queued: ${idea.side.toUpperCase()} ${idea.symbol} x${idea.qty.toFixed(2)} @ ${idea.entryPrice} (pending until entry hit)`,
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

  // Stable prop references so React.memo'd children skip re-renders when these
  // values haven't changed. Must be derived here (not inline in JSX).
  const strategyNames = useMemo(
    () => Object.fromEntries(strategies.map((s) => [s.id, s.name])),
    [strategies],
  );
  const onIngestDone = useCallback(() => void refreshAll(), [refreshAll]);
  const onTakeIdea = useCallback((idea: Parameters<typeof setPendingIdea>[0]) => setPendingIdea(idea), []);
  const scanSortProp = useMemo(
    () => ({ click: scanSort.clickHeader, indicator: scanSort.indicator }),
    [scanSort.clickHeader, scanSort.indicator],
  );
  // ideasSortProp removed - TradeIdeasPanel now handles sorting internally via TanStack.

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
              <a
                href="/settings"
                style={{ color: "var(--text-muted)", textDecoration: "none" }}
              >
                SETTINGS
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
              [/] cmd &nbsp; [g] symbol &nbsp; [s] scan &nbsp; [w] watchlist &nbsp; [p] pin &nbsp; [i] ideas &nbsp; [1/2/3] tabs &nbsp; [j/k] nav
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

        {/* Tab strip */}
        <div
          className="flex items-center gap-1 px-4 py-1 shrink-0"
          style={{
            background: "var(--bg-panel-header)",
            borderBottom: "1px solid var(--border)",
          }}
        >
          {(["scan", "signals", "risk"] as const).map((t, idx) => {
            const labels = { scan: "SCAN", signals: "SIGNALS & IDEAS", risk: "RISK & TRADES" };
            const active = tab === t;
            return (
              <button
                key={t}
                onClick={() => { setTab(t); setSelected(-1); }}
                title={`Switch to ${labels[t]} [${idx + 1}]`}
                style={{
                  background: active ? "var(--color-accent)" : "var(--bg-panel)",
                  border: "1px solid var(--border)",
                  color: active ? "#0a0e14" : "var(--text-muted)",
                  fontFamily: "var(--font-mono)",
                  fontSize: "var(--fs-xs)",
                  padding: "1px 14px",
                  cursor: "pointer",
                  fontWeight: active ? 700 : 400,
                  letterSpacing: "0.06em",
                }}
              >
                [{idx + 1}] {labels[t]}
              </button>
            );
          })}
        </div>

        {/* Main content - tabbed, resizable panels */}
        <div className="flex-1 overflow-hidden" style={{ minHeight: 0 }}>
          {/* Tab: SCAN - Scan results + Gainers/Losers */}
          {tab === "scan" && (
            <Group
              orientation="horizontal"
              defaultLayout={scanLayout.defaultLayout ?? { 'scan-results': 58, 'scan-gainers': 42 }}
              onLayoutChanged={scanLayout.onLayoutChanged}
              style={{ height: "100%" }}
            >
              <Panel id="scan-results" defaultSize={58} minSize={25}>
                <ScanResultsPanel
                  rows={scanSort.sorted}
                  selected={selected}
                  placeholders={filteredPlaceholders}
                  onIngestDone={onIngestDone}
                  sort={scanSortProp}
                />
              </Panel>
              <ResizeHandle orientation="horizontal" />
              <Panel id="scan-gainers" defaultSize={42} minSize={20}>
                <GainersLosersPanel rows={visibleRows} />
              </Panel>
            </Group>
          )}

          {/* Tab: SIGNALS & IDEAS - Signal dashboard + Trade ideas */}
          {tab === "signals" && (
            <Group
              orientation="horizontal"
              defaultLayout={signalsLayout.defaultLayout ?? { 'sig-dashboard': 50, 'sig-ideas': 50 }}
              onLayoutChanged={signalsLayout.onLayoutChanged}
              style={{ height: "100%" }}
            >
              <Panel id="sig-dashboard" defaultSize={50} minSize={25}>
                <SignalDashboardPanel
                  rows={visibleRows}
                  signals={visibleSignals}
                  consensus={visibleConsensus}
                  edges={signalEdges}
                />
              </Panel>
              <ResizeHandle orientation="horizontal" />
              <Panel id="sig-ideas" defaultSize={50} minSize={25}>
                <TradeIdeasPanel
                  ideas={visibleIdeas}
                  onTake={onTakeIdea}
                  busy={ideaBusy}
                  strategyNames={strategyNames}
                  focused={ideasFocus}
                  selected={ideaSelected}
                />
              </Panel>
            </Group>
          )}

          {/* Tab: RISK & TRADES - top row (Risk + Edge) + Trades below */}
          {tab === "risk" && (
            <Group
              orientation="vertical"
              defaultLayout={riskVLayout.defaultLayout ?? { 'risk-top': 28, 'risk-trades': 72 }}
              onLayoutChanged={riskVLayout.onLayoutChanged}
              style={{ height: "100%" }}
            >
              <Panel id="risk-top" defaultSize={28} minSize={15}>
                <Group
                  orientation="horizontal"
                  defaultLayout={riskTopLayout.defaultLayout ?? { 'risk-gauges': 33, 'risk-edge': 67 }}
                  onLayoutChanged={riskTopLayout.onLayoutChanged}
                  style={{ height: "100%" }}
                >
                  <Panel id="risk-gauges" defaultSize={33} minSize={20}>
                    <RiskPanel exposure={riskExposure} account={account} />
                  </Panel>
                  <ResizeHandle orientation="horizontal" />
                  <Panel id="risk-edge" defaultSize={67} minSize={30}>
                    <StrategyEdgePanel book={book} backtestWinRates={backtestWinRates} />
                  </Panel>
                </Group>
              </Panel>
              <ResizeHandle orientation="vertical" />
              <Panel id="risk-trades" defaultSize={72} minSize={25}>
                <TradesPanel trades={visibleTrades} marks={marks} />
              </Panel>
            </Group>
          )}
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
