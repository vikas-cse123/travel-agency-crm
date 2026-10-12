import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Route, Routes } from 'react-router-dom';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test/utils';
import { QuotationsPage } from './QuotationsPage';

const auth = vi.hoisted(() => ({ permissions: new Set<string>(['*']) }));
vi.mock('@/features/auth/AuthProvider', () => ({
  useAuth: () => ({
    user: { id: 'user-1', fullName: 'Aditi Rao', company: { name: 'Alpha Travel' } },
    hasPermission: (key: string) => auth.permissions.has(key) || auth.permissions.has('*'),
  }),
}));

const response = (data: unknown) =>
  ({ ok: true, status: 200, json: async () => ({ success: true, data }) }) as Response;
const person = { id: 'user-1', fullName: 'Aditi Rao', username: 'owner' };
const page = (rows: unknown[]) => ({
  data: rows,
  pagination: { page: 1, pageSize: 20, total: rows.length, totalPages: 1 },
});

const version = (overrides: Record<string, unknown> = {}) => ({
  id: 'version-1',
  versionNumber: 1,
  title: 'Goa proposal',
  status: 'FINALIZED',
  currency: 'INR',
  finalAmount: '25000',
  destinationSummary: 'Goa',
  travelStartDate: null,
  travelEndDate: null,
  adults: 2,
  childrenWithBed: 0,
  childrenWithoutBed: 0,
  infants: 0,
  hotels: [],
  services: [],
  itinerary: [],
  inclusions: [],
  exclusions: [],
  terms: [],
  ...overrides,
});

const quotation = (overrides: Record<string, unknown> = {}) => ({
  id: 'quotation-1',
  quotationNumber: 'QT-2026-000001',
  customerName: 'Aarav Mehta',
  destinationSummary: 'Goa',
  status: 'SENT',
  currentVersionId: 'version-1',
  createdAt: '2026-07-20T00:00:00.000Z',
  createdBy: person,
  query: { id: 'lead-1', queryNumber: 'QRY-2026-000001' },
  versions: [version()],
  ...overrides,
});

function stubList(rows: unknown[]) {
  return vi.fn<(input: RequestInfo | URL, options?: RequestInit) => Promise<Response>>(
    async (input, options) => {
      const url = String(input);
      if (url.includes('/public-link')) {
        const id = url.split('/quotations/')[1]!.split('/')[0]!;
        return response({ url: `http://localhost:5173/q/${id}-token` });
      }
      if (url.includes('/generate-pdf')) return response({ id: 'document-1', fileName: 'quote.pdf' });
      if (url.includes('/download-url')) return response({ url: 'http://localhost:5173/docs/quote.pdf' });
      if (!options || options.method === 'GET' || options.method === undefined)
        return response({
          ...page(rows),
          analytics: { byStatus: { SENT: rows.length }, totalQuotedValue: '0', acceptanceRate: 0 },
        });
      return response({});
    },
  );
}

function renderList() {
  renderWithProviders(
    <Routes>
      <Route path="/quotations" element={<QuotationsPage />} />
    </Routes>,
    { route: '/quotations' },
  );
}

