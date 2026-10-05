import { describe, expect, it } from 'vitest';
import {
  formatDayPrefixedTitle,
  formatItineraryDayTitle,
  stripItineraryDayPrefixes,
} from '@interscale/shared';
import {
  buildWhatsAppSummary,
  richHtmlToWhatsappMarkdown,
  whatsappMarkdownToHtml,
} from '@/features/quotations/whatsappSummary';
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

describe('formatDayPrefixedTitle — one preserve-or-prefix rule for Weblink and WhatsApp', () => {
  it('preserves stored DAY prefixes exactly, never duplicating', () => {
    expect(formatDayPrefixedTitle(1, 'DAY 1 | Universal studios')).toBe(
      'DAY 1 | Universal studios',
    );
    expect(formatDayPrefixedTitle(2, 'Day 2 | Langkawi Adventure')).toBe(
      'Day 2 | Langkawi Adventure',
    );
    expect(formatDayPrefixedTitle(4, 'DAY 4 Kuala Lumpur City Tour')).toBe(
      'DAY 4 Kuala Lumpur City Tour',
    );
    expect(formatDayPrefixedTitle(3, 'day 3 - City Tour')).toBe('day 3 - City Tour');
  });

  it('adds sequential `DAY N | Title` to bare titles', () => {
    expect(formatDayPrefixedTitle(1, 'Universal studios')).toBe('DAY 1 | Universal studios');
    expect(formatDayPrefixedTitle(2, 'Night Safari')).toBe('DAY 2 | Night Safari');
    expect(formatDayPrefixedTitle(6, 'Departure from Singapore')).toBe(
      'DAY 6 | Departure from Singapore',
    );
  });

  it('returns null for blank titles so callers can fall back', () => {
    expect(formatDayPrefixedTitle(1, null)).toBeNull();
    expect(formatDayPrefixedTitle(1, '   ')).toBeNull();
  });
});

