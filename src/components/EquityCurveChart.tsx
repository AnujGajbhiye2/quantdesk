'use client';

import { useEffect, useRef } from 'react';
import {
  createChart,
  LineSeries,
  ColorType,
  type IChartApi,
  type ISeriesApi,
  type LineData,
} from 'lightweight-charts';
import Panel from './Panel';
import type { EquityPoint } from '@/core/backtest/engine';

interface Props {
  equityCurve: EquityPoint[];
}

export default function EquityCurveChart({ equityCurve }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef     = useRef<IChartApi | null>(null);
  const seriesRef    = useRef<ISeriesApi<'Line', string> | null>(null);

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
      timeScale: { borderColor: '#30363d' },
      rightPriceScale: { borderColor: '#30363d' },
      width:  el.clientWidth,
      height: el.clientHeight,
    });
    const series = chart.addSeries(LineSeries, {
      color:     '#e3b341',
      lineWidth: 1,
    });

    chartRef.current  = chart;
    seriesRef.current = series as ISeriesApi<'Line', string>;

    const ro = new ResizeObserver(() => {
      chart.applyOptions({ width: el.clientWidth, height: el.clientHeight });
    });
    ro.observe(el);

    return () => {
      ro.disconnect();
      chart.remove();
      chartRef.current  = null;
      seriesRef.current = null;
    };
  }, []);

  useEffect(() => {
    const series = seriesRef.current;
    const chart  = chartRef.current;
    if (!series || !chart) return;
    const data: LineData<string>[] = equityCurve.map((p) => ({ time: p.time, value: p.equity }));
    series.setData(data);
    chart.timeScale().fitContent();
  }, [equityCurve]);

  return (
    <Panel
      title="EQUITY CURVE"
      className="h-full"
      info="Portfolio value bar by bar through the backtest. Shape matters as much as the end point: smooth growth beats the same return with drawdowns you would never sit through."
    >
      <div ref={containerRef} style={{ width: '100%', height: '100%', minHeight: 180 }} />
    </Panel>
  );
}
