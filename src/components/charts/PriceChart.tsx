'use client';

import { useEffect, useRef, type CSSProperties } from 'react';
import EmptyState from '@/components/primitives/EmptyState';
import {
  createChart,
  CandlestickSeries,
  LineSeries,
  HistogramSeries,
  ColorType,
  LineStyle,
  createSeriesMarkers,
  type IChartApi,
  type ISeriesApi,
  type SeriesOptionsMap,
  type ISeriesMarkersPluginApi,
  type IPriceLine,
  type Time,
  type UTCTimestamp,
} from 'lightweight-charts';
import type { Bar } from '@/core/types';
import type { TradeRecord } from '@/core/backtest/engine';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A line drawn on the main price pane (MA, Bollinger band, ...). */
export interface OverlayLine {
  id:    string;
  color: string;
  /** Aligned to bars: values[i] belongs to bars[i]; NaN warm-up values are skipped. */
  values: number[];
  lineWidth?: 1 | 2;
  dashed?: boolean;
}

/** A separate pane below the price chart (RSI, stochastic, volume, ...). */
export interface IndicatorPane {
  id:    string;
  /** Line series in this pane, values aligned to bars like OverlayLine. */
  lines: { id: string; color: string; values: number[] }[];
  /** Horizontal reference lines (e.g. RSI 30/70). */
  refLines?: { value: number; color?: string }[];
  /** Render as histogram colored by bar direction (volume). Uses `lines[0]`. */
  histogram?: boolean;
}

