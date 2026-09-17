import { describe, expect, it } from 'vitest';
import {
  buildVehiclePrefillRows,
  mapMasterToVehicleRow,
  matchVehiclesForDestination,
  shouldAutoPrefillVehicles,
  type PrefillVehicleMaster,
} from './QuotationBuilderPage';

function master(
  id: string,
  name: string,
  destinationIds: string[],
  overrides: Partial<PrefillVehicleMaster> = {},
): PrefillVehicleMaster {
  return {
    id,
    name,
    status: 'ACTIVE',
    vehicleType: 'SUV',
    description: `${name} description`,
    price: 7000,
    images: [],
    destinations: destinationIds.map((destinationId) => ({ id: destinationId, name: destinationId })),
    ...overrides,
  };
}

const KASHMIR = 'dest-kashmir';
const DELHI = 'dest-delhi';
const AGRA = 'dest-agra';
const MANALI = 'dest-manali';

const innova = () => master('v-innova', 'Toyota Innova', [KASHMIR, DELHI, AGRA]);
const tempo = () => master('v-tempo', 'Tempo Traveller', [KASHMIR, MANALI]);
const ertiga = () => master('v-ertiga', 'Ertiga', [KASHMIR]);

describe('matchVehiclesForDestination', () => {
  it('returns [] for empty input or unknown destinations', () => {
    expect(matchVehiclesForDestination('', [innova()])).toEqual([]);
    expect(matchVehiclesForDestination('dest-nowhere', [innova()])).toEqual([]);
    expect(matchVehiclesForDestination(KASHMIR, [])).toEqual([]);
  });

  it('matches by stable destination ID, sorted by name', () => {
    const matched = matchVehiclesForDestination(KASHMIR, [tempo(), ertiga(), innova()]);
    expect(matched.map((m) => m.name)).toEqual(['Ertiga', 'Tempo Traveller', 'Toyota Innova']);
  });

  it('11. ignores inactive vehicles and vehicles of other destinations', () => {
    const masters = [
      innova(),
      master('v-old', 'Old Van', [KASHMIR], { status: 'INACTIVE' }),
      master('v-cab', 'Delhi Cab', [DELHI]),
    ];
    expect(matchVehiclesForDestination(KASHMIR, masters).map((m) => m.id)).toEqual(['v-innova']);
  });
});

describe('shouldAutoPrefillVehicles', () => {
  it('15/16. prefills only when no vehicle rows are saved yet', () => {
    expect(shouldAutoPrefillVehicles(0)).toBe(true);
    expect(shouldAutoPrefillVehicles(1)).toBe(false);
    expect(shouldAutoPrefillVehicles(4)).toBe(false);
  });
});

describe('mapMasterToVehicleRow', () => {
  it('maps exactly like a manual master selection', () => {
    const row = mapMasterToVehicleRow(innova(), 2);
    expect(row.serviceType).toBe('VEHICLE_TRANSFER');
    expect(row.sequence).toBe(2);
    expect(row.vehicleId).toBe('v-innova');
    expect(row.name).toBe('Toyota Innova');
    expect(row.city).toBe('SUV');
    expect(row.description).toBe('Toyota Innova description');
    expect(row.sellingPrice).toBe(7000);
  });

  it('leaves sellingPrice at the empty-row default when the master has no price', () => {
    const row = mapMasterToVehicleRow(master('v-x', 'X', [KASHMIR], { price: null }), 1);
    expect(row.sellingPrice).toBe(0);
  });
});

describe('buildVehiclePrefillRows', () => {
  it('8. prefills the single matching vehicle', () => {
    const rows = buildVehiclePrefillRows([DELHI], [innova(), ertiga()], 1, new Set());
    expect(rows.map((r) => r.name)).toEqual(['Toyota Innova']);
    expect(rows[0]?.sequence).toBe(1);
  });

  it('9/10. prefills ALL matching vehicles (3, and 10)', () => {
    const three = buildVehiclePrefillRows([KASHMIR], [innova(), tempo(), ertiga()], 1, new Set());
    expect(three.map((r) => r.name)).toEqual(['Ertiga', 'Tempo Traveller', 'Toyota Innova']);
    expect(three.map((r) => r.sequence)).toEqual([1, 2, 3]);

    const ten = Array.from({ length: 10 }, (_, i) =>
      master(`v-${i + 1}`, `Van ${String(i + 1).padStart(2, '0')}`, [KASHMIR]),
    );
    const rows = buildVehiclePrefillRows([KASHMIR], ten, 5, new Set());
    expect(rows).toHaveLength(10);
    expect(new Set(rows.map((r) => r.vehicleId)).size).toBe(10);
    expect(rows.map((r) => r.sequence)).toEqual([5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
  });

  it('12. one vehicle assigned to several destinations matches each independently', () => {
    const masters = [innova(), tempo()];
    expect(buildVehiclePrefillRows([KASHMIR], masters, 1, new Set()).map((r) => r.vehicleId).sort())
      .toEqual(['v-innova', 'v-tempo']);
    expect(buildVehiclePrefillRows([DELHI], masters, 1, new Set()).map((r) => r.vehicleId))
      .toEqual(['v-innova']);
    expect(buildVehiclePrefillRows([AGRA], masters, 1, new Set()).map((r) => r.vehicleId))
      .toEqual(['v-innova']);
    expect(buildVehiclePrefillRows([MANALI], masters, 1, new Set()).map((r) => r.vehicleId))
      .toEqual(['v-tempo']);
  });

  it('4-style. Kashmir + Delhi + Agra + Manali each receive only their own vehicles', () => {
    const masters = [innova(), tempo(), master('v-cab', 'Delhi Cab', [DELHI])];
    const rows = buildVehiclePrefillRows([KASHMIR, DELHI, AGRA, MANALI], masters, 1, new Set());
    const byVehicle = new Map(rows.map((r) => [r.vehicleId, r]));
    expect(rows).toHaveLength(3);
    expect([...byVehicle.keys()].sort()).toEqual(['v-cab', 'v-innova', 'v-tempo']);
  });

  it('13/17. never duplicates: already-present vehicles are skipped per destination batch', () => {
    const masters = [innova(), tempo(), ertiga()];
    const first = buildVehiclePrefillRows([KASHMIR], masters, 1, new Set());
    expect(first).toHaveLength(3);
    // Second pass (reopen/retry/re-select) with the same present IDs adds nothing.
    const present = new Set(first.map((r) => r.vehicleId as string));
    expect(buildVehiclePrefillRows([KASHMIR], masters, 4, present)).toEqual([]);
    // 18. adding Delhi afterwards loads only Delhi's missing vehicle.
    const delhiCab = master('v-cab', 'Delhi Cab', [DELHI]);
    const second = buildVehiclePrefillRows([KASHMIR, DELHI], [...masters, delhiCab], 4, present);
    expect(second.map((r) => r.vehicleId)).toEqual(['v-cab']);
  });

  it('14. output rows are decoupled from masters (removal cannot unassign masters)', () => {
    const masters = [innova(), tempo()];
    const rows = buildVehiclePrefillRows([KASHMIR], masters, 1, new Set());
    rows.splice(0, 1);
    rows[0]!.name = 'Edited by salesperson';
    expect(masters).toHaveLength(2);
    expect(masters[0]?.name).toBe('Toyota Innova');
    expect(masters[0]?.destinations).toHaveLength(3);
  });

  it('returns [] for no destinations', () => {
    expect(buildVehiclePrefillRows([], [innova()], 1, new Set())).toEqual([]);
  });
});
