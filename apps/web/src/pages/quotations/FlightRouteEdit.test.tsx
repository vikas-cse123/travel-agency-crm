import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useForm, type UseFormReturn } from 'react-hook-form';
import { renderWithProviders } from '@/test/utils';
import type { QuotationVersionInput } from '@interscale/shared';
import { FlightRecordCard } from './FlightRecordCard';
import { emptySegment } from './QuotationBuilderPage';

const auth = vi.hoisted(() => ({ permissions: new Set<string>() }));
vi.mock('@/features/auth/AuthProvider', () => ({
  useAuth: () => ({ hasPermission: (key: string) => auth.permissions.has(key) }),
}));

const segment = (from: string | null, to: string | null, flightNumber = 'AI101') => ({
  ...emptySegment(),
  from,
  to,
  flightNumber,
});

const flight = {
  bookmarkCode: null,
  journeyType: 'ROUND_TRIP',
  outbound: {
    fromCity: 'DEL',
    toCity: 'GOI',
    // Initialized header route (as hydration produces for saved quotations).
    routeFrom: 'DEL',
    routeTo: 'GOI',
    travelClass: 'Economy',
    segments: [segment('DEL', 'BOM', 'AI101'), segment('BOM', 'GOI', 'AI102')],
  },
  returnJourney: {
    fromCity: 'GOI',
    toCity: 'DEL',
    routeFrom: 'GOI',
    routeTo: 'DEL',
    travelClass: 'Economy',
    segments: [segment('GOI', 'DEL', 'AI102')],
  },
};

let capturedForm: UseFormReturn<QuotationVersionInput> | null = null;

