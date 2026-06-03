'use client';

interface SparklineProps {
  data:    number[];   // closes, oldest first; must be >= 2
  width?:  number;
  height?: number;
  className?: string;
}

/**
 * Lightweight inline SVG sparkline.
 * Colour is determined by first vs last value.
 * Does not require any chart library.
 */
export default function Sparkline({ data, width = 80, height = 24, className }: SparklineProps) {
  const valid = data.filter(isFinite);
  if (valid.length < 2) {
    return <svg width={width} height={height} className={className} />;
  }

  const min = Math.min(...valid);
  const max = Math.max(...valid);
  const range = max - min || 1;

  const pts = valid.map((v, i) => {
    const x = (i / (valid.length - 1)) * width;
    const y = height - ((v - min) / range) * height;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  const up    = valid[valid.length - 1] >= valid[0];
  const color = up ? 'var(--color-up)' : 'var(--color-down)';

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className={className}
      style={{ display: 'block' }}
    >
      <polyline
        points={pts.join(' ')}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}
