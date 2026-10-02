import { describe, expect, it } from 'vitest';
import {
  defaultFlightInclude,
  leadRequestedTabs,
  serviceTypeToTabKey,
} from './QuotationBuilderPage';

const leadWith = (...serviceTypes: string[]) => ({
  services: serviceTypes.map((serviceType) => ({ serviceType })),
});

describe('lead service mapping (canonical enum, no second convention)', () => {
  it('maps FLIGHT to the flight tab', () => {
    expect(serviceTypeToTabKey('FLIGHT')).toBe('flight');
    expect(leadRequestedTabs(leadWith('FLIGHT')).has('flight')).toBe(true);
  });

  it('does not map non-flight services to the flight tab', () => {
    const requested = leadRequestedTabs(
      leadWith('HOTEL', 'SIGHTSEEING', 'VEHICLE_TRANSFER', 'CRUISE'),
    );
    expect(requested.has('flight')).toBe(false);
  });
});

describe('defaultFlightInclude — initial "Include Flight in Quotation" state', () => {
  it('CASE 1 — lead without Flight opens a new quotation with Flight OFF', () => {
    expect(defaultFlightInclude(null, false)).toBe(false);
    expect(defaultFlightInclude(undefined, false)).toBe(false);
  });

  it('CASE 2 — lead with Flight opens a new quotation with Flight ON', () => {
    expect(defaultFlightInclude(null, true)).toBe(true);
    expect(defaultFlightInclude(undefined, true)).toBe(true);
  });

  it('CASE 3 — existing quotation with includeFlight=true stays ON', () => {
    // Saved value wins even if the lead no longer requests Flight.
    expect(defaultFlightInclude({ include: true }, false)).toBeNull();
    expect(defaultFlightInclude({ include: true }, true)).toBeNull();
  });

  it('CASE 4 — existing quotation with includeFlight=false stays OFF', () => {
    // Saved value wins even if the lead now requests Flight.
    expect(defaultFlightInclude({ include: false }, true)).toBeNull();
    expect(defaultFlightInclude({ include: false }, false)).toBeNull();
  });

  it('CASE 5 — manually enabled Flight survives a reopen', () => {
    // After the user checks the box and saves, the version carries
    // flightDetails with include=true, so reopening never resets it —
    // regardless of what the lead requests now.
    expect(defaultFlightInclude({ include: true }, false)).toBeNull();
  });

  it('CASE 6 — no Flight data is forced on: OFF means the section stays out', () => {
    // The builder hides the whole Flight section unless include is true and
    // pricing/PDF/booking conversion all gate on the same flag, so an OFF
    // initial state cannot populate flight content on its own.
    expect(defaultFlightInclude(null, false)).toBe(false);
  });
});