describe('stripItineraryDayPrefixes', () => {  it('leaves dash-style stored titles untouched', () => {
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

  it('numbers bare sightseeing titles sequentially with `DAY N |` (CASE 1 + CASE 3)', () => {
    const bare = {
      sightseeingDetails: {
        include: true,
        days: [
          { dayNumber: 1, title: 'Universal studios', city: 'Singapore', activities: [] },
          { dayNumber: 2, title: 'Arrival', city: 'Singapore', activities: [] },
          { dayNumber: 3, title: 'City Tour', city: 'Singapore', activities: [] },
          { dayNumber: 4, title: 'Night Safari', city: 'Singapore', activities: [] },
        ],
      },
      hotels: [],
      includeVisa: false,
    } as unknown as QuotationVersion;
    const summary = buildWhatsAppSummary({
      quotation,
      version: bare,
      companyName: 'Test Travel',
      weblinkUrl: null,
    });
    expect(summary).toContain('DAY 1 | Universal studios');
    expect(summary).toContain('DAY 2 | Arrival');
    expect(summary).toContain('DAY 3 | City Tour');
    expect(summary).toContain('DAY 4 | Night Safari');
    expect(summary).not.toMatch(/DAY \d+ DAY \d+/);
  });

  it('preserves stored DAY prefixes and fills gaps sequentially (CASE 2 + CASE 4)', () => {
    const mixed = {
      sightseeingDetails: {
        include: true,
        days: [
          { dayNumber: 1, title: 'DAY 1 | Arrival in Singapore', city: 'Singapore', activities: [] },
          { dayNumber: 2, title: 'City Tour', city: 'Singapore', activities: [] },
          { dayNumber: 3, title: 'DAY 3 | Night Safari', city: 'Singapore', activities: [] },
        ],
      },
      hotels: [],
      includeVisa: false,
    } as unknown as QuotationVersion;
    const summary = buildWhatsAppSummary({
      quotation,
      version: mixed,
      companyName: 'Test Travel',
      weblinkUrl: null,
    });
    expect(summary).toContain('DAY 1 | Arrival in Singapore');
    expect(summary).toContain('DAY 2 | City Tour');
    expect(summary).toContain('DAY 3 | Night Safari');
    expect(summary).not.toMatch(/DAY \d+ DAY \d+/);
  });

  it('prefixes only the first line of a day, grouping same-day activities beneath it (CASE 1 + CASE 5)', () => {
    const withActivities = {
      sightseeingDetails: {
        include: true,
        days: [
          {
            dayNumber: 1,
            title: 'Arrival in Langkawi',
            city: 'Langkawi',
            activities: [
              { name: 'Night Safari', description: null },
              { name: 'Island Hopping', description: null },
            ],
          },
        ],
      },
      hotels: [],
      includeVisa: false,
    } as unknown as QuotationVersion;
    const summary = buildWhatsAppSummary({
      quotation,
      version: withActivities,
      companyName: 'Test Travel',
      weblinkUrl: null,
    });
    // First line carries the day; continuations render bare, never re-prefixed.
    expect(summary).toContain('DAY 1 | Arrival in Langkawi');
    expect(summary).toContain('Night Safari');
    expect(summary).toContain('Island Hopping');
    expect(summary).not.toContain('DAY 1 | Night Safari');
    expect(summary).not.toContain('DAY 1 | Island Hopping');
    expect(summary).not.toMatch(/DAY \d+ DAY \d+/);
  });

  it('restarts the prefix for each new day across multiple days (CASE 3)', () => {
    const twoDays = {
      sightseeingDetails: {
        include: true,
        days: [
          {
            dayNumber: 1,
            title: 'Arrival',
            city: 'Singapore',
            activities: [{ name: 'Night Safari', description: null }],
          },
          {
            dayNumber: 2,
            title: 'City Tour',
            city: 'Singapore',
            activities: [{ name: 'Shopping', description: null }],
          },
        ],
      },
      hotels: [],
      includeVisa: false,
    } as unknown as QuotationVersion;
    const summary = buildWhatsAppSummary({
      quotation,
      version: twoDays,
      companyName: 'Test Travel',
      weblinkUrl: null,
    });
    const lines = summary.split('\n');
    expect(lines).toContain('DAY 1 | Arrival');
    expect(lines).toContain('Night Safari');
    expect(lines).toContain('DAY 2 | City Tour');
    expect(lines).toContain('Shopping');
    // Order: day 1 group fully precedes the day 2 group.
    expect(lines.indexOf('DAY 1 | Arrival')).toBeLessThan(lines.indexOf('Night Safari'));
    expect(lines.indexOf('Night Safari')).toBeLessThan(lines.indexOf('DAY 2 | City Tour'));
    expect(summary).not.toContain('DAY 1 | Night Safari');
    expect(summary).not.toContain('DAY 2 | Shopping');
  });

  it('renders continuations flush-left with no indentation anywhere', () => {
    const summary = buildWhatsAppSummary({
      quotation,
      version: {
        sightseeingDetails: {
          include: true,
          days: [
            {
              dayNumber: 1,
              title: null,
              city: 'Singapore',
              activities: [
                { name: 'Night safari', description: null },
                { name: 'Universal studios', description: null },
                { name: 'Sentosa Island Tour', description: null },
              ],
            },
            {
              dayNumber: 2,
              title: null,
              city: 'Singapore',
              activities: [{ name: 'Singapore City Tour', description: null }],
            },
          ],
        },
        hotels: [],
        includeVisa: false,
      } as unknown as QuotationVersion,
      companyName: 'Test Travel',
      weblinkUrl: null,
    });
    const lines = summary.split('\n');
    // Canonical text: every line starts at the same left position.
    expect(lines).toContain('DAY 1 | Night safari');
    expect(lines).toContain('Universal studios');
    expect(lines).toContain('Sentosa Island Tour');
    expect(lines).toContain('DAY 2 | Singapore City Tour');
    expect(lines.some((line) => /^[ \t]/.test(line) && line.trim())).toBe(false);

    // Preview/modal HTML carries no indent hooks or whitespace tricks.
    const html = whatsappMarkdownToHtml(summary);
    expect(html).toContain('DAY 1 | Night safari');
    expect(html).not.toContain('same-day-continuation');
    expect(html).not.toMatch(/<p[^>]*>\s+Universal studios/);

    // Copied text is equally flush-left.
    const copied = richHtmlToWhatsappMarkdown(html);
    const copiedLines = copied.split('\n');
    expect(copiedLines).toContain('DAY 1 | Night safari');
    expect(copiedLines).toContain('Universal studios');
    expect(copiedLines).toContain('Sentosa Island Tour');
    expect(copiedLines).toContain('DAY 2 | Singapore City Tour');
    expect(copiedLines.some((line) => /^[ \t]/.test(line) && line.trim())).toBe(false);
  });

  it('groups under a preserved prefix without duplicating it (CASE 4 + CASE 6)', () => {    const prefixed = {
      sightseeingDetails: {
        include: true,
        days: [
          {
            dayNumber: 1,
            title: 'DAY 1 | Arrival',
            city: 'Singapore',
            activities: [{ name: 'Night Safari', description: null }],
          },
        ],
      },
      hotels: [],
      includeVisa: false,
    } as unknown as QuotationVersion;
    const summary = buildWhatsAppSummary({
      quotation,
      version: prefixed,
      companyName: 'Test Travel',
      weblinkUrl: null,
    });
    expect(summary).toContain('DAY 1 | Arrival');
    expect(summary).toContain('Night Safari');
    expect(summary).not.toContain('DAY 1 | DAY 1 | Arrival');
    expect(summary).not.toContain('DAY 1 | Night Safari');
  });

  it('emits a lone activity exactly once with its day prefix (CASE 1)', () => {
    const summary = buildWhatsAppSummary({
      quotation,
      version: {
        sightseeingDetails: {
          include: true,
          days: [
            {
              dayNumber: 1,
              title: null,
              city: 'Singapore',
              activities: [{ name: 'Night Safari', description: null }],
            },
          ],
        },
        hotels: [],
        includeVisa: false,
      } as unknown as QuotationVersion,
      companyName: 'Test Travel',
      weblinkUrl: null,
    });
    const lines = summary.split('\n');
    expect(lines.filter((line) => line === 'DAY 1 | Night Safari')).toHaveLength(1);
    expect(lines.filter((line) => line === 'Night Safari')).toHaveLength(0);
  });

  it('emits the first of two same-day activities once, then the second bare (CASE 2)', () => {
    const summary = buildWhatsAppSummary({
      quotation,
      version: {
        sightseeingDetails: {
          include: true,
          days: [
            {
              dayNumber: 1,
              title: null,
              city: 'Singapore',
              activities: [
                { name: 'Night Safari', description: null },
                { name: 'Universal Studios', description: null },
              ],
            },
          ],
        },
        hotels: [],
        includeVisa: false,
      } as unknown as QuotationVersion,
      companyName: 'Test Travel',
      weblinkUrl: null,
    });
    const lines = summary.split('\n');
    expect(lines).toContain('DAY 1 | Night Safari');
    expect(lines).toContain('Universal Studios');
    expect(lines.filter((line) => line === 'Night Safari')).toHaveLength(0);
    expect(lines.filter((line) => line === 'DAY 1 | Night Safari')).toHaveLength(1);
  });

  it('emits every activity exactly once across multiple days (CASE 3 + CASE 5)', () => {
    const summary = buildWhatsAppSummary({
      quotation,
      version: {
        sightseeingDetails: {
          include: true,
          days: [
            {
              dayNumber: 1,
              title: 'Arrival in Singapore',
              city: 'Singapore',
              activities: [
                { name: 'Night Safari', description: null },
                { name: 'Universal Studios', description: null },
              ],
            },
            {
              dayNumber: 2,
              title: 'Singapore City Tour',
              city: 'Singapore',
              activities: [{ name: 'Shopping', description: null }],
            },
          ],
        },
        hotels: [],
        includeVisa: false,
      } as unknown as QuotationVersion,
      companyName: 'Test Travel',
      weblinkUrl: null,
    });
    const lines = summary.split('\n');
    for (const expected of [
      'DAY 1 | Arrival in Singapore',
      'Night Safari',
      'Universal Studios',
      'DAY 2 | Singapore City Tour',
      'Shopping',
    ]) {
      expect(lines.filter((line) => line === expected)).toHaveLength(1);
    }
    expect(summary).not.toMatch(/DAY \d+ DAY \d+/);
  });

  it('drops the activity line duplicating a stored day title (CASE 4)', () => {
    const summary = buildWhatsAppSummary({
      quotation,
      version: {
        sightseeingDetails: {
          include: true,
          days: [
            {
              dayNumber: 1,
              title: 'DAY 1 | Night Safari',
              city: 'Singapore',
              activities: [{ name: 'Night Safari', description: null }],
            },
          ],
        },
        hotels: [],
        includeVisa: false,
      } as unknown as QuotationVersion,
      companyName: 'Test Travel',
      weblinkUrl: null,
    });
    const lines = summary.split('\n');
    expect(lines.filter((line) => line === 'DAY 1 | Night Safari')).toHaveLength(1);
    expect(lines.filter((line) => line === 'Night Safari')).toHaveLength(0);
  });
});
