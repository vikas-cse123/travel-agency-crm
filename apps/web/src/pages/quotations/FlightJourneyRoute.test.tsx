import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useForm, type UseFormReturn } from 'react-hook-form';
import { renderWithProviders } from '@/test/utils';
import { flightDetailsSchema, type QuotationVersionInput } from '@interscale/shared';
import { FlightRecordCard } from './FlightRecordCard';
import { emptySegment, hydrateFlightRecord } from './QuotationBuilderPage';
import { FlightJourneyView, journeyRoute } from './FlightPublicView';

const auth = vi.hoisted(() => ({ permissions: new Set<string>() }));
vi.mock('@/features/auth/AuthProvider', () => ({
  useAuth: () => ({ hasPermission: (key: string) => auth.permissions.has(key) }),
}));

const segment = (from: string | null, to: string | null): never =>
  ({
    ...emptySegment(),
    from,
    to,
    flightNumber: 'AI101',
    airlineName: 'Air India',
    departureTime: '10:00',
  }) as never;

const blankDefaults = () => ({
  outbound: { fromCity: null, toCity: null, routeFrom: null, routeTo: null, travelClass: 'Economy', segments: [] as never[] },
  returnJourney: { fromCity: null, toCity: null, routeFrom: null, routeTo: null, travelClass: 'Economy', segments: [] as never[] },
});

let capturedForm: UseFormReturn<QuotationVersionInput> | null = null;

function renderCard(flight: unknown) {
  function Harness() {
    const form = useForm({ defaultValues: { flightDetails: { flights: [flight] } } });
    capturedForm = form as unknown as UseFormReturn<QuotationVersionInput>;
    return (
      <FlightRecordCard
        flightIndex={0}
        form={form as never}
        airlineList={[]}
        onLoadBookmarks={vi.fn()}
        onRemoveFlight={vi.fn()}
      />
    );
  }
  renderWithProviders(<Harness />);
}

const headerText = (title: 'Outbound Journey' | 'Return Journey') => {
  const header = screen
    .getByRole('button', { name: `Edit ${title} route` })
    .closest('div[role="button"]') as HTMLElement;
  return header.textContent ?? '';
};

