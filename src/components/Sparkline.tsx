// tiny inline svg sparkline showing score history over time
// no chart lib needed, just a <polyline>

// props for the sparkline
interface Props {
  // values in chronological order (oldest first)
  values: number[];
  // color name for the line, passes through to svg stroke
  color: string;
  width?: number;
  height?: number;
}

export function Sparkline({ values, color, width = 120, height = 28 }: Props) {
  // need at least two points to draw a line
  if (values.length < 2) {
    return <div style={{ width, height }} aria-hidden />;
  }

  // pad the drawable area a little so the stroke doesn't clip
  const pad = 2;
  const w = width - pad * 2;
  const h = height - pad * 2;

  // scores are always 0..100 so we can scale directly
  const minY = 0;
  const maxY = 100;
  const range = maxY - minY || 1;

  // map each value to an x,y point in the svg
  const step = w / (values.length - 1);
  const points = values
    .map((v, i) => {
      const x = pad + i * step;
      const y = pad + h - ((v - minY) / range) * h;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  // last point gets a filled dot so the most recent value is easy to spot
  const lastX = pad + (values.length - 1) * step;
  const lastY = pad + h - ((values[values.length - 1] - minY) / range) * h;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label="score trend"
    >
      {/* the trend line itself */}
      <polyline
        fill="none"
        stroke={color}
        strokeWidth="1.8"
        strokeLinejoin="round"
        strokeLinecap="round"
        points={points}
        opacity="0.85"
      />
      {/* dot on the latest value */}
      <circle cx={lastX} cy={lastY} r="2.4" fill={color} />
    </svg>
  );
}
