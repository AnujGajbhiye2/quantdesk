'use client';

import { useEffect, useRef, type CSSProperties } from 'react';
import EmptyState from './EmptyState';
import {
  createChart,
  CandlestickSeries,
  LineSeries,
  ColorType,
  createSeriesMarkers,
  type IChartApi,
  type ISeriesApi,
  type SeriesOptionsMap,
  type LineData,
} from 'lightweight-charts';
import type { Bar } from '@/core/types';
import type { TradeRecord, EquityPoint } from '@/core/backtest/engine';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Props {
  bars:        Bar[];
  trades?:     TradeRecord[];
  equityCurve?: EquityPoint[];
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

export default function PriceChart({ bars, trades = [], equityCurve = [], className }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef     = useRef<IChartApi | null>(null);
  const candlesRef   = useRef<ISeriesApi<keyof SeriesOptionsMap, string> | null>(null);

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

    const ro = new ResizeObserver(() => {
      chart.applyOptions({ width: el.clientWidth, height: el.clientHeight });
    });
    ro.observe(el);

    return () => {
      ro.disconnect();
      chart.remove();
      chartRef.current   = null;
      candlesRef.current = null;
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

    // Entry/exit markers
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
      createSeriesMarkers(candles, markers);
    }

    // Equity curve as a second series (right price scale)
    if (equityCurve.length > 0) {
      const eqSeries = chart.addSeries(LineSeries, {
        color:     '#e3b341',
        lineWidth: 1,
        priceScaleId: 'equity',
      });
      chart.priceScale('equity').applyOptions({ visible: false });
      const eqData: LineData[] = equityCurve.map((p) => ({ time: p.time, value: p.equity }));
      eqSeries.setData(eqData);
    }

    chart.timeScale().fitContent();
  }, [bars, trades, equityCurve]);

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
