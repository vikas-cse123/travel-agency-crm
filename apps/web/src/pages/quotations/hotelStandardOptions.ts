import type { MasterOption } from '@/components/ui/MasterSelect';

/**
 * Standard room types always offered in the Hotel subtab's Room Type picker.
 * They augment whatever the linked Hotel Master provides and never replace it.
 */
export const STANDARD_ROOM_TYPES = [
  'Standard Room',
  'Superior Room',
  'Deluxe Room',
  'Premium Room',
  'Executive Room',
  'Junior Suite Room',
  'Suite Room',
] as const;

/** Standard meal plans always offered in the Hotel subtab's Meal Plan picker. */
export const STANDARD_MEAL_PLANS = [
  'Breakfast',
  'Breakfast (Veg)',
  'Breakfast + Dinner',
  'Breakfast + Dinner (Veg)',
] as const;

const normalize = (value: string) => value.trim().toLowerCase();

/**
 * Appends the standard suggestions that the Hotel Master does not already
 * provide.
 *
 * Master entries are kept first and unchanged — they retain their real id so a
 * pick still links the quotation to the master (and its pricing). A standard
 * label already present in the master list is skipped, so a value never appears
 * twice. The synthetic ids never collide with master UUIDs; the caller treats
 * any option whose id is not a known master as free text.
 */
export function withStandardOptions(
  masterOptions: MasterOption[],
  standardLabels: readonly string[],
  idPrefix: string,
): MasterOption[] {
  const existing = new Set(masterOptions.map((option) => normalize(option.label)));
  const additions = standardLabels
    .filter((label) => {
      const key = normalize(label);
      if (existing.has(key)) return false;
      existing.add(key);
      return true;
    })
    .map((label) => ({ id: `${idPrefix}:${label}`, label }));
  return [...masterOptions, ...additions];
}
