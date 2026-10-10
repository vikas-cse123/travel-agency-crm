import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@/test/utils';
import { UpcomingTravelCard } from './UpcomingTravelCard';

const auth = vi.hoisted(() => ({ permissions: new Set<string>() }));
vi.mock('@/features/auth/AuthProvider', () => ({
  useAuth: () => ({ hasPermission: (key: string) => auth.permissions.has(key) }),
}));

const response = (data: unknown) =>
  ({ ok: true, status: 200, json: async () => ({ success: true, data }) }) as Response;

const row = (overrides: Record<string, unknown> = {}) => ({
  id: `row-${Math.random().toString(36).slice(2)}`,
  customerName: 'Traveller',
  travelDate: '2026-11-10T00:00:00.000Z',
  destination: 'Goa',
  leadStage: 'BOOKING_CONFIRMED',
  ...overrides,
});

const payload = (confirmed: unknown[] = [], others: unknown[] = []) => ({
  confirmed: { totalCount: confirmed.length, items: confirmed },
  others: { totalCount: others.length, items: others },
});

const renderCard = (kind: 'confirmed' | 'others') =>
  renderWithProviders(<UpcomingTravelCard kind={kind} />, { route: '/dashboard' });

const headerLabels = (headingName: string): string[] => {
  const heading = screen.getByRole('heading', { name: headingName });
  const section = heading.closest('section')!;
  return Array.from(section.querySelectorAll('thead th')).map(
    (cell) => cell.textContent?.trim() ?? '',
  );
};

const bodyRows = (headingName: string): HTMLElement[] => {
  const heading = screen.getByRole('heading', { name: headingName });
  const section = heading.closest('section')!;
  return Array.from(section.querySelectorAll('tbody tr'));
};

beforeEach(() => {
  vi.unstubAllGlobals();
  auth.permissions = new Set(['dashboard.view', 'queries.view']);
});

