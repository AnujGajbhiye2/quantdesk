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
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type CandleData = {
  time: string;
  open: number;
  high: number;
  low:  number;
  close: number;
};

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
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef     = useRef<IChartApi | null>(null);
  const candlesRef   = useRef<ISeriesApi<keyof SeriesOptionsMap, string> | null>(null);
  const markersRef   = useRef<ISeriesMarkersPluginApi<string> | null>(null);
  const priceLinesRef = useRef<IPriceLine[]>([]);
  const indicatorSeriesRef = useRef<ISeriesApi<keyof SeriesOptionsMap>[]>([]);

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
    candlesRef.current = candleSeries as ISeriesApi<keyof SeriesOptionsMap, string>;
    // One markers primitive for the chart's lifetime - data set via setMarkers
    markersRef.current = createSeriesMarkers(candlesRef.current, []);

    const ro = new ResizeObserver(() => {
      chart.applyOptions({ width: el.clientWidth, height: el.clientHeight });
    });
    ro.observe(el);

    return () => {
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

    // Deduplicate by date: multiple bars with same date (e.g. daily + intraday
    // both stored in DB) would cause lightweight-charts to throw on duplicate time.
    // Keep the last bar per date so the closing price wins.
    const dateMap = new Map<string, CandleData>();
    for (const b of bars) {
      const date = b.time.slice(0, 10);
      dateMap.set(date, { time: date as CandleData['time'], open: b.open, high: b.high, low: b.low, close: b.close });
    }
    const candleData = Array.from(dateMap.values()).sort((a, b) => (a.time < b.time ? -1 : 1));
    candles.setData(candleData);

    // Entry/exit markers - update in place, never re-create the primitive
    {
      type Marker = {
        time:     string;
        position: 'belowBar' | 'aboveBar';
        color:    string;
        shape:    'arrowUp' | 'arrowDown' | 'circle';
        text:     string;
      };
      const markers: Marker[] = trades.flatMap((t): Marker[] => [
        {
          time:     t.entryTime.slice(0, 10),
          position: t.side === 'long' ? 'belowBar' : 'aboveBar',
          color:    t.side === 'long' ? '#26a641' : '#f85149',
          shape:    t.side === 'long' ? 'arrowUp' : 'arrowDown',
          text:     `${t.side === 'long' ? 'L' : 'S'} ${t.entryReason ?? ''}`.trim(),
        },
        {
          time:     t.exitTime.slice(0, 10),
          position: t.side === 'long' ? 'aboveBar' : 'belowBar',
          color:    '#e3b341',
          shape:    'circle',
          text:     `X ${t.exitReason}`,
        },
      ]);
      markersRef.current?.setMarkers(markers);
    }

    chart.timeScale().fitContent();
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

    // Aligned values -> line data keyed by bar date; NaN warm-up values and
    // duplicate dates (daily + intraday rows) are skipped, mirroring candles.
    const toLineData = (values: number[]) => {
      const byDate = new Map<string, { time: string; value: number }>();
      for (let i = 0; i < bars.length; i++) {
        const v = values[i];
        if (v === undefined || !isFinite(v)) continue;
        const date = bars[i].time.slice(0, 10);
        byDate.set(date, { time: date, value: v });
      }
      return Array.from(byDate.values()).sort((a, b) => (a.time < b.time ? -1 : 1));
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
        // Color volume bars by candle direction
        const data = toLineData(pane.lines[0].values).map((d) => {
          const bar = bars.find((b) => b.time.slice(0, 10) === d.time);
          const up = bar ? bar.close >= bar.open : true;
          return { ...d, color: up ? '#26a64155' : '#f8514955' };
        });
        s.setData(data);
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
