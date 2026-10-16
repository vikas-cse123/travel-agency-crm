import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Route, Routes } from 'react-router-dom';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test/utils';
import { QuotationBuilderPage } from './QuotationBuilderPage';

const auth = vi.hoisted(() => ({ permissions: new Set<string>() }));
vi.mock('@/features/auth/AuthProvider', () => ({
  useAuth: () => ({ hasPermission: (key: string) => auth.permissions.has(key) }),
}));

const response = (data: unknown) =>
  ({ ok: true, status: 200, json: async () => ({ success: true, data }) }) as Response;

const person = { id: 'user-1', fullName: 'Aditi Rao', username: 'owner' };

const quotationDetail = (
  pricingMode: string,
  packageCustomItems?: Array<{ label: string; amount: number }>,
) => ({
  id: 'quotation-1',
  quotationNumber: 'QT-2026-000001',
  currentVersionId: 'version-1',
  status: 'DRAFT',
  customerName: 'Aarav Mehta',
  customerEmail: 'aarav@example.test',
  customerPhone: '+91 90000 00000',
  destinationSummary: 'Singapore',
  travelStartDate: null,
  travelEndDate: null,
  adults: 2,
  childrenWithBed: 0,
  childrenWithoutBed: 0,
  infants: 0,
  rooms: 1,
  validUntil: null,
  createdBy: person,
  query: {
    id: 'lead-1',
    queryNumber: 'QRY-1',
    leadStage: 'QUOTATION_SENT',
    assignedToId: 'user-1',
    createdById: 'user-1',
  },
  versions: [
    {
      id: 'version-1',
      versionNumber: 1,
      title: 'Singapore Package',
      introduction: null,
      destinationSummary: 'Singapore',
      travelStartDate: null,
      travelEndDate: null,
      currency: 'INR',
      subtotalSellingPrice: '202440',
      markupMode: 'NONE',
      markupValue: '0',
      totalMarkup: '0',
      taxRate: '0',
      taxAmount: '0',
      discountAmount: '0',
      finalAmount: '202440',
      pricingMode,
      perAdultPrice: '101220',
      perChildWithBedPrice: '0',
      perChildWithoutBedPrice: '0',
      perInfantPrice: '0',
      packageCustomItems: packageCustomItems ?? null,
      taxNote: null,
      netAmount: '0',
      initialPaymentAmount: '0',
      paymentLink: null,
      status: 'DRAFT',
      finalizedAt: null,
      createdAt: '2026-08-24T00:00:00.000Z',
      createdBy: person,
      itinerary: [],
      hotels: [],
      services: [],
      inclusions: [],
      exclusions: [],
      terms: [],
      addOnDetails: { include: true },
    },
  ],
  documents: [],
  emailLogs: [],
  activityTimeline: [],
});

function masterFetch(base: unknown) {
  const routes: Record<string, unknown> = {
    '/masters/hotels': { success: true, data: [], pagination: { total: 0 } },
    '/masters/airlines': { success: true, data: [], pagination: { total: 0 } },
    '/masters/cruises': { success: true, data: [], pagination: { total: 0 } },
    '/masters/vehicles': { success: true, data: [], pagination: { total: 0 } },
    '/masters/sightseeing': { success: true, data: [], pagination: { total: 0 } },
    '/masters/sightseeing/activities': { success: true, data: [], pagination: { total: 0 } },
    '/masters/add-on-services': { success: true, data: [], pagination: { total: 0 } },
    '/masters/faqs': { success: true, data: [], pagination: { total: 0 } },
    '/users': { success: true, data: [], pagination: { total: 0 } },
    '/settings': {
      success: true,
      data: { profile: { phone: null, email: 'a@b.test' }, quotationDefaults: {} },
    },
    '/destination-expert/presets': { success: true, data: [] },
  };
  return vi.fn(async (input: RequestInfo | URL, options?: RequestInit) => {
    void options;
    const url = String(input);
    for (const [prefix, body] of Object.entries(routes).sort(([a], [b]) => b.length - a.length))
      if (url.includes(prefix)) return response(body);
    return response(base);
  });
}

const renderBuilder = () =>
  renderWithProviders(
    <Routes>
      <Route
        path="/quotations/:quotationId/versions/:versionId/edit"
        element={<QuotationBuilderPage />}
      />
    </Routes>,
    { route: '/quotations/quotation-1/versions/version-1/edit' },
  );