describe('UpcomingTravelCard — all future travel, no filters', () => {
  it('renders no date-range dropdown in either section', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response(payload())));
    renderCard('confirmed');
    await screen.findByRole('heading', { name: 'Upcoming Travel' });
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.queryByText('Next 30 Days')).not.toBeInTheDocument();
  });

  it('renders no View more link in either section', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response(payload([row()]))));
    renderCard('confirmed');
    await screen.findByText('Traveller');
    expect(screen.queryByRole('link', { name: /view more/i })).not.toBeInTheDocument();
  });

  it('has No. as the first column and numbers each table independently', async () => {
    const confirmedRows = [
      row({ id: 'c-1', customerName: 'Confirmed One' }),
      row({ id: 'c-2', customerName: 'Confirmed Two' }),
    ];
    const otherRows = [row({ id: 'o-1', customerName: 'Other One', leadStage: 'QUALIFIED' })];
    vi.stubGlobal('fetch', vi.fn(async () => response(payload(confirmedRows, otherRows))));
    renderCard('confirmed');
    expect(await screen.findByText('Confirmed One')).toBeInTheDocument();
    expect(headerLabels('Upcoming Travel')[0]).toBe('No.');
    const rows = bodyRows('Upcoming Travel');
    expect(rows).toHaveLength(2);
    expect(rows[0]?.querySelectorAll('td')[0]?.textContent).toBe('1');
    expect(rows[1]?.querySelectorAll('td')[0]?.textContent).toBe('2');
  });

  it('numbers the Other table from 1 as well', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        response(
          payload(
            [row({ id: 'c-1', customerName: 'Confirmed One' })],
            [
              row({ id: 'o-1', customerName: 'Other One', leadStage: 'QUALIFIED' }),
              row({ id: 'o-2', customerName: 'Other Two', leadStage: 'NEW_LEAD' }),
            ],
          ),
        ),
      ),
    );
    renderCard('others');
    expect(await screen.findByText('Other One')).toBeInTheDocument();
    expect(headerLabels('Other Upcoming Travel')[0]).toBe('No.');
    const rows = bodyRows('Other Upcoming Travel');
    expect(rows).toHaveLength(2);
    expect(rows[0]?.querySelectorAll('td')[0]?.textContent).toBe('1');
    expect(rows[1]?.querySelectorAll('td')[0]?.textContent).toBe('2');
  });

  it('shows Destination (not City), including multi-word names and —', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        response(
          payload([
            row({ id: 'c-1', customerName: 'Cruise Guest', destination: 'Singapore Cruise' }),
            row({ id: 'c-2', customerName: 'Bare Guest', destination: '—' }),
          ]),
        ),
      ),
    );
    renderCard('confirmed');
    await screen.findByText('Cruise Guest');
    expect(headerLabels('Upcoming Travel')).toEqual(['No.', 'Date', 'Name', 'Destination']);
    expect(screen.queryByText('City')).not.toBeInTheDocument();
    expect(screen.getByText('Singapore Cruise')).toBeInTheDocument();
    const rows = bodyRows('Upcoming Travel');
    expect(rows[1]?.querySelectorAll('td')[3]?.textContent).toBe('—');
  });

  it('links each lead name to its existing lead-detail page', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response(payload([row({ id: 'lead-9', customerName: 'Linked Guest' })]))),
    );
    renderCard('confirmed');
    const link = await screen.findByRole('link', { name: 'Linked Guest' });
    expect(link).toHaveAttribute('href', '/queries/lead-9');
    expect(link.className).toMatch(/hover:underline/);
  });

  it('shows a Stage column in Other Upcoming Travel only', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        response(
          payload(
            [row({ id: 'c-1', customerName: 'Confirmed Guest', leadStage: 'BOOKING_CONFIRMED' })],
            [row({ id: 'o-1', customerName: 'Other Guest', leadStage: 'QUALIFIED' })],
          ),
        ),
      ),
    );
    renderCard('confirmed');
    await screen.findByText('Confirmed Guest');
    expect(headerLabels('Upcoming Travel')).toEqual(['No.', 'Date', 'Name', 'Destination']);
    expect(screen.queryByText('Stage')).not.toBeInTheDocument();
  });

  it('displays the current lead stage in the Other table', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        response(
          payload([], [row({ id: 'o-1', customerName: 'Other Guest', leadStage: 'QUALIFIED' })]),
        ),
      ),
    );
    renderCard('others');
    await screen.findByText('Other Guest');
    expect(headerLabels('Other Upcoming Travel')).toEqual([
      'No.',
      'Date',
      'Name',
      'Destination',
      'Stage',
    ]);
    const rows = bodyRows('Other Upcoming Travel');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.querySelectorAll('td')[4]?.textContent).toBe('Qualified');
  });

  it('includes travel 45 days and several months out', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        response(
          payload([
            row({ id: 'r-45', customerName: 'Month Traveller' }),
            row({ id: 'r-200', customerName: 'Far Traveller' }),
          ]),
        ),
      ),
    );
    renderCard('confirmed');
    expect(await screen.findByText('Month Traveller')).toBeInTheDocument();
    expect(screen.getByText('Far Traveller')).toBeInTheDocument();
    expect(screen.getByText('2 upcoming trips')).toBeInTheDocument();
  });

  it('shows BOOKING_CONFIRMED leads only in Upcoming Travel', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        response(
          payload(
            [row({ id: 'c-1', customerName: 'Confirmed Guest', leadStage: 'BOOKING_CONFIRMED' })],
            [row({ id: 'o-1', customerName: 'Other Guest', leadStage: 'QUALIFIED' })],
          ),
        ),
      ),
    );
    renderCard('confirmed');
    expect(await screen.findByText('Confirmed Guest')).toBeInTheDocument();
    expect(screen.queryByText('Other Guest')).not.toBeInTheDocument();
  });

  it('shows other stages only in Other Upcoming Travel', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        response(
          payload(
            [row({ id: 'c-1', customerName: 'Confirmed Guest', leadStage: 'BOOKING_CONFIRMED' })],
            [row({ id: 'o-1', customerName: 'Other Guest', leadStage: 'QUALIFIED' })],
          ),
        ),
      ),
    );
    renderCard('others');
    expect(await screen.findByText('Other Guest')).toBeInTheDocument();
    expect(screen.queryByText('Confirmed Guest')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Other Upcoming Travel' })).toBeInTheDocument();
  });

  it('renders every matching record with a count reflecting the full set', async () => {
    const rows = Array.from({ length: 12 }, (_, index) =>
      row({ id: `r-${index}`, customerName: `Guest ${index}` }),
    );
    vi.stubGlobal('fetch', vi.fn(async () => response(payload(rows))));
    renderCard('confirmed');
    for (let index = 0; index < 12; index += 1) {
      expect(await screen.findByText(`Guest ${index}`)).toBeInTheDocument();
    }
    expect(screen.getByText('12 upcoming trips')).toBeInTheDocument();
  });

  it('shows an empty state without period wording', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response(payload())));
    renderCard('others');
    expect(await screen.findByText('No upcoming travel.')).toBeInTheDocument();
    expect(screen.queryByText(/in this period/i)).not.toBeInTheDocument();
    expect(screen.getByText('0 upcoming trips')).toBeInTheDocument();
  });
});
