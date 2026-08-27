export type HrvStatus = 'balanced' | 'unbalanced' | 'low';

export function classifyHrv(value: number, baseline: number): HrvStatus {
  if (baseline <= 0) return 'balanced';
  const ratio = value / baseline;
  if (ratio >= 0.9) return 'balanced';
  if (ratio >= 0.8) return 'unbalanced';
  return 'low';
}

export const HRV_STATUS_COLOR: Record<HrvStatus, string> = {
  balanced: 'var(--chart-sleep)',
  unbalanced: 'var(--chart-hrv)',
  low: 'var(--chart-heart-rate)',
};

export function rollingAverage(values: (number | null)[], window: number): (number | null)[] {
  const result: (number | null)[] = [];
  for (let i = 0; i < values.length; i++) {
    const start = Math.max(0, i - window + 1);
    const slice = values.slice(start, i + 1).filter((v): v is number => v != null);
    result.push(slice.length ? slice.reduce((a, b) => a + b, 0) / slice.length : null);
  }
  return result;
}

export function average(values: (number | null | undefined)[]): number | null {
  const nums = values.filter((v): v is number => v != null);
  return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null;
}