describe('Quotation row actions', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    auth.permissions = new Set(['*']);
  });

  it('shows all four icon actions for every row with accessible labels', async () => {
    vi.stubGlobal('fetch', stubList([
      quotation(),
      quotation({
        id: 'quotation-2',
        quotationNumber: 'QT-2026-000002',
        customerName: 'Mira Shah',
        versions: [version({ id: 'version-2' })],
        currentVersionId: 'version-2',
      }),
    ]));
    renderList();
    await screen.findAllByText('QT-2026-000001');
    for (const number of ['QT-2026-000001', 'QT-2026-000002']) {
      expect(
        screen.getByRole('button', { name: `Generate PDF for ${number}` }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: `Copy Weblink URL for ${number}` }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: `Preview Weblink for ${number}` }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: `WhatsApp Message for ${number}` }),
      ).toBeInTheDocument();
    }
  });

  it('uses the supplied WhatsApp image asset with accessible labeling', async () => {
    vi.stubGlobal('fetch', stubList([quotation()]));
    renderList();
    await screen.findAllByText('QT-2026-000001');
    const button = screen.getByRole('button', { name: 'WhatsApp Message for QT-2026-000001' });
    expect(button).toHaveAttribute('title', 'WhatsApp Message');
    const image = within(button).getByRole('presentation', { hidden: true });
    expect(image.tagName).toBe('IMG');
    expect(image).toHaveAttribute('src', '/whatsapp-logo-green.png');
    expect(image.className).toContain('h-[18px]');
    expect(image.className).toContain('w-[18px]');
  });

  it('applies distinct icon colors with the WhatsApp image unchanged', async () => {
    vi.stubGlobal('fetch', stubList([quotation()]));
    renderList();
    await screen.findAllByText('QT-2026-000001');
    const pdfIcon = screen
      .getByRole('button', { name: 'Generate PDF for QT-2026-000001' })
      .querySelector('svg')!;
    expect(pdfIcon.getAttribute('class')).toContain('text-[#D99016]');
    expect(pdfIcon.getAttribute('class')).toContain('h-[18px]');
    expect(pdfIcon.getAttribute('stroke-width')).toBe('2');
    const copyIcon = screen
      .getByRole('button', { name: 'Copy Weblink URL for QT-2026-000001' })
      .querySelector('svg')!;
    expect(copyIcon.getAttribute('class')).toContain('text-[#64748B]');
    expect(copyIcon.getAttribute('class')).toContain('h-[18px]');
    expect(copyIcon.getAttribute('stroke-width')).toBe('2');
    const previewIcon = screen
      .getByRole('button', { name: 'Preview Weblink for QT-2026-000001' })
      .querySelector('svg')!;
    expect(previewIcon.getAttribute('class')).toContain('text-[#2563EB]');
    expect(previewIcon.getAttribute('class')).toContain('h-[18px]');
    expect(previewIcon.getAttribute('stroke-width')).toBe('2');
    // WhatsApp keeps the supplied green logo image, not a lucide icon.
    const whatsappButton = screen.getByRole('button', {
      name: 'WhatsApp Message for QT-2026-000001',
    });
    expect(whatsappButton.querySelector('svg')).toBeNull();
    expect(whatsappButton.querySelector('img')).toHaveAttribute('src', '/whatsapp-logo-green.png');
  });

  it('generates the PDF for the clicked row with its current version', async () => {
    const fetchMock = stubList([
      quotation(),
      quotation({
        id: 'quotation-2',
        quotationNumber: 'QT-2026-000002',
        customerName: 'Mira Shah',
        versions: [version({ id: 'version-2', versionNumber: 2 })],
        currentVersionId: 'version-2',
      }),
    ]);
    vi.stubGlobal('fetch', fetchMock);
    const replace = vi.fn();
    vi.spyOn(window, 'open').mockReturnValue({
      opener: null,
      document: { title: '', body: { innerHTML: '' } },
      location: { replace },
      close: vi.fn(),
    } as unknown as Window);
    renderList();
    await screen.findAllByText('QT-2026-000002');
    await userEvent.click(screen.getByRole('button', { name: 'Generate PDF for QT-2026-000002' }));
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([url, options]) =>
            String(url).includes('/quotations/quotation-2/versions/version-2/generate-pdf') &&
            options?.method === 'POST' &&
            JSON.parse(String(options.body)).style === 'CLASSIC',
        ),
      ).toBe(true),
    );
    await waitFor(() =>
      expect(replace).toHaveBeenCalledWith('http://localhost:5173/docs/quote.pdf'),
    );
  });

  it('copies the weblink URL provisioned for the clicked row', async () => {
    const fetchMock = stubList([quotation()]);
    vi.stubGlobal('fetch', fetchMock);
    const clipboardWrite = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: clipboardWrite },
    });
    renderList();
    await screen.findAllByText('QT-2026-000001');
    await userEvent.click(screen.getByRole('button', { name: 'Copy Weblink URL for QT-2026-000001' }));
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([url, options]) =>
            String(url).includes('/quotations/quotation-1/public-link') &&
            options?.method === 'POST' &&
            JSON.parse(String(options.body)).quotationVersionId === 'version-1',
        ),
      ).toBe(true),
    );
    await waitFor(() =>
      expect(clipboardWrite).toHaveBeenCalledWith('http://localhost:5173/q/quotation-1-token'),
    );
  });

  it('previews the weblink provisioned for the clicked row in a new tab', async () => {
    const fetchMock = stubList([quotation()]);
    vi.stubGlobal('fetch', fetchMock);
    const replace = vi.fn();
    const open = vi.spyOn(window, 'open').mockReturnValue({
      opener: null,
      document: { title: '', body: { innerHTML: '' } },
      location: { replace },
      close: vi.fn(),
    } as unknown as Window);
    renderList();
    await screen.findAllByText('QT-2026-000001');
    await userEvent.click(screen.getByRole('button', { name: 'Preview Weblink for QT-2026-000001' }));
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(([url]) =>
          String(url).includes('/quotations/quotation-1/public-link'),
        ),
      ).toBe(true),
    );
    // Popup-safe flow (mirrors the detail page): a blank tab opens on click,
    // then navigates to the row's provisioned weblink URL.
    expect(open).toHaveBeenCalledWith('about:blank', '_blank');
    await waitFor(() =>
      expect(replace).toHaveBeenCalledWith('http://localhost:5173/q/quotation-1-token'),
    );
  });

  it('opens the WhatsApp workflow for the clicked row', async () => {
    vi.stubGlobal('fetch', stubList([quotation()]));
    renderList();
    await screen.findAllByText('QT-2026-000001');
    await userEvent.click(screen.getByRole('button', { name: 'WhatsApp Message for QT-2026-000001' }));
    // The shared WhatsApp dialog opens with an editor for the row's quotation.
    expect(await screen.findByRole('dialog', { name: 'WhatsApp Message' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'WhatsApp summary editor' })).toBeInTheDocument();
  });

  it('matches the Leads header background and shows column dividers', async () => {
    vi.stubGlobal('fetch', stubList([quotation()]));
    renderList();
    await screen.findAllByText('QT-2026-000001');
    // Header uses the Leads table green with white text.
    const thead = document.querySelector('thead')!;
    expect(thead.className).toContain('bg-[#0dbb7a]');
    expect(thead.className).toContain('text-white');
    // Every header and body cell carries a subtle vertical divider.
    const headerCells = within(thead).getAllByRole('columnheader');
    expect(headerCells.length).toBeGreaterThan(0);
    for (const cell of headerCells) {
      expect(cell.className).toContain('border-r');
      expect(cell.className).toContain('border-white/30');
    }
    const table = document.querySelector('table')!;
    const bodyCells = within(table).getAllByRole('cell');
    expect(bodyCells.length).toBeGreaterThan(0);
    for (const cell of bodyCells) {
      expect(cell.className).toContain('border-r');
      expect(cell.className).toContain('border-slate-200');
    }
  });

  it('keeps search, destination filter, pagination and row navigation working', async () => {
    const fetchMock = stubList([quotation()]);
    vi.stubGlobal('fetch', fetchMock);
    renderList();
    await screen.findAllByText('QT-2026-000001');
    await userEvent.type(screen.getByLabelText('Search quotations'), 'Aarav');
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([url]) => String(url).includes('search=Aarav'))).toBe(true),
    );
    await userEvent.type(screen.getByLabelText('Quotation destination'), 'Goa');
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([url]) => String(url).includes('destination=Goa'))).toBe(
        true,
      ),
    );
    expect(screen.getByText('Showing 1 to 1 of 1 entries')).toBeInTheDocument();
    // Row navigation still links to the row's quotation and lead (scoped to
    // the desktop table; the mobile card renders the same links).
    const table = document.querySelector('table')!;
    expect(table).not.toBeNull();
    expect(within(table).getByRole('link', { name: 'QT-2026-000001' })).toHaveAttribute(
      'href',
      '/quotations/quotation-1',
    );
    const row = within(table).getByRole('link', { name: 'QT-2026-000001' }).closest('tr')!;
    expect(within(row).getByRole('link', { name: 'QRY-2026-000001' })).toHaveAttribute(
      'href',
      '/queries/lead-1',
    );
  });
});
