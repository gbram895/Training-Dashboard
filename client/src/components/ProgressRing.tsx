// Circular gradient progress ring — shared by the Dashboard hero (readiness)
// and, later, Goals cards. Percent is clamped so a bad input can't produce
// a negative dash-offset.
export default function ProgressRing({
  percent,
  size = 96,
  strokeWidth = 8,
  gradientId,
  children,
}: {
  percent: number;
  size?: number;
  strokeWidth?: number;
  gradientId: string;
  children?: React.ReactNode;
}) {
  const clamped = Math.max(0, Math.min(100, percent));
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - clamped / 100);
  const center = size / 2;

  return (
    <div className="gd-ring-wrap" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={center} cy={center} r={radius} fill="none" stroke="var(--surface-sunken)" strokeWidth={strokeWidth} />
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke={`url(#${gradientId})`}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
        />
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="var(--accent-a)" />
            <stop offset="1" stopColor="var(--accent-b)" />
          </linearGradient>
        </defs>
      </svg>
      <div className="gd-ring-center">{children}</div>
    </div>
  );
}
