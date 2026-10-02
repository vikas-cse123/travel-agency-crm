import { describe, expect, it } from 'vitest';
import {
  formatItineraryDayTitle,
  stripItineraryDayPrefixes,
} from '@interscale/shared';
import { buildWhatsAppSummary } from '@/features/quotations/whatsappSummary';
import type {
  Quotation,
  QuotationVersion,
} from '@/features/quotations/quotations.api';

describe('formatItineraryDayTitle — stored titles render verbatim', () => {
  it('keeps "Day 3 - Hanoi …" exactly, at any position', () => {
    expect(formatItineraryDayTitle(3, 'Day 3 - Hanoi – Da Nang | Leisure Day')).toBe(
      'Day 3 - Hanoi – Da Nang | Leisure Day',
    );
    // Even at a different position the stored title is not rebuilt.
    expect(formatItineraryDayTitle(5, 'Day 3 - Hanoi – Da Nang | Leisure Day')).toBe(
      'Day 3 - Hanoi – Da Nang | Leisure Day',
    );
  });

  it('keeps "Day 4 - Sentosa …" exactly', () => {
    expect(
      formatItineraryDayTitle(
        4,
        'Day 4 - Sentosa Island – Cable Car, Madame Tussauds & Wings of Time',
      ),
    ).toBe('Day 4 - Sentosa Island – Cable Car, Madame Tussauds & Wings of Time');
  });

  it('returns prefix-less titles verbatim without adding a separator', () => {
    expect(formatItineraryDayTitle(1, 'Night safari')).toBe('Night safari');
    expect(formatItineraryDayTitle(5, 'Hanoi')).toBe('Hanoi');
    expect(formatItineraryDayTitle(6, 'Departure from Singapore')).toBe(
      'Departure from Singapore',
    );
    expect(formatItineraryDayTitle(2, null)).toBe('Day 2');
    expect(formatItineraryDayTitle(2, '   ')).toBe('Day 2');
  });

  it('leaves colon-style titles untouched instead of normalizing the separator', () => {
    expect(formatItineraryDayTitle(6, 'Day 6: Departure from Singapore')).toBe(
      'Day 6: Departure from Singapore',
    );
    expect(formatItineraryDayTitle(5, 'Day 4: Marina Bay')).toBe('Day 4: Marina Bay');
  });

  it('preserves legitimate colons inside dash-prefixed titles', () => {
    expect(formatItineraryDayTitle(3, 'Day 3 - Hanoi: City Tour')).toBe(
      'Day 3 - Hanoi: City Tour',
    );
  });

  it('treats en/em dashes as stored content too', () => {
    expect(formatItineraryDayTitle(3, 'Day 3 – Hanoi | Leisure Day')).toBe(
      'Day 3 – Hanoi | Leisure Day',
    );
    expect(formatItineraryDayTitle(3, 'Day 3 — Hanoi | Leisure Day')).toBe(
      'Day 3 — Hanoi | Leisure Day',
    );
    expect(stripItineraryDayPrefixes('Day 3 – Hanoi | Leisure Day')).toBe(
      'Day 3 – Hanoi | Leisure Day',
    );
  });

  it('never renumbers stale prefixes', () => {
    expect(formatItineraryDayTitle(4, 'Day 3: Singapore City Tour')).toBe(
      'Day 3: Singapore City Tour',
    );
  });
});

describe('stripItineraryDayPrefixes', () => {
  it('leaves dash-style stored titles untouched', () => {
    expect(stripItineraryDayPrefixes('Day 3 - Hanoi – Da Nang | Leisure Day')).toBe(
      'Day 3 - Hanoi – Da Nang | Leisure Day',
    );
  });

  it('still strips stacked colon prefixes and bare day numbers', () => {
    expect(stripItineraryDayPrefixes('Day 5: Day 4: Day 3: Singapore City Tour')).toBe(
      'Singapore City Tour',
    );
    expect(stripItineraryDayPrefixes('Day 3 Hanoi Tour')).toBe('Hanoi Tour');
  });
});

describe('buildWhatsAppSummary — sightseeing day titles', () => {
  const version = {
    sightseeingDetails: {
      include: true,
      days: [
        {
          dayNumber: 3,
          title: 'Day 3 - Hanoi – Da Nang | Leisure Day',
          city: 'Hanoi',
          activities: [],
        },
        {
          dayNumber: 1,
          title: 'Day 1: Night safari',
          city: 'Singapore',
          activities: [{ name: 'Night safari', description: null }],
        },
      ],
    },
    hotels: [],
    includeVisa: false,
  } as unknown as QuotationVersion;
  const quotation = {
    adults: 2,
    childrenWithBed: 0,
    childrenWithoutBed: 0,
    infants: 0,
  } as Quotation;

  it('renders the stored dash title verbatim without injecting a colon', () => {
    const summary = buildWhatsAppSummary({
      quotation,
      version,
      companyName: 'Test Travel',
      weblinkUrl: null,
    });
    expect(summary).toContain('Day 3 - Hanoi – Da Nang | Leisure Day');
    expect(summary).not.toContain('Day 3: -');
  });

  it('renders plain activity names verbatim', () => {
    const summary = buildWhatsAppSummary({
      quotation,
      version,
      companyName: 'Test Travel',
      weblinkUrl: null,
    });
    expect(summary).toContain('Night safari');
    expect(summary).not.toContain('Day 1: Day 1');
  });

  it('uses the plain title without a separator in the summary', () => {
    const plain = {
      sightseeingDetails: {
        include: true,
        days: [
          {
            dayNumber: 6,
            title: 'Departure from Singapore',
            city: 'Singapore',
            activities: [],
          },
        ],
      },
      hotels: [],
      includeVisa: false,
    } as unknown as QuotationVersion;
    const summary = buildWhatsAppSummary({
      quotation,
      version: plain,
      companyName: 'Test Travel',
      weblinkUrl: null,
    });
    expect(summary).toContain('Departure from Singapore');
    expect(summary).not.toContain('Day 6 - Departure from Singapore');
    expect(summary).not.toContain('Day 6: Departure from Singapore');
  });

  it('never appends the city to an activity name with a separator', () => {
    const withCity = {
      sightseeingDetails: {
        include: true,
        days: [
          {
            dayNumber: 1,
            title: null,
            city: 'Singapore',
            activities: [{ name: 'Night Safari', city: 'Singapore', description: null }],
          },
        ],
      },
      hotels: [],
      includeVisa: false,
    } as unknown as QuotationVersion;
    const summary = buildWhatsAppSummary({
      quotation,
      version: withCity,
      companyName: 'Test Travel',
      weblinkUrl: null,
    });
    expect(summary).toContain('Night Safari');
    expect(summary).not.toContain('Night Safari - Singapore');
  });
});
