export default function BarScale({ value, max = 5 }: { value: number; max?: number }) {
  const bars = Array.from({ length: max }, (_, i) => i);
  return (
    <span className="bar-scale" role="img" aria-label={`${value} out of ${max}`}>
      {bars.map((i) => (
        <span
          key={i}
          className="bar-scale-bar"
          style={{
            height: `${((i + 1) / max) * 100}%`,
            background: i < value ? 'var(--text)' : 'var(--border)',
          }}
        />
      ))}
    </span>
  );
}
