import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PublicQuotationView } from './PublicQuotationPage';

vi.mock('@/hooks/useFavicon', () => ({ useFavicon: () => undefined }));
vi.mock('@/hooks/useDocumentTitle', () => ({ useDocumentTitle: () => undefined }));

const data = () => ({
  company: {
    name: 'Alpha Travel',
    email: 'hello@alpha.example',
    phone: '+91 90000 00001',
    website: 'https://alpha.example',
    address: '14 Marina Road, Kochi',
    googleMapsUrl: null,
    primaryColor: '#2563eb',
    operatingSince: 2015,
    tripsSold: 4200,
    tan: 'ABCDE1234F',
  },
  quotation: {
    quotationNumber: 'QT-2026-000001',
    customerName: 'Aarav Mehta',
    destinationSummary: 'Singapore',
    destinations: 'Singapore',
    durationNights: 3,
    travelStartDate: '2026-09-10',
    travelEndDate: '2026-09-13',
    adults: 2,
    childrenWithBed: 0,
    childrenWithoutBed: 0,
    infants: 0,
    rooms: 1,
    childrenWithBedAges: null,
    childrenWithoutBedAges: null,
    infantAges: null,
    createdAt: '2026-07-21T00:00:00.000Z',
  },
  version: {
    title: 'Singapore Escape',
    introduction: null,
    destinationSummary: 'Singapore',
    currency: 'INR',
    finalAmount: 0,
    pricingMode: 'SECTION_WISE',
    pricingHeading: 'Price Breakdown',
    pricingSubheading: null,
    markupMode: 'NONE',
    markupValue: 0,
    taxRate: 0,
    discountAmount: 0,
    perAdultPrice: 0,
    perChildWithBedPrice: 0,
    perChildWithoutBedPrice: 0,
    perInfantPrice: 0,
    taxNote: null,
    netAmount: 0,
    initialPaymentAmount: 0,
    paymentLink: null,
    showServiceChargesSeparately: false,
    markServiceChargesOutside: false,
    hidePricing: false,
    showIndividualPricing: false,
    showQuickNav: true,
    quickNavSticky: false,
    inclusionsHtml: '<p>Full inclusion text for PDF.</p>',
    exclusionsHtml: '<p>Full exclusion text for PDF.</p>',
    paymentPolicies: '<p>Full payment text for PDF.</p>',
    cancellationPolicies: null,
    bookingTerms: null,
    childPolicy: null,
    includeVisa: false,
    visaSectionTitle: null,
    visaAmount: 0,
    visaDestination: null,
    visaType: null,
    visaServiceCharge: 0,
    visaGstPercent: 0,
    visaVfsCharge: 0,
    customCharges: [],
    flightDetails: {
      include: true,
      sectionTitle: 'Flight Details',
      entryMode: 'MANUAL',
      journeyType: 'ROUND_TRIP',
      outbound: {
        fromCity: 'Delhi',
        toCity: 'Singapore',
        segments: [
          {
            airlineName: 'Air India',
            flightNumber: 'AI101',
            from: 'DEL',
            to: 'SIN',
            departureDate: '2026-09-10',
            departureTime: '06:00',
          },
        ],
      },
      returnJourney: { fromCity: 'Singapore', toCity: 'Delhi', segments: [] },
      flights: [
        {
          journeyType: 'ROUND_TRIP',
          outbound: {
            fromCity: 'Delhi',
            toCity: 'Singapore',
            segments: [
              {
                airlineName: 'Air India',
                flightNumber: 'AI101',
                from: 'DEL',
                to: 'SIN',
                departureDate: '2026-09-10',
                departureTime: '06:00',
              },
            ],
          },
          returnJourney: { fromCity: 'Singapore', toCity: 'Delhi', segments: [] },
        },
      ],
    },
    hotelDetails: { include: true, sectionTitle: 'Your Hotels' },
    addOnDetails: { include: true },
    sightseeingDetails: {
      include: true,
      sectionTitle: 'Your Itinerary',
      days: [
        {
          dayNumber: 1,
          title: 'Universal studios',
          city: 'Singapore',
          date: null,
          meals: { breakfast: false, lunch: false, dinner: false },
          activities: [{ name: 'Universal studios', description: null }],
        },
      ],
    },
    notes: null,
    itinerary: [],
    services: [
      {
        id: 'svc-cruise-1',
        serviceType: 'CRUISE',
        name: 'Sunset Cruise',
        description: null,
        city: null,
        notes: null,
        quantity: '1',
        unitSellingPrice: '8000',
        totalSellingPrice: '8000',
        sellingPrice: '8000',
        sequence: 1,
        cruiseId: 'cruise-1',
        images: [],
      },
      {
        id: 'svc-vehicle-1',
        serviceType: 'VEHICLE_TRANSFER',
        name: 'Private Van',
        description: null,
        city: 'SUV',
        notes: null,
        quantity: '1',
        unitSellingPrice: '4000',
        totalSellingPrice: '4000',
        sellingPrice: '4000',
        sequence: 2,
        vehicleId: 'vehicle-1',
        images: [],
      },
      {
        id: 'svc-addon-1',
        serviceType: 'GUIDE',
        name: 'City Guide',
        description: null,
        city: null,
        notes: null,
        quantity: '1',
        unitSellingPrice: '2500',
        totalSellingPrice: '2500',
        sellingPrice: '2500',
        sequence: 3,
        addOnServiceId: 'addon-1',
        images: [],
      },
    ],
    hotels: [
      {
        id: 'hotel-1',
        city: 'Singapore',
        hotelName: 'Marina Bay Sands',
        category: null,
        roomType: 'Deluxe Room',
        mealPlan: 'Breakfast',
        rooms: 1,
        nights: 3,
        checkInDate: null,
        checkOutDate: null,
        checkInTime: null,
        checkOutTime: null,
        sellingPrice: 20000,
        selected: true,
        sequence: 1,
        images: [
          { url: 'https://files.example.test/hotel-first.jpg', alt: 'front' },
          { url: 'https://files.example.test/hotel-second.jpg', alt: 'pool' },
        ],
      },
    ],
    inclusions: [],
    exclusions: [],
    terms: [],
    faqs: [
      { question: 'Is pickup included?', answer: 'Yes, hotel pickup is included.' },
      { question: 'Can dates change?', answer: 'Yes, subject to availability.' },
    ],
  },
  heroImageUrl: null,
  hotelPresentations: {},
  vehiclePresentations: {},
  airlinePresentations: {},
  flightImages: [],
  flightImageUrl: null,
  sightseeingPresentations: {},
  sightseeingDocumentPresentations: {},
  cruisePresentations: {},
  destinationExpert: null,
  downloadUrl: null,
});

