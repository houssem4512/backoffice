interface SparklineProps {
  points?: number[];
  color?: string;
  fill?: string;
  width?: number;
  height?: number;
}

/** Small inline SVG sparkline – mirrors the HTML reference's `.sparkline-svg` */
export function Sparkline({ points = [], color = '#4F46E5', fill = 'rgba(79,70,229,0.06)', width = 100, height = 28 }: SparklineProps) {
  const safe = points && points.length ? points : [0, 0, 0, 0, 0];
  const max = Math.max(...safe, 1);
  const min = Math.min(...safe, 0);
  const range = max - min || 1;
  const stepX = width / Math.max(safe.length - 1, 1);
  const coords = safe.map((v, i) => {
    const x = i * stepX;
    const y = height - ((v - min) / range) * (height - 4) - 2;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const polyPoints = coords.join(' ');
  const polyFill = `${polyPoints} ${width},${height} 0,${height}`;
  return (
    <svg className="sparkline-svg" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
      <polyline points={polyPoints} fill="none" stroke={color} strokeWidth="1.5" />
      <polygon points={polyFill} fill={fill} />
    </svg>
  );
}
