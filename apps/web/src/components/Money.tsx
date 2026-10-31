import { formatMoney } from '../lib/format';

/** Amounts in a column use the mono outlier face with tabular figures. */
export function Money({ value, className = '' }: { value: number; className?: string }) {
  return <span className={`fig ${className}`}>{formatMoney(value)}</span>;
}
