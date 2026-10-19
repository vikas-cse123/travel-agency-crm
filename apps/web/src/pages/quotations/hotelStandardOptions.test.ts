import { describe, expect, it } from 'vitest';
import {
  STANDARD_MEAL_PLANS,
  STANDARD_ROOM_TYPES,
  withStandardOptions,
} from './hotelStandardOptions';

describe('withStandardOptions', () => {
  it('adds every standard room type when the master has none', () => {
    const result = withStandardOptions([], STANDARD_ROOM_TYPES, 'standard-room-type');
    expect(result.map((option) => option.label)).toEqual([...STANDARD_ROOM_TYPES]);
  });

  it('keeps master options first and appends only the missing standard room types', () => {
    const master = [
      { id: 'room-1', label: 'Deluxe Room' },
      { id: 'room-2', label: 'Suite Room' },
    ];
    const result = withStandardOptions(master, STANDARD_ROOM_TYPES, 'standard-room-type');

    // Master entries survive with their real ids.
    expect(result[0]).toEqual({ id: 'room-1', label: 'Deluxe Room' });
    expect(result[1]).toEqual({ id: 'room-2', label: 'Suite Room' });

    const labels = result.map((option) => option.label);
    // No duplicate for master-provided standard names.
    expect(labels.filter((label) => label === 'Deluxe Room')).toHaveLength(1);
    expect(labels.filter((label) => label === 'Suite Room')).toHaveLength(1);
    // Every remaining standard option is present.
    for (const label of STANDARD_ROOM_TYPES) {
      expect(labels).toContain(label);
    }
    // Synthetic options never collide with master ids.
    const synthetic = result.filter((option) => option.id.startsWith('standard-room-type:'));
    expect(synthetic).toHaveLength(STANDARD_ROOM_TYPES.length - 2);
  });

  it('deduplicates against master names case-insensitively and trimmed', () => {
    const master = [{ id: 'room-1', label: '  deluxe ROOM ' }];
    const result = withStandardOptions(master, STANDARD_ROOM_TYPES, 'standard-room-type');
    expect(result.filter((option) => option.label.trim().toLowerCase() === 'deluxe room')).toHaveLength(1);
  });

  it('retains custom master options that are not standard suggestions', () => {
    const master = [{ id: 'room-1', label: 'Super Deluxe Valley View' }];
    const result = withStandardOptions(master, STANDARD_ROOM_TYPES, 'standard-room-type');
    expect(result[0]).toEqual({ id: 'room-1', label: 'Super Deluxe Valley View' });
  });

  it('adds every standard meal plan when the master has none', () => {
    const result = withStandardOptions([], STANDARD_MEAL_PLANS, 'standard-meal-plan');
    expect(result.map((option) => option.label)).toEqual([...STANDARD_MEAL_PLANS]);
  });

  it('keeps the master meal plan and adds the missing standard plans', () => {
    const master = [{ id: 'meal-1', label: 'Breakfast', hint: 'BREAKFAST' }];
    const result = withStandardOptions(master, STANDARD_MEAL_PLANS, 'standard-meal-plan');
    expect(result[0]).toEqual({ id: 'meal-1', label: 'Breakfast', hint: 'BREAKFAST' });
    const labels = result.map((option) => option.label);
    expect(labels.filter((label) => label === 'Breakfast')).toHaveLength(1);
    for (const label of STANDARD_MEAL_PLANS) {
      expect(labels).toContain(label);
    }
  });
});
