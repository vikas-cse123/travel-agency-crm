import { escapeHtml } from './HotelBookingEmail';

export interface TravellerNameEntry {
  label: string;
  name: string;
}

/** Raw name lists as stored on leads and quotations (positional, blanks kept). */
export interface TravellerNameSource {
  adultNames?: unknown;
  childWithBedNames?: unknown;
  childWithoutBedNames?: unknown;
  infantNames?: unknown;
}

const CATEGORIES = [
  { key: 'adultNames', singular: 'Adult' },
  { key: 'childWithBedNames', singular: 'Child With Bed' },
  { key: 'childWithoutBedNames', singular: 'Child Without Bed' },
  { key: 'infantNames', singular: 'Infant' },
] as const;

/**
 * Labeled traveller entries from one source, in passenger order. Blank
 * entries are omitted so they never render as fake names or empty rows.
 */
export function travellerNameEntries(source: TravellerNameSource | null | undefined): TravellerNameEntry[] {
  if (!source) return [];
  const entries: TravellerNameEntry[] = [];
  for (const category of CATEGORIES) {
    const list = source[category.key];
    if (!Array.isArray(list)) continue;
    list.forEach((value, index) => {
      const name = typeof value === 'string' ? value.trim() : '';
      if (name) entries.push({ label: `${category.singular} ${index + 1}`, name });
    });
  }
  return entries;
}

/**
 * Resolve the names for an email draft.
 *
 * Precedence is explicit: the selected quotation's own lists win whenever
 * they hold at least one name. The linked lead is only a fallback for
 * quotations saved before names existed (or with all names blank) — lead
 * data is never merged into, and never overwrites, quotation-specific
 * values. Returns null when neither source has a name.
 */
export function resolveTravellerNames(
  quotation: TravellerNameSource | null | undefined,
  lead: TravellerNameSource | null | undefined,
): { entries: TravellerNameEntry[]; source: 'quotation' | 'lead' | null } {
  const fromQuotation = travellerNameEntries(quotation);
  if (fromQuotation.length > 0) return { entries: fromQuotation, source: 'quotation' };
  const fromLead = travellerNameEntries(lead);
  if (fromLead.length > 0) return { entries: fromLead, source: 'lead' };
  return { entries: [], source: null };
}

/** Rendered list items for an email body (`<li>` strings, values escaped). */
export function travellerNameItems(entries: TravellerNameEntry[]): string[] {
  return entries.map((entry) => `<li>${escapeHtml(entry.label)}: ${escapeHtml(entry.name)}</li>`);
}
