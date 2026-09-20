import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderStylishQuotationPdf } from '../../apps/api/src/modules/quotations/stylish-pdf.service.js';

const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
const PNG_1PX_RED = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC',
  'base64',
);
const PNG_1PX_BLUE = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAACMBAQCB4a3yAAAAAElFTkSuQmCC',
  'base64',
);
const PNG_1PX_GREEN = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4D8AAACMBAQCBRi4rAAAAAElFTkSuQmCC',
  'base64',
);
const PNG_1PX_GOLD = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8DA8AMBAQCSH6rFAAAAAElFTkSuQmCC',
  'base64',
);

const company = {
  name: 'Travel Enfield',
  email: 'care@travelenfield.example',
  phone: '+91 91100 00001',
  website: 'https://travelenfield.example',
  address: null,
  primaryColor: '#17386f',
  operatingSinceYear: 2016,
  tripsSold: 1200,
  tan: 'ABCD12345E',
  taxRegistrationNumber: '29ABCDE1234F1Z5',
  logo: PNG_1PX_GOLD,
};
const consultant = { name: 'Aditi Rao', phone: '+911100000001', email: 'owner@interscale.local' };

const quotation = {
  quotationNumber: 'QT-SG-2531',
  customerName: 'Pintu Kumar',
  customerEmail: null,
  customerPhone: '+91 90000 00000',
  destinationSummary: 'Singapore',
  destinations: 'Singapore',
  travelStartDate: new Date('2026-10-05'),
  travelEndDate: new Date('2026-10-10'),
  adults: 2,
  childrenWithBed: 0,
  childrenWithoutBed: 0,
  infants: 0,
  rooms: 1,
  validUntil: null,
};

const sightseeingDetails = {
  include: true,
  sectionTitle: 'Sightseeing',
  amount: '0',
  description: null,
  days: [
    {
      dayNumber: 1,
      title: 'Day 1',
      city: 'Singapore',
      date: '2026-10-05',
      activities: [
        { name: 'Gardens by the Bay', sightseeingId: 'sight-1', description: 'Supertrees.' },
        { name: 'Marina Bay', sightseeingId: 'sight-1-dup', description: 'Bay views.' },
      ],
    },
    {
      dayNumber: 2,
      title: 'Day 2',
      city: 'Singapore',
      date: '2026-10-06',
      activities: [{ name: 'Merlion Park', sightseeingId: 'sight-2', description: 'Merlion.' }],
    },
    {
      dayNumber: 3,
      title: 'Day 3',
      city: 'Sentosa',
      date: '2026-10-07',
      activities: [{ name: 'Sentosa Cable Car', sightseeingId: 'sight-3', description: 'Cable car.' }],
    },
  ],
};

const version = {
  versionNumber: 1,
  title: 'Singapore Package',
  introduction: null,
  currency: 'INR',
  finalAmount: '100000',
  notes: null,
  perAdultPrice: '50000',
  perChildWithBedPrice: '0',
  perChildWithoutBedPrice: '0',
  perInfantPrice: '0',
  taxNote: null,
  initialPaymentAmount: '0',
  paymentLink: null,
  inclusionsHtml: null,
  exclusionsHtml: null,
  paymentPolicies: null,
  cancellationPolicies: null,
  bookingTerms: null,
  includeVisa: false,
  visaSectionTitle: null,
  visaAmount: '0',
  visaDestination: null,
  visaType: null,
  visaServiceCharge: '0',
  visaGstPercent: '0',
  visaVfsCharge: '0',
  flightDetails: { include: true, sectionTitle: 'Flights' },
  sightseeingDetails,
  hotels: [
    {
      city: 'Singapore',
      hotelName: 'Marina Bay Sands',
      category: '5',
      roomType: 'Deluxe',
      mealPlan: 'Breakfast',
      nights: 5,
      selected: true,
      notes: null,
    },
  ],
  itinerary: [],
  services: [{ serviceType: 'TRANSFER' }, { serviceType: 'CRUISE' }, { serviceType: 'ADD_ON' }],
  inclusions: [],
  exclusions: [],
  terms: [],
};

const imagesForCards = {
  sightseeing: {
    'sight-1': PNG_1PX,
    'sight-1-dup': PNG_1PX_RED,
    'sight-2': PNG_1PX_BLUE,
    'sight-3': PNG_1PX_GREEN,
  },
};

const main = async () => {
  const pdf = await renderStylishQuotationPdf({
    company,
    consultant,
    quotation,
    version,
    images: { cover: PNG_1PX_GOLD, ...imagesForCards },
  } as never);
  const dir = resolve(process.cwd(), 'tmp/footer-qa');
  mkdirSync(dir, { recursive: true });
  writeFileSync(resolve(dir, 'stylish.pdf'), pdf);
  console.log('wrote', resolve(dir, 'stylish.pdf'), pdf.length, 'bytes');
};

void main();
