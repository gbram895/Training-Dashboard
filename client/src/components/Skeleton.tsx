import type { CSSProperties } from 'react';

/**
 * One shimmering placeholder block. Sizes are given per use rather than as
 * variants, since a skeleton only reads as the real thing when it matches the
 * width and height of the text or tile it stands in for.
 */
export default function Skeleton({
  w,
  h = 12,
  r = 100,
  className,
  style,
}: {
  w?: number | string;
  h?: number | string;
  r?: number;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <span
      className={`gd-skeleton${className ? ` ${className}` : ''}`}
      style={{ width: w, height: h, borderRadius: r, ...style }}
      aria-hidden="true"
    />
  );
}
