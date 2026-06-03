"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import DublinClock from "./DublinClock";
import CommandBar, { type CommandBarHandle } from "./CommandBar";
import ScanResultsPanel, { type PlaceholderSymbol } from "./ScanResultsPanel";
import GainersLosersPanel from "./GainersLosersPanel";
import SignalDashboardPanel from "./SignalDashboardPanel";
import TradesPanel from "./TradesPanel";
import TradeIdeasPanel from "./TradeIdeasPanel";
import MarketSummaryStrip from "./MarketSummaryStrip";
import GoToSymbolOverlay from "./GoToSymbolOverlay";
import { useKeyboardNav } from "./useKeyboardNav";
import type { MarketRow } from "@/core/market/snapshot";
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
  const [signals, setSignals] = useState<Signal[]>([]);
  const [ideas, setIdeas] = useState<TradeIdea[]>([]);
  const [ideaBusy, setIdeaBusy] = useState(false);
  const [strategies] = useState(initialStrategies);
  const [scanStratId, setScanStratId] = useState(
    initialStrategies[0]?.id ?? "",
  );
  const [gotoOpen, setGotoOpen] = useState(false);
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

  // Show tabs for any market that has at least one curated symbol (ingested or not).
  // This ensures NSE/BSE/etc. always appear even before data is fetched.
  const presentMarkets = ALL_MARKETS.filter((m) =>
    allSymbols.some((s) => symbolMarketMap.current.get(s.symbol) === m),
  );

  const filteredRows = useMemo(
    () =>
      marketFilter === "ALL"
        ? rows
        : rows.filter(
            (r) => symbolMarketMap.current.get(r.symbol) === marketFilter,
          ),
    [marketFilter, rows],
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

  const { selected, setSelected } = useKeyboardNav({
    count: visibleRows.length,
    onActivate: (i) => {
      if (visibleRows[i])
        router.push(`/backtest?symbol=${visibleRows[i].symbol}`);
    },
    onCommand: () => cmdRef.current?.focus(),
    onGoToSymbol: () => setGotoOpen(true),
    enabled: !gotoOpen,
  });

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

  const handleSignals = useCallback(
    (sigs: Signal[], newIdeas?: TradeIdea[]) => {
      setSignals(sigs);
      if (newIdeas) setIdeas(newIdeas);
    },
    [],
  );

  const handleTakeIdea = useCallback(async (idea: TradeIdea) => {
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
    } catch (err) {
      setScanStatus(
        `error opening trade: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setIdeaBusy(false);
    }
  }, []);

  // Fetch fresh market + trades data
  const refreshAll = useCallback(async () => {
    setRefreshing(true);
    try {
      // Run EOD sweep first (auto-close stops/targets), then refresh UI
      await fetch("/api/paper", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "sweep" }),
      });

      const [mRes, tRes] = await Promise.all([
        fetch("/api/market"),
        fetch("/api/paper", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "list" }),
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
    } finally {
      setRefreshing(false);
    }
  }, [setSelected]);

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
        ideas: TradeIdea[];
        scanned: number;
        durationMs: number;
      };
      setSignals(data.signals);
      setIdeas(data.ideas ?? []);
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
                href="/paper"
                style={{ color: "var(--text-muted)", textDecoration: "none" }}
              >
                PAPER
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
              [/] cmd &nbsp; [g] symbol &nbsp; [j/k] nav
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
                {m}
              </button>
            ))}
          </div>
        )}

        {/* Main content - page-scroll, 12-col grid */}
        <div className="flex-1 overflow-y-auto" style={{ minHeight: 0 }}>
          <div
            className="grid grid-cols-12 gap-px"
            style={{ background: "var(--border)" }}
          >
            {/* Row 1: Scan (7) + Gainers/Losers (5) */}
            <div className="col-span-7 h-95">
              <ScanResultsPanel
                rows={visibleRows}
                selected={selected}
                placeholders={filteredPlaceholders}
                onIngestDone={() => void refreshAll()}
              />
            </div>
            <div className="col-span-5 h-95">
              <GainersLosersPanel rows={visibleRows} />
            </div>

            {/* Row 2: Signal dashboard (full width) */}
            <div className="col-span-12 h-80">
              <SignalDashboardPanel rows={visibleRows} signals={signals} />
            </div>

            {/* Row 3: Trade ideas (full width) */}
            <div className="col-span-12 h-80">
              <TradeIdeasPanel
                ideas={ideas}
                onTake={handleTakeIdea}
                busy={ideaBusy}
              />
            </div>

            {/* Row 4: Recent trades (full width) */}
            <div className="col-span-12 h-70">
              <TradesPanel trades={trades} />
            </div>

            {/* Row 5: Market summary strip */}
            <div className="col-span-12 h-18">
              <MarketSummaryStrip rows={visibleRows} />
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
