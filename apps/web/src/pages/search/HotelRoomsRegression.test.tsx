import { describe, expect, it } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient } from '@tanstack/react-query';
import { QueryProvider } from '@/providers/QueryProvider';
import { TravelSearchPage } from './TravelSearchPage';

const success = (data: unknown) => ({ ok: true, status: 200, json: async () => ({ success: true, data }) });

/**
 * Regression for the missing-room drawer bug:
 * the live property payload carries room-level offers under `offers[]`
 * (not featured/all). The previous mapper only read featured/all and returned
 * 0 options → drawer showed "No rooms or offers returned".
 * The drawer must render each unique room as its own group with suppliers.
 */
describe('HotelRoomsDrawer regression – offers[] with nested rooms[]', () => {
  it('renders Large Double Room + Standard King Room from offers[] shape', async () => {
    const hyattProperty = {
      property: {
        property_token: 'tok-hyatt',
        name: 'Hyatt Regency Lucknow',
        address: 'Regency Rd, Lucknow',
        check_in_time: '2:00 PM',
        check_out_time: '12:00 PM',
        rating: 4.4,
        reviews: 10398,
        offers: [
          {
            source: 'Booking.com',
            logo: 'https://logo/booking.png',
            num_guests: 2,
            remarks: ['Breakfast'],
            price_per_night: { price: '₹3,166', extracted_price: 3166 },
            total_price: { price: '₹19,000', extracted_price: 19000 },
            has_free_cancellation: true,
            free_cancellation_until: { date: 'Sep 25', time: '11:59 PM' },
            tracking_link: 'https://book.example/booking',
            rooms: [
              {
                name: 'Large Double Room',
                description: 'Breakfast included',
                num_guests: 2,
                beds: [{ count: 2 }],
                price_per_night: { price: '₹3,166', extracted_price: 3166 },
                total_price: { price: '₹19,000', extracted_price: 19000 },
                has_free_cancellation: true,
                link: 'https://book.example/large-double',
              },
              {
                name: 'Standard King Room',
                description: 'City view',
                num_guests: 2,
                beds: [{ count: 1, type: 'king' }],
                price_per_night: { price: '₹3,500', extracted_price: 3500 },
                total_price: { price: '₹21,000', extracted_price: 21000 },
                link: 'https://book.example/king',
              },
            ],
          },
          {
            source: 'Agoda',
            num_guests: 2,
            price_per_night: { price: '₹3,000', extracted_price: 3000 },
            total_price: { price: '₹18,000', extracted_price: 18000 },
            tracking_link: 'https://book.example/agoda',
          },
        ],
      },
    };

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url.includes('/search/hotels/property')) return success(hyattProperty);
        if (url.includes('/search/hotels?'))
          return success({
            search_information: { total_results: 1 },
            properties: [
              {
                name: 'Hyatt Regency Lucknow',
                property_token: 'tok-hyatt',
                extracted_hotel_class: 5,
                rating: 4.4,
                reviews: 10398,
                check_in_time: '2:00 PM',
                check_out_time: '12:00 PM',
                city: 'Lucknow',
                country: 'IN',
                images: [],
              },
            ],
          });
        return { ok: true, status: 200, json: async () => ({ success: true, data: {} }) };
      }),
    );

    const user = userEvent.setup();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryProvider client={client}>
        <TravelSearchPage />
      </QueryProvider>,
    );
    await user.click(screen.getByRole('tab', { name: 'Hotels' }));
    const dest = screen.getByLabelText('Destination');
    await user.clear(dest);
    await user.type(dest, 'Lucknow');
    await user.type(screen.getByLabelText('Check-in date'), '2026-09-26');
    await user.type(screen.getByLabelText('Check-out date'), '2026-10-02');
    await user.click(screen.getByRole('button', { name: 'Search hotels' }));
    await waitFor(() => expect(screen.getAllByText('Hyatt Regency Lucknow').length).toBeGreaterThan(0));
    await user.click(screen.getAllByRole('button', { name: /View Rooms & Offers/i })[0]!);
    const dialog = await screen.findByRole('dialog');

    // counts from actual normalized data: 3 rate options · 2 rooms
    expect(await within(dialog).findByText(/3 rate options · 2 rooms/)).toBeInTheDocument();

    // each unique room renders as its own group
    expect(within(dialog).getAllByText('Large Double Room').length).toBeGreaterThan(0);
    expect(within(dialog).getAllByText('Standard King Room').length).toBeGreaterThan(0);

    // supplier + room-level details render
    expect(within(dialog).getAllByText('Booking.com').length).toBeGreaterThan(0);
    expect(within(dialog).getAllByText('2 guests').length).toBeGreaterThan(0);
    expect(within(dialog).getAllByText(/₹19,000/).length).toBeGreaterThan(0);
    expect(within(dialog).getAllByText(/Free cancellation/).length).toBeGreaterThan(0);

    // provider-only offer renders as Provider Rate without inventing a room
    expect(within(dialog).getByText('Provider Rate')).toBeInTheDocument();
    expect(within(dialog).getAllByText('Agoda').length).toBeGreaterThan(0);
  });

  it('sends sanitized beds when a room carries a non-array beds value', async () => {
    // Provider shape variance (e.g. beds as a string) must never poison the
    // bookmark snapshot: it is coerced to null, and the drawer keeps working.
    // Previously a malformed beds value stored in hotel.rooms[] made every
    // later bookmark for that hotel 500 with "Something went wrong".
    const oddProperty = {
      property: {
        property_token: 'tok-odd',
        name: 'Nest Hotel Singapore',
        featured_offers: [
          {
            source: 'Agoda',
            num_guests: 2,
            price_per_night: { price: '₹10,738', extracted_price: 10738 },
            total_price: { price: '₹53,688', extracted_price: 53688 },
            tracking_link: 'https://book.example/agoda',
            rooms: [
              {
                name: 'Bunk Bed',
                num_guests: 2,
                beds: '1 bunk bed',
                price_per_night: { price: '₹10,738', extracted_price: 10738 },
                total_price: { price: '₹53,688', extracted_price: 53688 },
                link: 'https://book.example/bunk',
              },
            ],
          },
        ],
      },
    };
    let postedBody: Record<string, unknown> | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, options?: RequestInit) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url.includes('/search/bookmarks') && options?.method === 'POST') {
          postedBody = JSON.parse(String(options.body)) as Record<string, unknown>;
          return success({ bookmark: { bookmarkCode: 'HTL-000123' }, created: true });
        }
        if (url.includes('/search/bookmarks')) return success([]);
        if (url.includes('/search/hotels/property')) return success(oddProperty);
        if (url.includes('/search/hotels?'))
          return success({
            search_information: { total_results: 1 },
            properties: [
              {
                name: 'Nest Hotel Singapore',
                property_token: 'tok-odd',
                extracted_hotel_class: 3,
                rating: 4.3,
                reviews: 69,
                check_in_time: '3:00 PM',
                check_out_time: '11:00 AM',
                city: 'Singapore',
                country: 'SG',
                images: [],
              },
            ],
          });
        return { ok: true, status: 200, json: async () => ({ success: true, data: {} }) };
      }),
    );

    const user = userEvent.setup();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryProvider client={client}>
        <TravelSearchPage />
      </QueryProvider>,
    );
    await user.click(screen.getByRole('tab', { name: 'Hotels' }));
    const dest = screen.getByLabelText('Destination');
    await user.clear(dest);
    await user.type(dest, 'Singapore');
    await user.type(screen.getByLabelText('Check-in date'), '2026-09-30');
    await user.type(screen.getByLabelText('Check-out date'), '2026-10-05');
    await user.click(screen.getByRole('button', { name: 'Search hotels' }));
    await waitFor(() => expect(screen.getAllByText('Nest Hotel Singapore').length).toBeGreaterThan(0));
    await user.click(screen.getAllByRole('button', { name: /View Rooms & Offers/i })[0]!);
    const dialog = await screen.findByRole('dialog');

    // Room still renders as room-level (name intact), without a beds line.
    expect(await within(dialog).findByText('Bunk Bed')).toBeInTheDocument();
    expect(within(dialog).queryByText(/beds? bed/i)).not.toBeInTheDocument();

    await user.click(within(dialog).getAllByRole('button', { name: 'Bookmark' })[0]!);
    await waitFor(() => expect(postedBody).toBeDefined());
    const hotel = (postedBody!.snapshot as Record<string, unknown>).hotel as Record<string, unknown>;
    const selectedRoom = hotel.selectedRoom as Record<string, unknown>;
    expect(selectedRoom.roomName).toBe('Bunk Bed');
    // Malformed beds never reach the snapshot (previously poisoned hotel.rooms[]).
    expect(selectedRoom.beds).toBeNull();
    // No mutation error banner.
    expect(within(dialog).queryByText(/Something went wrong/)).not.toBeInTheDocument();
  });
});