describe('Independent journey header routes', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.stubGlobal('scrollTo', vi.fn());
    auth.permissions = new Set(['quotations.view', 'quotations.update', 'quotations.view_costing']);
    capturedForm = null;
  });

  it('initializes the outbound route from the initial endpoints', () => {
    const hydrated = hydrateFlightRecord(
      {
        bookmarkCode: null,
        journeyType: 'ROUND_TRIP',
        outbound: { fromCity: 'Delhi', toCity: 'Singapore', segments: [segment('Delhi', 'Singapore')] },
        returnJourney: { fromCity: 'Singapore', toCity: 'Delhi', segments: [segment('Singapore', 'Delhi')] },
      },
      blankDefaults() as never,
    );
    expect(hydrated.outbound.routeFrom).toBe('Delhi');
    expect(hydrated.outbound.routeTo).toBe('Singapore');
  });

  it('initializes the return route in the reverse direction', () => {
    const hydrated = hydrateFlightRecord(
      {
        bookmarkCode: null,
        journeyType: 'ROUND_TRIP',
        outbound: { fromCity: 'Delhi', toCity: 'Singapore', segments: [segment('Delhi', 'Singapore')] },
        returnJourney: { fromCity: 'Singapore', toCity: 'Delhi', segments: [segment('Singapore', 'Delhi')] },
      },
      blankDefaults() as never,
    );
    expect(hydrated.returnJourney.routeFrom).toBe('Singapore');
    expect(hydrated.returnJourney.routeTo).toBe('Delhi');
  });

  it('preserves a previously saved custom route through hydration', () => {
    const hydrated = hydrateFlightRecord(
      {
        bookmarkCode: null,
        journeyType: 'ROUND_TRIP',
        outbound: {
          fromCity: 'Delhi',
          toCity: 'Singapore',
          routeFrom: 'New Delhi',
          routeTo: 'Changi Airport',
          segments: [segment('Delhi', 'Singapore')],
        },
        returnJourney: { fromCity: 'Singapore', toCity: 'Delhi', segments: [segment('Singapore', 'Delhi')] },
      },
      blankDefaults() as never,
    );
    expect(hydrated.outbound.routeFrom).toBe('New Delhi');
    expect(hydrated.outbound.routeTo).toBe('Changi Airport');
    // Re-hydrating the saved record is idempotent.
    const reopened = hydrateFlightRecord(
      JSON.parse(JSON.stringify(hydrated)) as never,
      blankDefaults() as never,
    );
    expect(reopened.outbound.routeFrom).toBe('New Delhi');
    expect(reopened.outbound.routeTo).toBe('Changi Airport');
  });

  it('loads legacy quotations without route values safely via endpoint fallback', () => {
    expect(journeyRoute({ fromCity: 'Delhi', toCity: 'Singapore' })).toBe('Delhi → Singapore');
    expect(journeyRoute({ routeFrom: null, routeTo: null, fromCity: 'Delhi', toCity: 'Singapore' })).toBe(
      'Delhi → Singapore',
    );
    expect(journeyRoute({})).toBe('');
    renderCard({
      bookmarkCode: null,
      journeyType: 'ROUND_TRIP',
      outbound: {
        fromCity: 'Delhi',
        toCity: 'Singapore',
        travelClass: 'Economy',
        segments: [segment('Delhi', 'Singapore')],
      },
      returnJourney: {
        fromCity: 'Singapore',
        toCity: 'Delhi',
        travelClass: 'Economy',
        segments: [segment('Singapore', 'Delhi')],
      },
    });
    expect(headerText('Outbound Journey')).toContain('Delhi → Singapore');
    expect(headerText('Return Journey')).toContain('Singapore → Delhi');
  });

  it('prefers the independent route over the endpoints once configured', () => {
    expect(
      journeyRoute({ routeFrom: 'New Delhi', routeTo: 'Changi Airport', fromCity: 'Delhi', toCity: 'Singapore' }),
    ).toBe('New Delhi → Changi Airport');
  });

  it('keeps the shared validation schema accepting and preserving route values', () => {
    const parsed = flightDetailsSchema.safeParse({
      include: true,
      outbound: { segments: [] },
      returnJourney: { segments: [] },
      flights: [
        {
          bookmarkCode: null,
          journeyType: 'ROUND_TRIP',
          outbound: {
            fromCity: 'Delhi',
            toCity: 'Singapore',
            routeFrom: 'New Delhi',
            routeTo: 'Changi Airport',
            segments: [],
          },
          returnJourney: {
            fromCity: 'Singapore',
            toCity: 'Delhi',
            routeFrom: 'Changi Airport',
            routeTo: 'New Delhi',
            segments: [],
          },
        },
      ],
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.flights[0]?.outbound.routeFrom).toBe('New Delhi');
      expect(parsed.data.flights[0]?.outbound.routeTo).toBe('Changi Airport');
      expect(parsed.data.flights[0]?.returnJourney.routeFrom).toBe('Changi Airport');
    }
  });

  it('renders the custom header route in the public view while segments keep their own values', () => {
    renderWithProviders(
      <FlightJourneyView
        title="Outbound Journey"
        color="#2563eb"
        journey={{
          fromCity: 'Delhi',
          toCity: 'Singapore',
          routeFrom: 'New Delhi',
          routeTo: 'Changi Airport',
          segments: [segment('Delhi', 'Singapore')],
        }}
      />,
    );
    expect(screen.getByText('New Delhi → Changi Airport')).toBeInTheDocument();
    expect(screen.getByText('Delhi')).toBeInTheDocument();
    expect(screen.getByText('Singapore')).toBeInTheDocument();
  });

  it('switching between one-way and round-trip preserves both journey labels', async () => {
    renderCard({
      bookmarkCode: null,
      journeyType: 'ROUND_TRIP',
      outbound: {
        fromCity: 'Delhi',
        toCity: 'Singapore',
        routeFrom: 'New Delhi',
        routeTo: 'Changi Airport',
        travelClass: 'Economy',
        segments: [segment('Delhi', 'Singapore')],
      },
      returnJourney: {
        fromCity: 'Singapore',
        toCity: 'Delhi',
        routeFrom: 'Changi Airport',
        routeTo: 'New Delhi',
        travelClass: 'Economy',
        segments: [segment('Singapore', 'Delhi')],
      },
    });
    expect(headerText('Outbound Journey')).toContain('New Delhi → Changi Airport');
    const journeyType = screen.getByLabelText('Journey type for flight 1') as HTMLSelectElement;
    await userEvent.selectOptions(journeyType, 'ONEWAY_OUTBOUND');
    expect(headerText('Outbound Journey')).toContain('New Delhi → Changi Airport');
    expect(screen.queryByRole('button', { name: 'Edit Return Journey route' })).not.toBeInTheDocument();
    await userEvent.selectOptions(journeyType, 'ROUND_TRIP');
    expect(headerText('Outbound Journey')).toContain('New Delhi → Changi Airport');
    expect(headerText('Return Journey')).toContain('Changi Airport → New Delhi');
    expect(capturedForm?.getValues('flightDetails.flights.0.outbound.segments.0.from')).toBe('Delhi');
    expect(capturedForm?.getValues('flightDetails.flights.0.returnJourney.segments.0.to')).toBe('Delhi');
  });

  it('editing one header never touches the other journey or any segment', async () => {
    renderCard({
      bookmarkCode: null,
      journeyType: 'ROUND_TRIP',
      outbound: {
        fromCity: 'Delhi',
        toCity: 'Singapore',
        routeFrom: 'Delhi',
        routeTo: 'Singapore',
        travelClass: 'Economy',
        segments: [segment('Delhi', 'Kuala Lumpur'), segment('Kuala Lumpur', 'Singapore')],
      },
      returnJourney: {
        fromCity: 'Singapore',
        toCity: 'Delhi',
        routeFrom: 'Singapore',
        routeTo: 'Delhi',
        travelClass: 'Economy',
        segments: [segment('Singapore', 'Delhi')],
      },
    });
    await userEvent.click(screen.getByRole('button', { name: 'Edit Outbound Journey route' }));
    const destination = screen.getByLabelText('Flight 1 Outbound Journey destination') as HTMLInputElement;
    await userEvent.clear(destination);
    await userEvent.type(destination, 'Changi Airport');
    await userEvent.keyboard('{Enter}');

    expect(headerText('Outbound Journey')).toContain('Delhi → Changi Airport');
    expect(headerText('Return Journey')).toContain('Singapore → Delhi');
    const card = within(screen.getByRole('article', { name: 'Flight 1' }));
    const toInputs = card.getAllByLabelText(/^To/) as HTMLInputElement[];
    expect(toInputs[1]).toHaveValue('Singapore');
    // Multi-segment ordering and data are intact.
    const stored = capturedForm?.getValues('flightDetails.flights.0.outbound.segments') as Array<{ from: string; to: string }>;
    expect(stored).toHaveLength(2);
    expect(stored[0]).toMatchObject({ from: 'Delhi', to: 'Kuala Lumpur' });
    expect(stored[1]).toMatchObject({ from: 'Kuala Lumpur', to: 'Singapore' });
  });
});
