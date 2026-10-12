import { colorAt } from './palette';
import type { BarDatum } from './HorizontalBarChart';

/**
 * Accessible vertical bar chart. Bars grow upward from a shared baseline with
 * the formatted value above each bar and the label below, so the chart reads
 * correctly without relying on bar heights alone. Follows the same
 * data/empty-state conventions as HorizontalBarChart.
 */
export function VerticalBarChart({
  data,
  formatValue = (value: number) => String(value),
}: {
  data: BarDatum[];
  formatValue?: (value: number) => string;
}) {
  if (!data.length) return <p className="text-xs text-slate-400">No data</p>;
  const max = Math.max(...data.map((row) => row.value), 1);
  return (
    <div className="overflow-x-auto">
      <div
        className="flex min-w-full items-end justify-around gap-3 px-2"
        role="img"
        aria-label={data.map((row) => `${row.label}: ${formatValue(row.value)}`).join(', ')}
      >
        {data.map((row, index) => (
          // Rows can legitimately share a display label (e.g. same-named
          // destinations in different countries), so the index keeps keys
          // unique. Order is stable (backend sorts descending), and labels,
          // values and grouping are untouched.
          <div key={`${row.label}-${index}`} className="flex w-20 shrink-0 flex-col items-center">
            <span className="mb-1 text-center text-xs font-medium text-slate-900">
              {formatValue(row.value)}
            </span>
            <div
              className="w-10 rounded-t-md"
              style={{
                height: `${Math.max(6, (row.value / max) * 160)}px`,
                backgroundColor: colorAt(index),
              }}
            />
            <span
              className="mt-1 w-full truncate text-center text-xs text-slate-700"
              title={row.label}
            >
              {row.label}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
