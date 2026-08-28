export default function BarScale({ value, max = 5 }: { value: number; max?: number }) {
  const bars = Array.from({ length: max }, (_, i) => i);
  return (
    <span className="bar-scale" role="img" aria-label={`${value} out of ${max}`}>
      {bars.map((i) => (
        <span
          key={i}
          className={`bar-scale-bar${i < value ? ' bar-scale-bar-filled' : ''}`}
          style={{ height: `${30 + (i / (max - 1)) * 70}%` }}
        />
      ))}
    </span>
  );
}