function renderRouteCard() {
  const onLoadBookmarks = vi.fn();
  const onRemoveFlight = vi.fn();
  function Harness() {
    const form = useForm({ defaultValues: { flightDetails: { flights: [flight] } } });
    capturedForm = form as unknown as UseFormReturn<QuotationVersionInput>;
    return (
      <FlightRecordCard
        flightIndex={0}
        form={form as never}
        airlineList={[]}
        onLoadBookmarks={onLoadBookmarks}
        onRemoveFlight={onRemoveFlight}
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

describe('Flight journey route editing', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.stubGlobal('scrollTo', vi.fn());
    auth.permissions = new Set(['quotations.view', 'quotations.update', 'quotations.view_costing']);
    capturedForm = null;
  });

  it('edits the outbound route header without touching segments', async () => {
    renderRouteCard();
    expect(headerText('Outbound Journey')).toContain('DEL → GOI');

    await userEvent.click(screen.getByRole('button', { name: 'Edit Outbound Journey route' }));
    const origin = screen.getByLabelText('Flight 1 Outbound Journey origin') as HTMLInputElement;
    const destination = screen.getByLabelText(
      'Flight 1 Outbound Journey destination',
    ) as HTMLInputElement;
    // Fields are pre-populated with the current route values.
    expect(origin).toHaveValue('DEL');
    expect(destination).toHaveValue('GOI');

    await userEvent.clear(origin);
    await userEvent.type(origin, 'BLR');
    await userEvent.clear(destination);
    await userEvent.type(destination, 'COK');
    await userEvent.keyboard('{Enter}');

    // Header reflects the edit immediately.
    expect(headerText('Outbound Journey')).toContain('BLR → COK');
    // The independent route is stored; journey endpoints are untouched.
    expect(capturedForm?.getValues('flightDetails.flights.0.outbound.routeFrom')).toBe('BLR');
    expect(capturedForm?.getValues('flightDetails.flights.0.outbound.routeTo')).toBe('COK');
    expect(capturedForm?.getValues('flightDetails.flights.0.outbound.fromCity')).toBe('DEL');
    expect(capturedForm?.getValues('flightDetails.flights.0.outbound.toCity')).toBe('GOI');
    // Segments are never rewritten by a header edit.
    const fromInputs = within(screen.getByRole('article', { name: 'Flight 1' })).getAllByLabelText(/^From/) as HTMLInputElement[];
    const toInputs = within(screen.getByRole('article', { name: 'Flight 1' })).getAllByLabelText(/^To/) as HTMLInputElement[];
    expect(fromInputs[0]).toHaveValue('DEL');
    expect(toInputs[0]).toHaveValue('BOM');
    expect(fromInputs[1]).toHaveValue('BOM');
    expect(toInputs[1]).toHaveValue('GOI');
    // Return journey is untouched.
    expect(headerText('Return Journey')).toContain('GOI → DEL');
    expect(fromInputs[2]).toHaveValue('GOI');
    expect(toInputs[2]).toHaveValue('DEL');
  });

  it('edits the return route header without touching segments', async () => {
    renderRouteCard();
    await userEvent.click(screen.getByRole('button', { name: 'Edit Return Journey route' }));
    const origin = screen.getByLabelText('Flight 1 Return Journey origin') as HTMLInputElement;
    const destination = screen.getByLabelText(
      'Flight 1 Return Journey destination',
    ) as HTMLInputElement;
    expect(origin).toHaveValue('GOI');
    expect(destination).toHaveValue('DEL');

    await userEvent.clear(origin);
    await userEvent.type(origin, 'HYD');
    await userEvent.clear(destination);
    await userEvent.type(destination, 'MAA');
    await userEvent.keyboard('{Enter}');

    expect(headerText('Return Journey')).toContain('HYD → MAA');
    expect(capturedForm?.getValues('flightDetails.flights.0.returnJourney.routeFrom')).toBe('HYD');
    expect(capturedForm?.getValues('flightDetails.flights.0.returnJourney.routeTo')).toBe('MAA');
    const card = within(screen.getByRole('article', { name: 'Flight 1' }));
    const fromInputs = card.getAllByLabelText(/^From/) as HTMLInputElement[];
    const toInputs = card.getAllByLabelText(/^To/) as HTMLInputElement[];
    // Single-segment return journey keeps its own segment values.
    expect(fromInputs[2]).toHaveValue('GOI');
    expect(toInputs[2]).toHaveValue('DEL');
    // Outbound is untouched, including header, segments and flight numbers.
    expect(headerText('Outbound Journey')).toContain('DEL → GOI');
    expect(fromInputs[0]).toHaveValue('DEL');
    expect(toInputs[1]).toHaveValue('GOI');
    expect(capturedForm?.getValues('flightDetails.flights.0.outbound.segments.0.flightNumber')).toBe(
      'AI101',
    );
    expect(capturedForm?.getValues('flightDetails.flights.0.outbound.segments.1.flightNumber')).toBe(
      'AI102',
    );
  });

  it('cancels the edit with Escape without changing anything', async () => {
    renderRouteCard();
    await userEvent.click(screen.getByRole('button', { name: 'Edit Outbound Journey route' }));
    const origin = screen.getByLabelText('Flight 1 Outbound Journey origin') as HTMLInputElement;
    await userEvent.clear(origin);
    await userEvent.type(origin, 'XXX');
    await userEvent.keyboard('{Escape}');

    expect(screen.queryByLabelText('Flight 1 Outbound Journey origin')).not.toBeInTheDocument();
    expect(headerText('Outbound Journey')).toContain('DEL → GOI');
    const fromInputs = within(screen.getByRole('article', { name: 'Flight 1' })).getAllByLabelText(/^From/) as HTMLInputElement[];
    expect(fromInputs[0]).toHaveValue('DEL');
    expect(capturedForm?.getValues('flightDetails.flights.0.outbound.fromCity')).toBe('DEL');
  });

  it('saves the edit when focus leaves the fields without touching segments', async () => {
    renderRouteCard();
    await userEvent.click(screen.getByRole('button', { name: 'Edit Outbound Journey route' }));
    const origin = screen.getByLabelText('Flight 1 Outbound Journey origin') as HTMLInputElement;
    await userEvent.clear(origin);
    await userEvent.type(origin, 'BLR');
    // Tab out of both fields: leaving the editor commits the draft.
    await userEvent.tab();
    await userEvent.tab();
    expect(screen.queryByLabelText('Flight 1 Outbound Journey origin')).not.toBeInTheDocument();
    expect(headerText('Outbound Journey')).toContain('BLR → GOI');
    const card = within(screen.getByRole('article', { name: 'Flight 1' }));
    expect((card.getAllByLabelText(/^From/) as HTMLInputElement[])[0]).toHaveValue('DEL');
  });

  it('does not rewrite an initialized header when the first segment From is edited', async () => {
    renderRouteCard();
    const card = within(screen.getByRole('article', { name: 'Flight 1' }));
    const fromInputs = card.getAllByLabelText(/^From/) as HTMLInputElement[];
    await userEvent.clear(fromInputs[0]!);
    await userEvent.type(fromInputs[0]!, 'BLR');
    // The configured header keeps its independent value.
    expect(headerText('Outbound Journey')).toContain('DEL → GOI');
    expect(capturedForm?.getValues('flightDetails.flights.0.outbound.routeFrom')).toBe('DEL');
    // Segment-level endpoint metadata still tracks the typed value.
    expect(capturedForm?.getValues('flightDetails.flights.0.outbound.fromCity')).toBe('BLR');
  });

  it('does not rewrite an initialized header when the last segment To is edited', async () => {
    renderRouteCard();
    const card = within(screen.getByRole('article', { name: 'Flight 1' }));
    const toInputs = card.getAllByLabelText(/^To/) as HTMLInputElement[];
    const fromInputs = card.getAllByLabelText(/^From/) as HTMLInputElement[];
    // Intermediate edits never move the header.
    await userEvent.clear(toInputs[0]!);
    await userEvent.type(toInputs[0]!, 'XXX');
    await userEvent.clear(fromInputs[1]!);
    await userEvent.type(fromInputs[1]!, 'YYY');
    expect(headerText('Outbound Journey')).toContain('DEL → GOI');
    // Editing the last segment's To updates endpoint metadata, not the header.
    await userEvent.clear(toInputs[1]!);
    await userEvent.type(toInputs[1]!, 'COK');
    expect(headerText('Outbound Journey')).toContain('DEL → GOI');
    expect(capturedForm?.getValues('flightDetails.flights.0.outbound.routeTo')).toBe('GOI');
    expect(capturedForm?.getValues('flightDetails.flights.0.outbound.toCity')).toBe('COK');
    // Intermediate values themselves are preserved verbatim.
    expect(toInputs[0]).toHaveValue('XXX');
    expect(fromInputs[1]).toHaveValue('YYY');
  });

  it('keeps every other persisted field intact after route edits', async () => {
    renderRouteCard();
    await userEvent.click(screen.getByRole('button', { name: 'Edit Outbound Journey route' }));
    const destination = screen.getByLabelText(
      'Flight 1 Outbound Journey destination',
    ) as HTMLInputElement;
    await userEvent.clear(destination);
    await userEvent.type(destination, 'COK');
    await userEvent.keyboard('{Enter}');

    const stored = capturedForm?.getValues('flightDetails.flights.0');
    expect(stored).toMatchObject({
      bookmarkCode: null,
      journeyType: 'ROUND_TRIP',
      outbound: {
        fromCity: 'DEL',
        toCity: 'GOI',
        routeFrom: 'DEL',
        routeTo: 'COK',
        travelClass: 'Economy',
      },
      returnJourney: {
        fromCity: 'GOI',
        toCity: 'DEL',
      },
    });
    const outboundSegments = (
      stored as unknown as {
        outbound: { segments: Array<Record<string, unknown>> };
        returnJourney: { segments: Array<Record<string, unknown>> };
      }
    ).outbound.segments;
    expect(outboundSegments).toHaveLength(2);
    expect(outboundSegments[0]).toMatchObject({
      from: 'DEL',
      to: 'BOM',
      flightNumber: 'AI101',
      travelClass: 'Economy',
      cabinLuggage: '7kg',
      checkInLuggage: '20kg',
    });
    expect(outboundSegments[1]).toMatchObject({
      from: 'BOM',
      to: 'GOI',
      flightNumber: 'AI102',
    });
    expect(
      (stored as unknown as { returnJourney: { segments: Array<Record<string, unknown>> } })
        .returnJourney.segments,
    ).toHaveLength(1);
  });

  it('does not collapse the journey when opening the route editor', async () => {
    renderRouteCard();
    await userEvent.click(screen.getByRole('button', { name: 'Edit Outbound Journey route' }));
    // The pencil toggles editing, not the journey collapse: segments stay visible.
    expect(screen.getByLabelText('Flight 1 Outbound Journey origin')).toBeInTheDocument();
    const card = within(screen.getByRole('article', { name: 'Flight 1' }));
    expect(card.getAllByLabelText(/^From/)).toHaveLength(3);
  });
});