const totalInput = () =>
  screen.getByLabelText('Total Package Price') as HTMLInputElement;
const addItem = () => screen.getByRole('button', { name: /Add Item/ });
const labelInput = (n: number) => screen.getByLabelText(`Additional item ${n} label`);
const amountInput = (n: number) => screen.getByLabelText(`Additional item ${n} amount`);
const deleteItem = (n: number) => screen.getByRole('button', { name: `Delete item ${n}` });

async function openPricingTab() {
  await userEvent.click(await screen.findByRole('button', { name: 'Pricing' }));
}

describe('By Traveler — Additional Price Items', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.stubGlobal('scrollTo', vi.fn());
    auth.permissions = new Set(['quotations.view', 'quotations.update', 'quotations.view_costing']);
  });

  it('adds, edits and deletes items and keeps the total package price in sync', async () => {
    const fetchMock = masterFetch(quotationDetail('PER_PERSON'));
    vi.stubGlobal('fetch', fetchMock);
    renderBuilder();
    await screen.findByRole('heading', { name: 'Quotation builder' });
    await openPricingTab();

    expect(await screen.findByText('Additional Price Items')).toBeInTheDocument();
    expect(screen.getByText('No additional price items yet')).toBeInTheDocument();
    // Traveler-only total: 2 × 101,220.
    expect(totalInput().value).toContain('2,02,440');

    await userEvent.click(addItem());
    await userEvent.type(labelInput(1), 'Flight tickets');
    await userEvent.type(amountInput(1), '5000');
    // + 5,000 flat.
    expect(totalInput().value).toContain('2,07,440');

    // A second, custom-labelled item.
    await userEvent.click(addItem());
    await userEvent.type(labelInput(2), 'Visa fees');
    await userEvent.type(amountInput(2), '3000');
    expect(totalInput().value).toContain('2,10,440');

    // Deleting the first item removes its flat amount.
    await userEvent.click(deleteItem(1));
    expect(totalInput().value).toContain('2,05,440');
    expect(screen.queryByText('Flight tickets')).not.toBeInTheDocument();
    expect(labelInput(1)).toHaveValue('Visa fees');
  });

  it('reorders Price Breakdown rows via Up/Down and persists the order', async () => {
    const fetchMock = masterFetch(quotationDetail('PER_PERSON'));
    vi.stubGlobal('fetch', fetchMock);
    renderBuilder();
    await screen.findByRole('heading', { name: 'Quotation builder' });
    await openPricingTab();

    // Default order is Adults, CWB, CWOB, Infants; move Adults one step down.
    await userEvent.click(screen.getByRole('button', { name: 'Move Adults down' }));

    await userEvent.click(screen.getAllByRole('button', { name: 'Save quotation' })[1]!);
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([, options]) => options?.method === 'PATCH')).toBe(true),
    );
    const patch = fetchMock.mock.calls.find(([, options]) => options?.method === 'PATCH');
    const body = JSON.parse(String(patch![1]!.body));
    expect(body.pricingRowOrder.slice(0, 2)).toEqual(['cwb', 'adults']);
  });

  it('persists the items (trimmed) with positive amounts and drops blank rows', async () => {
    const fetchMock = masterFetch(quotationDetail('PER_PERSON'));
    vi.stubGlobal('fetch', fetchMock);
    renderBuilder();
    await screen.findByRole('heading', { name: 'Quotation builder' });
    await openPricingTab();

    await userEvent.click(addItem());
    await userEvent.type(labelInput(1), '  Flight tickets  ');
    await userEvent.type(amountInput(1), '5000');
    // Second row left blank — must never block the save or persist.
    await userEvent.click(addItem());

    await userEvent.click(screen.getAllByRole('button', { name: 'Save quotation' })[1]!);
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([, options]) => options?.method === 'PATCH')).toBe(true),
    );
    const patch = fetchMock.mock.calls.find(([, options]) => options?.method === 'PATCH');
    const body = JSON.parse(String(patch![1]!.body));
    expect(body.packageCustomItems).toEqual([
      { id: expect.any(String), label: 'Flight tickets', amount: 5000 },
    ]);
  });

  it('clamps negative amounts so they can never corrupt the total', async () => {
    const fetchMock = masterFetch(quotationDetail('PER_PERSON'));
    vi.stubGlobal('fetch', fetchMock);
    renderBuilder();
    await screen.findByRole('heading', { name: 'Quotation builder' });
    await openPricingTab();

    await userEvent.click(addItem());
    await userEvent.type(labelInput(1), 'Refund');
    fireEvent.change(amountInput(1), { target: { value: '-100' } });
    // Negative input is clamped to zero — the traveler total is unchanged.
    expect(totalInput().value).toContain('2,02,440');

    await userEvent.click(screen.getAllByRole('button', { name: 'Save quotation' })[1]!);
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([, options]) => options?.method === 'PATCH')).toBe(true),
    );
    const patch = fetchMock.mock.calls.find(([, options]) => options?.method === 'PATCH');
    const body = JSON.parse(String(patch![1]!.body));
    // A zero-valued row is not persisted; nothing negative can reach the engine.
    expect(body.packageCustomItems).toEqual([]);
  });

  it('hydrates saved items after reload and includes them in the total', async () => {
    const fetchMock = masterFetch(
      quotationDetail('PER_PERSON', [
        { label: 'Flight tickets', amount: 5000 },
        { label: 'Visa fees', amount: 3000 },
      ]),
    );
    vi.stubGlobal('fetch', fetchMock);
    renderBuilder();
    await screen.findByRole('heading', { name: 'Quotation builder' });
    await openPricingTab();

    expect(await screen.findByDisplayValue('Flight tickets')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Visa fees')).toBeInTheDocument();
    // 2 × 101,220 + 5,000 + 3,000.
    expect(totalInput().value).toContain('2,10,440');
  });

  it('hides the Additional Price Items section for By Section pricing', async () => {
    // Pricing mode is stored on the version (set on the Quotation Details page).
    const fetchMock = masterFetch(quotationDetail('SECTION_WISE'));
    vi.stubGlobal('fetch', fetchMock);
    renderBuilder();
    await screen.findByRole('heading', { name: 'Quotation builder' });
    await openPricingTab();

    expect(await screen.findByText('Extra Charges')).toBeInTheDocument();
    expect(screen.queryByText('Additional Price Items')).not.toBeInTheDocument();
  });
});