interface Props {
  bars:        Bar[];
  trades?:     TradeRecord[];
  /** Horizontal reference lines for the current trade idea. */
  entryPrice?:  number;
  stopPrice?:   number;
  targetPrice?: number;
  /** Indicator lines on the price pane, aligned to `bars`. */
  overlays?:   OverlayLine[];
  /** Indicator panes below the price pane, aligned to `bars`. */
  panes?:      IndicatorPane[];
  className?:  string;
  /** localStorage key to persist/restore the visible zoom range across visits. Omit to disable. */
  zoomStorageKey?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type CandleData = {
  time: Time;
  open: number;
  high: number;
  low:  number;
  close: number;
};

/**
 * Bar time -> chart time. Daily bars keep their YYYY-MM-DD string; intraday
 * bars (full ISO timestamps) become UTC epoch seconds so multiple bars per
 * day chart correctly instead of collapsing onto one date.
 */
function makeTimeMapper(bars: Bar[]): (t: string) => Time {
  const intraday = bars.some((b) => b.time.length > 10);
  return intraday
    ? (t) => Math.floor(new Date(t).getTime() / 1000) as UTCTimestamp
    : (t) => t.slice(0, 10);
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const overlayStyle: CSSProperties = {
  position:        'absolute',
  inset:           0,
  display:         'flex',
  alignItems:      'center',
  justifyContent:  'center',
  background:      'var(--bg-panel)',
  pointerEvents:   'none',
};

export default function PriceChart({
  bars,
  trades = [],
  entryPrice,
  stopPrice,
  targetPrice,
  overlays = [],
  panes = [],
  className,
  zoomStorageKey,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef     = useRef<IChartApi | null>(null);
  const candlesRef   = useRef<ISeriesApi<keyof SeriesOptionsMap> | null>(null);
  const markersRef   = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const priceLinesRef = useRef<IPriceLine[]>([]);
  const indicatorSeriesRef = useRef<ISeriesApi<keyof SeriesOptionsMap>[]>([]);
  const zoomKeyRef    = useRef(zoomStorageKey);
  zoomKeyRef.current  = zoomStorageKey;
  const restoredZoomRef = useRef(false);

  // Create chart on mount
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const chart = createChart(el, {
      layout: {
        background: { type: ColorType.Solid, color: '#0d1117' },
        textColor: '#8b949e',
      },
      grid: {
        vertLines: { color: '#21262d' },
        horzLines: { color: '#21262d' },
      },
      crosshair: {
        vertLine: { color: '#8b949e', width: 1, style: 3 },
        horzLine: { color: '#8b949e', width: 1, style: 3 },
      },
      timeScale: {
        borderColor: '#30363d',
        timeVisible: true,
      },
      rightPriceScale: { borderColor: '#30363d' },
      width:  el.clientWidth,
      height: el.clientHeight,
    });

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor:     '#26a641',
      downColor:   '#f85149',
      borderVisible: false,
      wickUpColor:   '#26a641',
      wickDownColor: '#f85149',
    });

    chartRef.current   = chart;
    // Cast to the wider generic so createSeriesMarkers accepts it
    candlesRef.current = candleSeries as ISeriesApi<keyof SeriesOptionsMap>;
    // One markers primitive for the chart's lifetime - data set via setMarkers
    markersRef.current = createSeriesMarkers(candlesRef.current, []);

    const ro = new ResizeObserver(() => {
      chart.applyOptions({ width: el.clientWidth, height: el.clientHeight });
    });
    ro.observe(el);

    // Persist zoom (visible logical range) across visits - debounced so we
    // don't hammer localStorage while the user is actively panning/scrolling.
    let saveTimer: ReturnType<typeof setTimeout> | undefined;
    chart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
      const key = zoomKeyRef.current;
      if (!key || !range) return;
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {
        try { localStorage.setItem(key, JSON.stringify(range)); } catch { /* ignore */ }
      }, 300);
    });

    return () => {
      clearTimeout(saveTimer);
      ro.disconnect();
      chart.remove();
      chartRef.current    = null;
      candlesRef.current  = null;
      markersRef.current  = null;
      priceLinesRef.current = [];
      indicatorSeriesRef.current = [];
    };
  }, []);

  // Update data when bars/trades change
  useEffect(() => {
    const candles = candlesRef.current;
    const chart   = chartRef.current;
    if (!candles || !chart) return;

    // Deduplicate by chart time: duplicate keys (e.g. two rows for one daily
    // date) would cause lightweight-charts to throw. Keep the last bar per
    // key so the closing price wins. Intraday bars map to epoch seconds and
    // never collapse.
    const toTime = makeTimeMapper(bars);
    const dateMap = new Map<Time, CandleData>();
    for (const b of bars) {
      const t = toTime(b.time);
      dateMap.set(t, { time: t, open: b.open, high: b.high, low: b.low, close: b.close });
    }
    const candleData = Array.from(dateMap.values()).sort((a, b) => (a.time < b.time ? -1 : 1));
    candles.setData(candleData);

    // Entry/exit markers - update in place, never re-create the primitive
    {
      type Marker = {
        time:     Time;
        position: 'belowBar' | 'aboveBar';
        color:    string;
        shape:    'arrowUp' | 'arrowDown' | 'circle';
        text:     string;
      };
      const markers: Marker[] = trades.flatMap((t): Marker[] => [
        {
          time:     toTime(t.entryTime),
          position: t.side === 'long' ? 'belowBar' : 'aboveBar',
          color:    t.side === 'long' ? '#26a641' : '#f85149',
          shape:    t.side === 'long' ? 'arrowUp' : 'arrowDown',
          text:     `${t.side === 'long' ? 'L' : 'S'} ${t.entryReason ?? ''}`.trim(),
        },
        {
          time:     toTime(t.exitTime),
          position: t.side === 'long' ? 'aboveBar' : 'belowBar',
          color:    '#e3b341',
          shape:    'circle',
          text:     `X ${t.exitReason}`,
        },
      ]);
      markersRef.current?.setMarkers(markers);
    }

    // Restore the last-saved zoom once per mount; fitContent otherwise (first
    // load with no saved range, or later data changes within the same visit).
    let restored = false;
    const key = zoomKeyRef.current;
    if (key && !restoredZoomRef.current) {
      try {
        const saved = localStorage.getItem(key);
        if (saved) {
          chart.timeScale().setVisibleLogicalRange(JSON.parse(saved));
          restored = true;
        }
      } catch { /* ignore */ }
      restoredZoomRef.current = true;
    }
    if (!restored) chart.timeScale().fitContent();
  }, [bars, trades]);

  // Indicator overlays (price pane) + indicator panes below.
  // Series are torn down and re-added when the selection changes - cheap at
  // this scale and avoids tracking per-series identity across toggles.
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    for (const s of indicatorSeriesRef.current) {
      try { chart.removeSeries(s); } catch { /* already removed with a pane */ }
    }
    indicatorSeriesRef.current = [];

    // Aligned values -> line data keyed by chart time; NaN warm-up values and
    // duplicate keys are skipped, mirroring candles.
    const toTime = makeTimeMapper(bars);
    const toLineData = (values: number[]) => {
      const byTime = new Map<Time, { time: Time; value: number }>();
      for (let i = 0; i < bars.length; i++) {
        const v = values[i];
        if (v === undefined || !isFinite(v)) continue;
        const t = toTime(bars[i].time);
        byTime.set(t, { time: t, value: v });
      }
      return Array.from(byTime.values()).sort((a, b) => (a.time < b.time ? -1 : 1));
    };

    for (const o of overlays) {
      const s = chart.addSeries(LineSeries, {
        color: o.color,
        lineWidth: o.lineWidth ?? 1,
        lineStyle: o.dashed ? LineStyle.Dashed : LineStyle.Solid,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      });
      s.setData(toLineData(o.values));
      indicatorSeriesRef.current.push(s as ISeriesApi<keyof SeriesOptionsMap>);
    }

    panes.forEach((pane, i) => {
      const paneIndex = i + 1; // pane 0 is the price pane
      if (pane.histogram && pane.lines[0]) {
        const s = chart.addSeries(HistogramSeries, {
          color: pane.lines[0].color,
          priceLineVisible: false,
          lastValueVisible: false,
        }, paneIndex);
        // Color volume bars by candle direction - build directly from bars so
        // the up/down lookup works for both daily and intraday time keys.
        const values = pane.lines[0].values;
        const byTime = new Map<Time, { time: Time; value: number; color: string }>();
        for (let i = 0; i < bars.length; i++) {
          const v = values[i];
          if (v === undefined || !isFinite(v)) continue;
          const t = toTime(bars[i].time);
          const up = bars[i].close >= bars[i].open;
          byTime.set(t, { time: t, value: v, color: up ? '#26a64155' : '#f8514955' });
        }
        s.setData(Array.from(byTime.values()).sort((a, b) => (a.time < b.time ? -1 : 1)));
        indicatorSeriesRef.current.push(s as ISeriesApi<keyof SeriesOptionsMap>);
      } else {
        let first: ISeriesApi<'Line'> | null = null;
        for (const line of pane.lines) {
          const s = chart.addSeries(LineSeries, {
            color: line.color,
            lineWidth: 1,
            priceLineVisible: false,
            lastValueVisible: true,
            crosshairMarkerVisible: false,
          }, paneIndex);
          s.setData(toLineData(line.values));
          if (!first) first = s;
          indicatorSeriesRef.current.push(s as ISeriesApi<keyof SeriesOptionsMap>);
        }
        for (const ref of pane.refLines ?? []) {
          first?.createPriceLine({
            price: ref.value,
            color: ref.color ?? '#8b949e',
            lineWidth: 1,
            lineStyle: LineStyle.Dashed,
            axisLabelVisible: false,
            title: '',
          });
        }
      }
      chart.panes()[paneIndex]?.setHeight(90);
    });
  }, [overlays, panes, bars]);

  // Price lines for the current trade idea (entry / stop / target)
  useEffect(() => {
    const candles = candlesRef.current;
    if (!candles) return;

    for (const line of priceLinesRef.current) candles.removePriceLine(line);
    priceLinesRef.current = [];

    const lines: Array<{ price: number | undefined; color: string; title: string }> = [
      { price: entryPrice,  color: '#e3b341', title: 'entry' },
      { price: stopPrice,   color: '#f85149', title: 'stop' },
      { price: targetPrice, color: '#26a641', title: 'target' },
    ];
    for (const { price, color, title } of lines) {
      if (price === undefined || !isFinite(price)) continue;
      priceLinesRef.current.push(
        candles.createPriceLine({
          price,
          color,
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: true,
          title,
        }),
      );
    }
  }, [entryPrice, stopPrice, targetPrice, bars]);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }} className={className}>
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
      {bars.length < 2 && (
        <div style={overlayStyle}>
          <EmptyState
            message="— too few bars to chart —"
            hint="ingest data first: npm run ingest"
          />
        </div>
      )}
    </div>
  );
}
