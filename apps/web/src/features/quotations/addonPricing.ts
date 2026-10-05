import type { AddOnServicePricingEntry } from '@/features/masters/masters.api';

/** Loose shape accepted from masters, snapshots and legacy synthesis. */
export interface AddOnPricingEntryInput {
  id?: string | undefined;
  label?: string | null | undefined;
  price?: number | null | undefined;
  currency?: string | null | undefined;
}

export interface AddOnPricingSource {
  id: string;
  pricing?: AddOnPricingEntryInput[] | null | undefined;
  price?: number | null | undefined;
  currency?: string | null | undefined;
  pricingBasis?: string | null | undefined;
}

/**
 * Every pricing option of an add-on master, in saved order. The repeatable
 * `pricing` list wins; a legacy single price/basis becomes one entry so older
 * masters keep working and nothing is silently discarded.
 */
export function normalizeAddonPricingSnapshot(
  master: AddOnPricingSource,
): AddOnServicePricingEntry[] {
  // Every row is preserved: entries missing a stable id get one assigned so
  // no pricing option is ever silently discarded.
  const entries = (master.pricing ?? [])
    .filter((entry) => entry != null)
    .map((entry) => ({
      id:
        typeof entry.id === 'string' && entry.id !== '' ? entry.id : crypto.randomUUID(),
      label: entry.label ?? '',
      price: entry.price ?? null,
      currency: entry.currency ?? 'INR',
    }));
  if (entries.length > 0) return entries;
  if (master.price == null && (master.pricingBasis ?? '').trim() === '') return [];
  return [
    {
      id: `legacy-${master.id}`,
      label: (master.pricingBasis ?? '').trim(),
      price: master.price != null ? Number(master.price) : null,
      currency: master.currency ?? 'INR',
    },
  ];
}

/** Compact "Label ₹X" text for one pricing option (read-only displays). */
export function formatAddonPricingOption(
  entry: AddOnPricingEntryInput,
  fallbackCurrency = 'INR',
): string {
  const label = (entry.label ?? '').trim() || 'Standard';
  if (entry.price == null) return label;
  const code = ((entry.currency ?? fallbackCurrency) || fallbackCurrency).toUpperCase();
  try {
    return `${label} ${new Intl.NumberFormat(code === 'INR' ? 'en-IN' : undefined, {
      style: 'currency',
      currency: code,
      maximumFractionDigits: 0,
    }).format(Number(entry.price))}`;
  } catch {
    return `${label} ${code} ${entry.price}`;
  }
}

/** Per-entry currency amount for customer-facing renderers. */
export function formatAddonOptionPrice(
  entry: AddOnPricingEntryInput,
  fallbackCurrency = 'INR',
): string | null {
  if (entry.price == null) return null;
  const code = ((entry.currency ?? fallbackCurrency) || fallbackCurrency).toUpperCase();
  try {
    return new Intl.NumberFormat(code === 'INR' ? 'en-IN' : undefined, {
      style: 'currency',
      currency: code,
      maximumFractionDigits: 0,
    }).format(Number(entry.price));
  } catch {
    return `${code} ${entry.price}`;
  }
}