describe('Pricing tab layout', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.stubGlobal('scrollTo', vi.fn());
    auth.permissions = new Set(['quotations.view', 'quotations.update', 'quotations.view_costing']);
  });

  it('removes the pricing-method box and gives Currency a compact width', async () => {
    const fetchMock = masterFetch(quotationDetail('PER_PERSON'));
    vi.stubGlobal('fetch', fetchMock);
    renderBuilder();
    await screen.findByRole('heading', { name: 'Quotation builder' });
    await openPricingTab();

    // The informational box and its button are gone from the Pricing subtab.
    expect(screen.queryByText(/Pricing Method:/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Change pricing method' })).not.toBeInTheDocument();

    // Currency is a compact, content-width control (never full width).
    const currency = screen.getByLabelText('Currency') as HTMLSelectElement;
    expect(currency.tagName).toBe('SELECT');
    expect(currency.className).toContain('w-auto');
    expect(currency.className).not.toContain('w-full');

    // The four per-price fields keep their layout and labels.
    for (const label of ['Per Adult Price', 'Per CWB Price', 'Per CWOB Price', 'Per Infant Price']) {
      expect(screen.getByLabelText(label)).toBeInTheDocument();
    }

    // Each price field is paired with its traveler count on one aligned row.
    for (const [price, count] of [
      ['Per Adult Price', 'Adults'],
      ['Per CWB Price', 'CWB'],
      ['Per CWOB Price', 'CWOB'],
      ['Per Infant Price', 'Infants'],
    ] as const) {
      const row = screen.getByLabelText(price).closest('div.grid');
      expect(row).not.toBeNull();
      expect(row?.className).toContain('grid-cols-[');
      expect(row).toBe(screen.getByLabelText(count).closest('div.grid'));
    }

    // Totals live outside the price/count pairs.
    expect(screen.getByLabelText('Total Package Price').closest('div.grid')).not.toBe(
      screen.getByLabelText('Per Adult Price').closest('div.grid'),
    );
  });
});
