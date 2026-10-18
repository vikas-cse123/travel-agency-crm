/**
 * Two related repairs for quotations created from a lead that carried only a
 * Master Destination (the Create Lead form no longer collects a city):
 *
 * 1. The legacy day-wise itinerary is no longer edited in the builder, but the
 *    quotation schema still requires a non-empty `title` and `destination` on
 *    every row, so a blank row makes every save fail with `itinerary.N.title` /
 *    `itinerary.N.destination` validation errors.
 * 2. The version's `destinationSummary` is optional, but older quotations can
 *    store an empty value; deriving it from the lead's own destination keeps
 *    the saved summary meaningful without ever blocking a save when it is empty.
 *
 * The lead stores the Master Destination in `country` and an optional city in
 * `destination`. Both helpers derive values from those existing lead fields
 * only — they never invent names and never overwrite a non-empty value.
 */

type RepairableRow = {
  title?: string | null;
  destination?: string | null;
  overnightLocation?: string | null;
};

type LeadStay = {
  country?: string | null;
  destination?: string | null;
} | null | undefined;

const trimmed = (value: string | null | undefined): string => (value ?? '').trim();

export const repairLegacyItinerary = <T extends RepairableRow>(
  rows: T[],
  stays: LeadStay[] = [],
): T[] =>
  rows.map((row, index) => {
    const stay = stays[index];
    const place = trimmed(row.destination) || trimmed(stay?.destination) || trimmed(stay?.country);
    if (!place) return row;
    return {
      ...row,
      title: trimmed(row.title) || place,
      destination: trimmed(row.destination) || place,
      overnightLocation: trimmed(row.overnightLocation) || place,
    } as T;
  });

/**
 * Derives a non-empty destination summary for a quotation whose stored version
 * summary is blank. Prefers the quotation-level summary (the value captured when
 * the quotation was created) and otherwise joins each lead stay's city — or its
 * Master Destination when the city is blank — in sequence. Returns an empty
 * string only when there is genuinely no destination to derive (never invents a
 * placeholder), leaving a truly dataless quotation for the operator to fill in.
 */
export const deriveDestinationSummary = (
  quotationSummary: string | null | undefined,
  stays: LeadStay[] = [],
): string => {
  const saved = trimmed(quotationSummary);
  if (saved) return saved;
  return stays
    .map((stay) => trimmed(stay?.destination) || trimmed(stay?.country))
    .filter((part) => part.length > 0)
    .join(' • ');
};

