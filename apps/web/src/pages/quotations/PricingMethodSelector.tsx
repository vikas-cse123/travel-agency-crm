import { normalizePricingMode, type PricingMode } from '@interscale/shared';

interface Option {
  value: PricingMode;
  title: string;
  desc: string;
}

const OPTIONS: readonly Option[] = [
  {
    value: 'SECTION_WISE',
    title: 'By Section',
    desc: 'Set and calculate a selling price for each service section individually.',
  },
  {
    value: 'PER_PERSON',
    title: 'By Traveler',
    desc: 'Build the itinerary and calculate the final package price per traveler.',
  },
];

const LABELS: Record<PricingMode, string> = {
  SECTION_WISE: 'By Section',
  PER_PERSON: 'By Traveler',
};

export interface PricingMethodSelectorProps {
  /** Stored pricing mode; normalized before use (legacy values read as By Traveler). */
  value: unknown;
  /** Commit the new mode — called only after the optional change confirmation. */
  onSelect: (mode: PricingMode) => void;
  /**
   * Resolve the authoritative grand total for a mode so a change that alters
   * the total can be confirmed first. Omit to switch with no warning.
   */
  resolveGrandTotal?: (mode: PricingMode) => number | null;
  /** Currency for the confirmation message amounts. */
  currency?: string;
  /** Disable the option cards (e.g. a finalized, immutable version). */
  disabled?: boolean;
  /** Optional heading. Pass null to render the options only. */
  title?: string | null;
}

/**
 * Pricing-method picker shared by the Quotation Builder metadata flow and the
 * Quotation Details page. Selecting a mode that changes the authoritative total
 * asks for confirmation first; all other switches apply immediately.
 */
export function PricingMethodSelector({
  value,
  onSelect,
  resolveGrandTotal,
  currency = 'INR',
  disabled = false,
  title = 'How would you like to price this quotation?',
}: PricingMethodSelectorProps) {
  const mode = normalizePricingMode(value);
  const fmt = (amount: number) => {
    try {
      return new Intl.NumberFormat(currency === 'INR' ? 'en-IN' : undefined, {
        style: 'currency',
        currency,
      }).format(amount);
    } catch {
      return `${currency} ${amount.toFixed(2)}`;
    }
  };
  const switchMode = (next: PricingMode) => {
    if (next === mode) return;
    if (resolveGrandTotal) {
      const fromTotal = resolveGrandTotal(mode);
      const toTotal = resolveGrandTotal(next);
      if (
        fromTotal != null &&
        toTotal != null &&
        fromTotal > 0 &&
        toTotal > 0 &&
        fromTotal !== toTotal
      ) {
        const ok = window.confirm(
          `Change pricing method? Your quotation currently uses ${LABELS[mode]} (${fmt(fromTotal)}). Switching to ${LABELS[next]} will change the authoritative total to ${fmt(toTotal)}. Existing values will be preserved where possible.`,
        );
        if (!ok) return;
      }
    }
    onSelect(next);
  };
  return (
    <div className="space-y-4">
      {title && (
        <div className="text-center">
          <h2 className="text-base font-semibold text-slate-900">{title}</h2>
        </div>
      )}
      <div className="grid gap-3 md:grid-cols-2">
        {OPTIONS.map(({ value: optionValue, title: optionTitle, desc }) => {
          const selected = mode === optionValue;
          return (
            <button
              key={optionValue}
              type="button"
              aria-pressed={selected}
              aria-label={optionTitle}
              disabled={disabled}
              onClick={() => switchMode(optionValue)}
              className={`text-left rounded-xl border-2 p-5 transition ${selected ? 'border-brand-600 bg-brand-50/60 shadow-sm' : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'} ${disabled ? 'cursor-not-allowed opacity-60' : ''}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p
                    className={`text-sm font-semibold ${selected ? 'text-brand-700' : 'text-slate-800'}`}
                  >
                    {optionTitle}
                  </p>
                  <p className="mt-1 text-xs leading-5 text-slate-600">{desc}</p>
                </div>
                <span
                  className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${selected ? 'border-brand-600 bg-brand-600 text-white' : 'border-slate-300 bg-white'}`}
                  aria-hidden="true"
                >
                  {selected ? '✓' : ''}
                </span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function pricingModeLabel(value: unknown): string {
  return LABELS[normalizePricingMode(value)];
}
