import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Route, Routes } from 'react-router-dom';
import { screen } from '@testing-library/react';
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

const detail = () => ({
  id: 'quotation-1',
  quotationNumber: 'QT-2026-000001',
  queryId: 'lead-1',
  currentVersionId: 'version-1',
  status: 'DRAFT',
  customerName: 'Aarav Mehta',
  customerEmail: 'aarav@example.test',
  customerPhone: '+91 90000 00000',
  destinationSummary: 'Goa',
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
    services: [{ serviceType: 'FLIGHT' }],
  },
  versions: [
    {
      id: 'version-1',
      versionNumber: 1,
      title: 'Goa proposal',
      introduction: null,
      destinationSummary: 'Goa',
      travelStartDate: null,
      travelEndDate: null,
      currency: 'INR',
      subtotalSellingPrice: '0',
      markupMode: 'NONE',
      markupValue: '0',
      totalMarkup: '0',
      taxRate: '0',
      taxAmount: '0',
      discountAmount: '0',
      finalAmount: '0',
      pricingMode: 'PER_PERSON',
      perAdultPrice: '0',
      perChildWithBedPrice: '0',
      perChildWithoutBedPrice: '0',
      perInfantPrice: '0',
      taxNote: null,
      netAmount: '0',
      initialPaymentAmount: '0',
      paymentLink: null,
      status: 'DRAFT',
      finalizedAt: null,
      createdAt: '2026-07-21T00:00:00.000Z',
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

function builderFetch(base: unknown) {
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

const openFlightTab = async () => {
  await userEvent.click(await screen.findByRole('button', { name: /^Flight/ }));
};

describe('Flight information mode toggle', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.stubGlobal('scrollTo', vi.fn());
    auth.permissions = new Set(['quotations.view', 'quotations.update', 'quotations.view_costing']);
  });

  it('renders two equal-width options inside a rounded bordered container', async () => {
    vi.stubGlobal('fetch', builderFetch(detail()));
    renderBuilder();
    await screen.findByRole('heading', { name: 'Quotation builder' });
    await openFlightTab();
    const group = screen.getByRole('radiogroup', { name: 'Flight information mode' });
    expect(group.className).toContain('grid-cols-2');
    expect(group.className).toContain('rounded-[20px]');
    expect(group.className).toContain('bg-white');
    const fill = screen.getByRole('radio', { name: 'Fill details' });
    const upload = screen.getByRole('radio', { name: 'Upload image' });
    for (const option of [fill, upload]) {
      expect(option.className).toContain('w-full');
      expect(option.className).toContain('whitespace-nowrap');
      expect(option.className).toContain('rounded-[14px]');
    }
  });

  it('selects Fill details by default with a solid blue fill', async () => {
    vi.stubGlobal('fetch', builderFetch(detail()));
    renderBuilder();
    await screen.findByRole('heading', { name: 'Quotation builder' });
    await openFlightTab();
    const fill = screen.getByRole('radio', { name: 'Fill details' });
    const upload = screen.getByRole('radio', { name: 'Upload image' });
    expect(fill).toHaveAttribute('aria-checked', 'true');
    expect(fill.className).toContain('bg-brand-600');
    expect(fill.className).toContain('text-white');
    expect(upload).toHaveAttribute('aria-checked', 'false');
    expect(upload.className).toContain('bg-white');
    expect(upload.className).not.toContain('bg-brand-600');
    // Structured form visible, upload interface hidden.
    expect(screen.getByLabelText('Flight section title')).toBeInTheDocument();
    expect(screen.queryByLabelText('Flight image')).not.toBeInTheDocument();
  });

  it('switches the blue fill to Upload image and back without losing form data', async () => {
    vi.stubGlobal('fetch', builderFetch(detail()));
    renderBuilder();
    await screen.findByRole('heading', { name: 'Quotation builder' });
    await openFlightTab();
    await userEvent.clear(screen.getByLabelText('Flight section title'));
    await userEvent.type(screen.getByLabelText('Flight section title'), 'Flight Details Updated');

    await userEvent.click(screen.getByRole('radio', { name: 'Upload image' }));
    const upload = screen.getByRole('radio', { name: 'Upload image' });
    expect(upload).toHaveAttribute('aria-checked', 'true');
    expect(upload.className).toContain('bg-brand-600');
    expect(upload.className).toContain('text-white');
    const fill = screen.getByRole('radio', { name: 'Fill details' });
    expect(fill).toHaveAttribute('aria-checked', 'false');
    expect(fill.className).not.toContain('bg-brand-600');
    // Upload interface shown, structured journey hidden.
    expect(screen.getByLabelText('Flight image')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('radio', { name: 'Fill details' }));
    expect(screen.getByRole('radio', { name: 'Fill details' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    // Unrelated flight data survived the mode switches.
    expect(screen.getByLabelText('Flight section title')).toHaveValue('Flight Details Updated');
  });

  it('supports keyboard operation with a visible focus indicator', async () => {
    vi.stubGlobal('fetch', builderFetch(detail()));
    renderBuilder();
    await screen.findByRole('heading', { name: 'Quotation builder' });
    await openFlightTab();
    const upload = screen.getByRole('radio', { name: 'Upload image' });
    expect(upload.className).toContain('focus-visible:ring-2');
    upload.focus();
    expect(upload).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    expect(screen.getByRole('radio', { name: 'Upload image' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });
});
