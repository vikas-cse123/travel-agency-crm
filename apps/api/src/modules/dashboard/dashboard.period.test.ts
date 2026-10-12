import { describe, expect, it } from 'vitest';
import { createdAtFilter, resolvePeriod } from './dashboard.period.js';

// Asia/Kolkata is UTC+5:30 year-round (no DST); America/New_York is UTC-5
// (EST) across January/February 2026, so every expectation below is exact.
const KOLKATA = 'Asia/Kolkata';
const NEW_YORK = 'America/New_York';

// Monday 2026-10-12 10:00Z == 15:30 IST == 06:00 EDT.
const MONDAY = new Date('2026-10-12T10:00:00Z');
// Wednesday 2026-10-14 10:00Z.
const WEDNESDAY = new Date('2026-10-14T10:00:00Z');

describe('resolvePeriod boundaries', () => {
  it('resolves THIS_YEAR from Jan 1 local midnight through end of today', () => {
    const resolved = resolvePeriod('THIS_YEAR', KOLKATA, undefined, undefined, MONDAY);
    expect(resolved.from!.toISOString()).toBe('2025-12-31T18:30:00.000Z');
    expect(resolved.to!.toISOString()).toBe('2026-10-12T18:30:00.000Z');
  });

  it('resolves TODAY to the local day bounds', () => {
    const resolved = resolvePeriod('TODAY', KOLKATA, undefined, undefined, MONDAY);
    expect(resolved.from!.toISOString()).toBe('2026-10-11T18:30:00.000Z');
    expect(resolved.to!.toISOString()).toBe('2026-10-12T18:30:00.000Z');
  });

  it('resolves THIS_WEEK from Monday local midnight, even mid-week', () => {
    const monday = resolvePeriod('THIS_WEEK', KOLKATA, undefined, undefined, MONDAY);
    expect(monday.from!.toISOString()).toBe('2026-10-11T18:30:00.000Z');
    const wednesday = resolvePeriod('THIS_WEEK', KOLKATA, undefined, undefined, WEDNESDAY);
    expect(wednesday.from!.toISOString()).toBe('2026-10-11T18:30:00.000Z');
    expect(wednesday.to!.toISOString()).toBe('2026-10-14T18:30:00.000Z');
  });

  it('resolves THIS_MONTH and THIS_QUARTER from the first local midnight', () => {
    const month = resolvePeriod('THIS_MONTH', KOLKATA, undefined, undefined, MONDAY);
    expect(month.from!.toISOString()).toBe('2026-09-30T18:30:00.000Z');
    // August sits in Q3, which starts July 1.
    const quarter = resolvePeriod(
      'THIS_QUARTER',
      KOLKATA,
      undefined,
      undefined,
      new Date('2026-08-20T10:00:00Z'),
    );
    expect(quarter.from!.toISOString()).toBe('2026-06-30T18:30:00.000Z');
  });

  it('covers exactly 30 and 90 calendar days for the trailing periods', () => {
    const thirty = resolvePeriod('LAST_30_DAYS', KOLKATA, undefined, undefined, MONDAY);
    expect(thirty.from!.toISOString()).toBe('2026-09-12T18:30:00.000Z');
    expect(thirty.to!.toISOString()).toBe('2026-10-12T18:30:00.000Z');
    const ninety = resolvePeriod('LAST_90_DAYS', KOLKATA, undefined, undefined, MONDAY);
    expect(ninety.from!.toISOString()).toBe('2026-07-14T18:30:00.000Z');
    expect(ninety.to!.toISOString()).toBe('2026-10-12T18:30:00.000Z');
  });

  it('returns no date predicate for ALL_TIME', () => {
    const resolved = resolvePeriod('ALL_TIME', KOLKATA, undefined, undefined, MONDAY);
    expect(resolved.from).toBeNull();
    expect(resolved.to).toBeNull();
    expect(createdAtFilter(resolved)).toEqual({});
  });

  it('builds a half-open [gte, lt) filter so the start is inclusive and the end exclusive', () => {
    const resolved = resolvePeriod('TODAY', KOLKATA, undefined, undefined, MONDAY);
    const filter = createdAtFilter(resolved);
    expect(filter.createdAt?.gte).toEqual(resolved.from);
    expect(filter.createdAt?.lt).toEqual(resolved.to);
  });
});

describe('resolvePeriod CUSTOM calendar semantics', () => {
  it('keeps Asia/Kolkata behavior identical (inclusive end date)', () => {
    const resolved = resolvePeriod(
      'CUSTOM',
      KOLKATA,
      new Date('2026-01-01'),
      new Date('2026-01-31'),
    );
    expect(resolved.from!.toISOString()).toBe('2025-12-31T18:30:00.000Z');
    // End of January 31, i.e. start of February 1 local time.
    expect(resolved.to!.toISOString()).toBe('2026-01-31T18:30:00.000Z');
  });

  it('reads date-only inputs as calendar dates behind UTC instead of shifting a day', () => {
    // '2026-01-01' parses to 00:00 UTC, which is still Dec 31 on the New York
    // wall clock. The selected calendar day is January 1 either way.
    const resolved = resolvePeriod(
      'CUSTOM',
      NEW_YORK,
      new Date('2026-01-01'),
      new Date('2026-01-31'),
    );
    expect(resolved.from!.toISOString()).toBe('2026-01-01T05:00:00.000Z');
    expect(resolved.to!.toISOString()).toBe('2026-02-01T05:00:00.000Z');
  });

  it('rejects missing or reversed custom ranges', () => {
    expect(() => resolvePeriod('CUSTOM', KOLKATA, undefined, new Date('2026-01-31'))).toThrow(
      /both from and to/,
    );
    expect(() => resolvePeriod('CUSTOM', KOLKATA, new Date('2026-01-01'))).toThrow(
      /both from and to/,
    );
    expect(() =>
      resolvePeriod('CUSTOM', KOLKATA, new Date('2026-02-01'), new Date('2026-01-01')),
    ).toThrow(/on or before the end date/);
  });
});
