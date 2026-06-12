'use client';

import { useEffect, useRef, type CSSProperties } from 'react';
import EmptyState from './EmptyState';
import {
  createChart,
  CandlestickSeries,
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

interface Props {
  bars:        Bar[];
  trades?:     TradeRecord[];
  /** Horizontal reference lines for the current trade idea. */
  entryPrice?:  number;
  stopPrice?:   number;
  targetPrice?: number;
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
  className,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef     = useRef<IChartApi | null>(null);
  const candlesRef   = useRef<ISeriesApi<keyof SeriesOptionsMap, string> | null>(null);
  const markersRef   = useRef<ISeriesMarkersPluginApi<string> | null>(null);
  const priceLinesRef = useRef<IPriceLine[]>([]);

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
    };
  }, []);

  // Update data when bars/trades change
  useEffect(() => {
    const candles = candlesRef.current;
    const chart   = chartRef.current;
    if (!candles || !chart) return;

    const candleData: CandleData[] = bars.map((b) => ({
      time:  b.time,
      open:  b.open,
      high:  b.high,
      low:   b.low,
      close: b.close,
    }));
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
          time:     t.entryTime,
          position: t.side === 'long' ? 'belowBar' : 'aboveBar',
          color:    t.side === 'long' ? '#26a641' : '#f85149',
          shape:    t.side === 'long' ? 'arrowUp' : 'arrowDown',
          text:     `${t.side === 'long' ? 'L' : 'S'} ${t.entryReason ?? ''}`.trim(),
        },
        {
          time:     t.exitTime,
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
