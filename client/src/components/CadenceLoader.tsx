import { useId } from 'react';

// Widths in px; the height follows the mark's 28:16 viewBox. The viewBox is
// padded by 2 units on each side so the 2.6-wide round caps at the first and
// last point aren't clipped.
const WIDTHS = { sm: 42, md: 84, lg: 200 } as const;

export type CadenceLoaderSize = keyof typeof WIDTHS;

const POINTS = '1,11 6,3 10,8 14,1 18,5 22,2';

/**
 * The wordmark's cadence line, reused as the app's loader: a cyan-to-teal
 * pulse travels the mark's own path over a hairline track. Same geometry and
 * stops as Wordmark, so the two always agree.
 *
 * `label` renders an uppercase mono caption next to the mark; without one the
 * loader is announced through its aria-label and stays visually silent.
 */
export default function CadenceLoader({
  size = 'md',
  label,
  className,
}: {
  size?: CadenceLoaderSize;
  label?: string;
  className?: string;
}) {
  // One gradient per instance: two <defs> sharing an id would leave every
  // loader on the page pointing at whichever one mounted first.
  const gradientId = useId();
  const width = WIDTHS[size];

  return (
    <span
      className={`gd-cadence${className ? ` ${className}` : ''}`}
      role="status"
      aria-label={label ?? 'Loading'}
    >
      <svg
        width={width}
        height={Math.round((width * 16) / 28)}
        viewBox="-2 -2 28 16"
        aria-hidden="true"
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="1" x2="1" y2="0">
            <stop offset="0" stopColor="#4fb6e8" />
            <stop offset="1" stopColor="#4fd8a0" />
          </linearGradient>
        </defs>
        <polyline
          className="gd-cadence-track"
          points={POINTS}
          fill="none"
          strokeWidth="2.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <polyline
          className="gd-cadence-pulse"
          points={POINTS}
          fill="none"
          stroke={`url(#${gradientId})`}
          strokeWidth="2.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      {label ? <span className="gd-cadence-label mono">{label}</span> : null}
    </span>
  );
}
