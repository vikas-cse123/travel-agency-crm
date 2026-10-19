import type { MasterOption } from '@/components/ui/MasterSelect';
import { withStandardOptions } from './hotelStandardOptions';

/**
 * Standard cabin types always offered in the Cruise subtab's Room Type picker.
 * They augment whatever the linked Cruise Master provides and never replace it.
 */
export const STANDARD_CRUISE_CABINS = [
  'Interior Cabin',
  'Ocean View Cabin',
  'Balcony Cabin',
  'Mini Suite',
  'Suite',
  'Family Cabin',
  'Grand Suite',
  'Penthouse Suite',
] as const;

/**
 * Appends the standard cabin types that the Cruise Master does not already
 * provide, reusing the shared merge (master entries first with their real ids,
 * duplicates skipped case-insensitively and trimmed).
 */
export function withStandardCabinOptions(masterOptions: MasterOption[]): MasterOption[] {
  return withStandardOptions(masterOptions, STANDARD_CRUISE_CABINS, 'standard-cruise-cabin');
}