describe('Weblink PDF static mode', () => {
  it('expands every policy and FAQ without clicks and hides navigation', () => {
    render(<PublicQuotationView data={data() as never} pdfMode />);
    // All policy bodies visible immediately (second policy proves no interaction).
    expect(screen.getByText('Full inclusion text for PDF.')).toBeInTheDocument();
    expect(screen.getByText('Full exclusion text for PDF.')).toBeInTheDocument();
    expect(screen.getByText('Full payment text for PDF.')).toBeInTheDocument();
    // Every FAQ answer visible.
    expect(screen.getByText('Yes, hotel pickup is included.')).toBeInTheDocument();
    expect(screen.getByText('Yes, subject to availability.')).toBeInTheDocument();
    // No section navigator, no floating controls.
    expect(screen.queryByText('Jump to')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Back to top' })).not.toBeInTheDocument();
    // PDF marker for the print stylesheet and the browser pipeline.
    expect(document.querySelector('main[data-pdf-mode="weblink"]')).not.toBeNull();
  });

  it('shows only the first gallery image with no carousel controls', () => {
    render(<PublicQuotationView data={data() as never} pdfMode />);
    const first = screen.getByAltText('front') as HTMLImageElement;
    expect(first.getAttribute('src')).toBe('https://files.example.test/hotel-first.jpg');
    expect(screen.queryByAltText('pool')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Previous hotel image' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Next hotel image' })).not.toBeInTheDocument();
  });

  it('renders Services Include as a two-column grid in order in PDF mode', () => {
    render(<PublicQuotationView data={data() as never} pdfMode />);
    const grid = document.querySelector('.weblink-services-grid');
    expect(grid).not.toBeNull();
    const tiles = Array.from(grid!.children);
    expect(tiles.map((tile) => tile.textContent)).toEqual([
      expect.stringContaining('Flights'),
      expect.stringContaining('Hotels'),
      expect.stringContaining('Sightseeing'),
      expect.stringContaining('Cruise'),
      expect.stringContaining('Transportation'),
      expect.stringContaining('Add-ons'),
    ]);
  });

  it('hides the dark website footer in PDF mode but keeps contact content', () => {
    const { unmount } = render(<PublicQuotationView data={data() as never} pdfMode />);
    expect(screen.getByText('Contact Us')).toBeInTheDocument();
    expect(screen.getByText('Alpha Travel')).toBeInTheDocument();
    expect(screen.queryByText(/All rights reserved/)).not.toBeInTheDocument();
    unmount();
    render(<PublicQuotationView data={data() as never} />);
    expect(screen.getByText(/All rights reserved/)).toBeInTheDocument();
  });

  it('marks itinerary pagination hooks in PDF mode', () => {
    render(<PublicQuotationView data={data() as never} pdfMode />);
    // Activity gallery frame and Activities & Details header carry the hooks
    // the print stylesheet uses to keep images with their descriptions.
    expect(document.querySelector('.weblink-media-frame')).not.toBeNull();
    expect(
      screen.getByText('Activities & Details').classList.contains('weblink-activities-heading'),
    ).toBe(true);
    // Day heading/meta adhesion hook keeps headings with their cards.
    expect(document.querySelector('.weblink-day-meta')).not.toBeNull();
    // Whole-card pagination hooks (day, hotel, policy heading, contact card).
    expect(document.querySelector('.weblink-day-card')).not.toBeNull();
    expect(document.querySelector('.weblink-hotel-card')).not.toBeNull();
    expect(document.querySelector('.weblink-policy-heading')).not.toBeNull();
    expect(document.querySelector('.weblink-contact-card')).not.toBeNull();
  });

  it('leaves the interactive weblink unchanged without pdfMode', async () => {
    render(<PublicQuotationView data={data() as never} />);
    // Navigator and floating controls render normally.
    expect(screen.getByText('Jump to')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Back to top' })).toBeInTheDocument();
    // Policies stay collapsed until clicked (second policy hidden initially).
    expect(screen.queryByText('Full exclusion text for PDF.')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Exclusions/ }));
    expect(screen.getByText('Full exclusion text for PDF.')).toBeInTheDocument();
    // Carousel controls render normally.
    expect(screen.getByRole('button', { name: 'Next hotel image' })).toBeInTheDocument();
    expect(document.querySelector('main[data-pdf-mode]')).toBeNull();
    expect(within(document.body as HTMLElement).getByText('Jump to')).toBeInTheDocument();
  });
});
