import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/api/client';
import type {
  QuotationInput,
  QuotationSendInput,
  QuotationTemplateInput,
  QuotationTemplateUpdate,
  QuotationUpdate,
  QuotationVersionUpdate,
  WeblinkProfileConfig,
} from '@interscale/shared';

export interface PersonRef {
  id: string;
  fullName: string;
  username: string;
}
export interface TemplateItinerary {
  id: string;
  dayNumber: number;
  date?: string | null;
  title: string;
  destination: string;
  description: string;
  meals: string | null;
  overnightLocation: string | null;
  activities: string | null;
  transfers: string | null;
  notes: string | null;
  sequence: number;
}
/** Optional links to travel masters; the snapshot fields below still render. */
export interface MasterHotelRefs {
  hotelId?: string | null;
  hotelRoomTypeId?: string | null;
  hotelMealPlanId?: string | null;
}
export interface MasterServiceRefs {
  airlineId?: string | null;
  cruiseId?: string | null;
  cruiseRoomTypeId?: string | null;
  vehicleId?: string | null;
  sightseeingId?: string | null;
  addOnServiceId?: string | null;
}
export interface QuotationSnapshotImage {
  /** Opaque id for a persisted snapshot image. */
  id?: string | null;
  /** Transient Master selector used only before the first save. */
  masterImageId?: string | null;
  url?: string | null;
  thumbnailUrl?: string | null;
  alt?: string | null;
}
export interface TemplateHotel extends MasterHotelRefs {
  id: string;
  city: string;
  hotelName: string;
  category: string | null;
  roomType: string | null;
  mealPlan: string | null;
  rooms: number | null;
  extraBedQuantity?: number | null;
  childWithoutBedQuantity?: number | null;
  nights: number;
  checkInDate: string | null;
  checkOutDate: string | null;
  checkInTime: string | null;
  checkOutTime: string | null;
  showCheckInTime: boolean | null;
  showCheckOutTime: boolean | null;
  internalCost?: string;
  sellingPrice: string | null;
  selected: boolean;
  notes: string | null;
  sequence: number;
  images?: QuotationSnapshotImage[];
  imageSnapshotPresent?: boolean;
  pdfImageUrl?: string | null;
  /** Multi-room allocations / meal plans inside ONE hotel option (JSON arrays). */
  roomLines?: Array<Record<string, unknown>> | null;
  mealPlanLines?: Array<Record<string, unknown>> | null;
}
export interface TemplateService extends MasterServiceRefs {
  id: string;
  serviceType: string;
  name: string;
  description: string | null;
  dayNumber: number | null;
  city: string | null;
  quantity: string;
  internalCost?: string;
  sellingPrice: string | null;
  pricingBasis?: string | null;
  pricingBasisLabel?: string | null;
  /**
   * Quotation-owned snapshot of every master pricing option available when an
   * add-on was selected. Nullish for legacy rows and other service types.
   */
  pricingSnapshot?: Array<{
    id?: string;
    label?: string | null;
    price?: number | null;
    currency?: string | null;
  }> | null;
  taxCategory: string | null;
  notes: string | null;
  /** Vehicle "Duration" free text, independent from `notes` (Usage). */
  duration?: string | null;
  images?: QuotationSnapshotImage[];
  imageSnapshotPresent?: boolean;
  pdfImageUrl?: string | null;
  sequence: number;
}
export interface ContentRow {
  id: string;
  content: string;
  sequence: number;
}
export interface QuotationTemplate {
  id: string;
  templateCode: string;
  name: string;
  description: string | null;
  destinationSummary: string;
  durationDays: number;
  durationNights: number;
  baseCurrency: string;
  adultBasePrice: string | null;
  childWithBedBasePrice: string | null;
  childWithoutBedBasePrice: string | null;
  infantBasePrice: string | null;
  status: 'ACTIVE' | 'INACTIVE';
  usageCount: number;
  internalNotes?: string | null;
  createdAt: string;
  updatedAt: string;
  createdBy: PersonRef;
  cities?: string[];
  itinerary: TemplateItinerary[];
  hotels: TemplateHotel[];
  services: TemplateService[];
  inclusions: ContentRow[];
  exclusions: ContentRow[];
  terms: ContentRow[];
  actionPermissions?: { canUpdate: boolean; canDelete: boolean; canUse: boolean };
  counts?: { cities: number; services: number; hotelOptions: number };
}
export interface FlightSegment {
  airlineId?: string | null;
  airlineName?: string | null;
  flightNumber?: string | null;
  travelClass?: string | null;
  from?: string | null;
  to?: string | null;
  departureDate?: string | null;
  departureTime?: string | null;
  arrivalDate?: string | null;
  arrivalTime?: string | null;
  duration?: string | null;
  cabinLuggage?: string | null;
  checkInLuggage?: string | null;
  notes?: string | null;
  connectionVia?: string | null;
}
export interface FlightJourney {
  fromCity?: string | null;
  toCity?: string | null;
  /** Independently editable header route; falls back to fromCity/toCity when absent. */
  routeFrom?: string | null;
  routeTo?: string | null;
  travelClass?: string | null;
  segments: FlightSegment[];
}
export interface FlightJourneyRecord {
  bookmarkCode?: string | null;
  journeyType: 'ROUND_TRIP' | 'ONEWAY_OUTBOUND' | 'ONEWAY_RETURN';
  outbound: FlightJourney;
  returnJourney: FlightJourney;
}
export interface FlightDetails {
  include: boolean;
  sectionTitle?: string | null;
  amount?: number | null;
  entryMode?: 'MANUAL' | 'IMAGE';
  imageDocumentId?: string | null;
  imageFileName?: string | null;
  images?: Array<{
    documentId: string;
    fileName?: string | null;
    description?: string | null;
    heading?: string | null;
  }>;
  journeyType: 'ROUND_TRIP' | 'ONEWAY_OUTBOUND' | 'ONEWAY_RETURN';
  outbound: FlightJourney;
  returnJourney: FlightJourney;
  /** Every flight in the section, in display order (legacy rows wrap into one). */
  flights?: FlightJourneyRecord[];
}
export interface HotelDetails {
  include?: boolean;
  sectionTitle?: string | null;
  amount?: number | null;
  description?: string | null;
  /** Snapshot images copied from a hotel bookmark (plain URLs). */
  images?: Array<{ url: string; alt?: string | null }>;
  /** The image chosen as the single PDF photo; falls back to the first. */
  pdfImageUrl?: string | null;
}
export interface SightseeingActivity {
  sightseeingId?: string | null;
  imageDocumentId?: string | null;
  name?: string | null;
  startTime?: string | null;
  showTime?: boolean;
  duration?: string | null;
  city?: string | null;
  description?: string | null;
  imageUrl?: string | null;
  images?: QuotationSnapshotImage[];
  imageSnapshotPresent?: boolean;
  pdfImageUrl?: string | null;
  /** Informational per-activity prices; absent on pre-feature snapshots. */
  pricingOptions?: Array<{ label: string; price: number }>;
  sequence?: number | null;
}
export type SightseeingMealMode = 'NO_TRANSFER' | 'INCLUDE_AT_HOTEL' | 'WITH_TRANSFER';
export interface SightseeingMealPreference {
  mode: SightseeingMealMode;
  transferDetails?: string | null;
}
export interface SightseeingMealPreferences {
  breakfast?: SightseeingMealPreference;
  lunch?: SightseeingMealPreference;
  dinner?: SightseeingMealPreference;
}
export interface SightseeingDay {
  dayNumber: number;
  title?: string | null;
  titleTouched?: boolean;
  city?: string | null;
  date?: string | null;
  meals: { breakfast: boolean; lunch: boolean; dinner: boolean };
  mealMode: SightseeingMealMode;
  mealPreferences?: SightseeingMealPreferences;
  dailyTransfer: 'PRIVATE' | 'SHARED' | 'NO_TRANSFER';
  activities: SightseeingActivity[];
}
export interface SightseeingDetails {
  include: boolean;
  sectionTitle?: string | null;
  amount?: number | null;
  description?: string | null;
  days: SightseeingDay[];
}
export interface QuotationVersion {
  id: string;
  versionNumber: number;
  title: string;
  introduction: string | null;
  weblinkHeading: string | null;
  packageHeading: string | null;
  weblinkDurationText: string | null;
  weblinkProfileDestination: string | null;
  // Per-item label/value/visibility overrides for the public weblink profile
  // information card. Null/absent renders the fully automatic card.
  weblinkProfile?: WeblinkProfileConfig | null;
  destinationSummary: string;
  travelStartDate: string | null;
  travelEndDate: string | null;
  currency: string;
  subtotalSellingPrice: string;
  subtotalCost?: string;
  markupMode: string;
  markupValue: string;
  totalMarkup: string;
  taxRate: string;
  taxAmount: string;
  discountAmount: string;
  finalAmount: string;
  marginAmount?: string;
  marginPercentage?: string;
  pricingMode: string;
  // Reference "Summary & Pricing" — per-passenger package pricing.
  perAdultPrice: string;
  perChildWithBedPrice: string;
  perChildWithoutBedPrice: string;
  perInfantPrice: string;
  // Additional Price Items — flat package charges for By Traveler pricing.
  packageCustomItems?: Array<{ id?: string; label: string; amount: number }> | null;
  taxNote: string | null;
  netAmount?: string;
  initialPaymentAmount: string;
  paymentLink: string | null;
  showServiceChargesSeparately: boolean;
  markServiceChargesOutside: boolean;
  hidePricing: boolean;
  showIndividualPricing: boolean;
  showQuickNav?: boolean;
  quickNavSticky?: boolean;
  // Reference "Inclusions & Exclusions" — rich-text blocks.
  inclusionsHtml: string | null;
  exclusionsHtml: string | null;
  paymentPolicies: string | null;
  cancellationPolicies: string | null;
  bookingTerms: string | null;
  childPolicy: string | null;
  // Reference "Visa" — single dedicated section.
  includeVisa: boolean;
  visaSectionTitle: string | null;
  visaAmount: string;
  visaDestination: string | null;
  visaType: string | null;
  visaServiceCharge: string;
  visaGstPercent: string;
  visaVfsCharge: string;
  // Reference "Flight" — structured journeys/segments (JSON).
  flightDetails: FlightDetails | null;
  // Reference "Hotel" — editable section metadata (JSON).
  hotelDetails: HotelDetails | null;
  // Reference "Add-on Services" — top-level include flag (JSON).
  addOnDetails: { include?: boolean; sectionTitle?: string | null } | null;
  // Reference "Sightseeing" — day-wise activity itinerary (JSON).
  sightseeingDetails: SightseeingDetails | null;
  // Weblink customization — FAQs and custom section order.
  faqs?: Array<{ question: string; answer: string }>;
  weblinkSectionOrder?: string[] | null;
  destinationExpertConfig?: {
    enabled: boolean;
    expertUserId?: string | null;
    heading?: string | null;
    customIntroduction?: string | null;
    showWhatsapp?: boolean;
    showCall?: boolean;
    showEmail?: boolean;
    showExperience?: boolean;
    showTripsPlanned?: boolean;
    showLanguages?: boolean;
  } | null;
  notes: string | null;
  internalNotes?: string | null;
  status: string;
  pricingHeading: string;
  pricingSubheading: string | null;
  pricingDisplayOrder: string[] | null;
  pricingRowOrder?: string[] | null;
  finalizedAt: string | null;
  createdAt: string;
  createdBy: PersonRef;
  itinerary: TemplateItinerary[];
  hotels: TemplateHotel[];
  services: Array<
    TemplateService & {
      unitSellingPrice: string;
      totalSellingPrice: string;
      unitCost?: string;
      totalCost?: string;
    }
  >;
  inclusions: ContentRow[];
  exclusions: ContentRow[];
  terms: ContentRow[];
}
export interface QuotationDocument {
  id: string;
  quotationVersionId: string | null;
  fileName: string;
  mimeType: string;
  fileSize: number;
  checksum: string | null;
  documentType: string;
  status: string;
  createdAt: string;
}
export interface Quotation {
  id: string;
  quotationNumber: string;
  queryId: string;
  customer: { id: string; customerNumber: string; displayName: string } | null;
  currentVersionId: string | null;
  acceptedVersionId: string | null;
  status: string;
  customerName: string;
  customerEmail: string | null;
  customerPhone: string;
  destinationSummary: string;
  travelStartDate: string | null;
  travelEndDate: string | null;
  adults: number;
  childrenWithBed: number;
  childrenWithoutBed: number;
  infants: number;
  rooms: number;
  currency: string;
  /** Traveller names carried from the lead (or edited on the quotation). Null when unset. */
  adultNames?: string[] | null;
  childWithBedNames?: string[] | null;
  childWithoutBedNames?: string[] | null;
  infantNames?: string[] | null;
  validUntil: string | null;
  publicSlug: string | null;
  /** Resolved friendly-slug base URL (ACTIVE custom domain, else apex). */
  publicSlugBaseUrl: string;
  firstSentAt: string | null;
  lastSentAt: string | null;
  firstViewedAt: string | null;
  lastViewedAt: string | null;
  acceptedAt: string | null;
  rejectedAt: string | null;
  rejectionReason: string | null;
  createdAt: string;
  updatedAt: string;
  createdBy: PersonRef;
  query: {
    id: string;
    queryNumber: string;
    leadStage: string;
    assignedToId: string | null;
    createdById: string;
    departureCity: string | null;
    departureCountry: string | null;
    services?: Array<{ serviceType: string }>;
    itinerary?: Array<{
      id: string;
      country: string;
      destination: string;
      nights: number;
      sequence: number;
      arrivalDate: string | null;
      departureDate: string | null;
    }>;
  };
  versions: QuotationVersion[];
  documents: QuotationDocument[];
  emailLogs: EmailLog[];
  activityTimeline?: Array<{
    id: string;
    action: string;
    metadata: unknown;
    createdAt: string;
    actorUser: PersonRef | null;
  }>;
  booking: { id: string; bookingNumber: string; bookingStatus: string } | null;
}
export interface EmailLog {
  id: string;
  quotationVersionId: string;
  recipientEmail: string;
  cc: string | null;
  subject: string;
  status: string;
  sentAt: string | null;
  failureReason: string | null;
  createdAt: string;
  sentBy: PersonRef;
}
export interface Page<T> {
  data: T[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
}
export interface QuotationPage extends Page<Quotation> {
  analytics: { byStatus: Record<string, number>; totalQuotedValue: string; acceptanceRate: number };
}

export const quotationKeys = {
  templates: ['quotation-templates'] as const,
  templateList: (query: string) => ['quotation-templates', 'list', query] as const,
  template: (id: string) => ['quotation-templates', id] as const,
  templatePreview: (id: string) => ['quotation-templates', id, 'preview'] as const,
  quotations: ['quotations'] as const,
  quotationList: (query: string) => ['quotations', 'list', query] as const,
  quotation: (id: string) => ['quotations', id] as const,
};

export function useQuotationTemplates(params = new URLSearchParams()) {
  const query = params.toString();
  return useQuery({
    queryKey: quotationKeys.templateList(query),
    queryFn: ({ signal }) =>
      apiClient.get<Page<QuotationTemplate>>(
        `/quotation-templates${query ? `?${query}` : ''}`,
        signal,
      ),
  });
}
export function useQuotationTemplate(id?: string, preview = false) {
  return useQuery({
    queryKey: preview ? quotationKeys.templatePreview(id ?? '') : quotationKeys.template(id ?? ''),
    queryFn: ({ signal }) =>
      apiClient.get<QuotationTemplate>(
        `/quotation-templates/${id}${preview ? '/preview' : ''}`,
        signal,
      ),
    enabled: Boolean(id),
  });
}
export function useSaveQuotationTemplate(id?: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: QuotationTemplateInput | QuotationTemplateUpdate) =>
      id
        ? apiClient.patch<QuotationTemplate>(`/quotation-templates/${id}`, input)
        : apiClient.post<QuotationTemplate>('/quotation-templates', input),
    onSuccess: (data) => {
      void client.invalidateQueries({ queryKey: quotationKeys.templates });
      client.setQueryData(quotationKeys.template(data.id), data);
    },
  });
}
export function useTemplateAction() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      action,
      body,
    }: {
      id: string;
      action: 'duplicate' | 'status' | 'delete';
      body?: unknown;
    }) =>
      action === 'delete'
        ? apiClient.delete(`/quotation-templates/${id}`)
        : action === 'status'
          ? apiClient.patch(`/quotation-templates/${id}/status`, body)
          : apiClient.post<QuotationTemplate>(`/quotation-templates/${id}/duplicate`),
    onSuccess: () => void client.invalidateQueries({ queryKey: quotationKeys.templates }),
  });
}
export function useQuotations(params = new URLSearchParams()) {
  const query = params.toString();
  return useQuery({
    queryKey: quotationKeys.quotationList(query),
    queryFn: ({ signal }) =>
      apiClient.get<QuotationPage>(`/quotations${query ? `?${query}` : ''}`, signal),
  });
}
export function useQuotation(id?: string) {
  return useQuery({
    queryKey: quotationKeys.quotation(id ?? ''),
    queryFn: ({ signal }) => apiClient.get<Quotation>(`/quotations/${id}`, signal),
    enabled: Boolean(id),
  });
}
export function useCreateQuotation() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: QuotationInput) => apiClient.post<Quotation>('/quotations', input),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: quotationKeys.quotations });
      // The Leads table shows the linked quotation's amount/margin, so a new
      // quotation must refresh the lead list as well.
      void client.invalidateQueries({ queryKey: ['queries'] });
    },
  });
}
/**
 * Result of provisioning a public weblink. `url` is the customer-facing link;
 * `staffViewUrl` (present only when the request opted in with `staffView: true`)
 * is the same link plus a short-lived signed signal that marks the visit HOME,
 * used for the CRM's own Open/Preview actions.
 */
export interface PublicLinkPayload {
  url: string;
  staffViewUrl?: string;
  expiresAt?: string | null;
  versionId?: string;
  reused?: boolean;
}

export function useQuotationAction(id: string) {
  const client = useQueryClient();
  const refresh = () => {
    void client.invalidateQueries({ queryKey: quotationKeys.quotation(id) });
    void client.invalidateQueries({ queryKey: quotationKeys.quotations });
    // Finalize/duplicate/delete change what the Leads table shows for the
    // linked lead (quotation, amount, margin), so refresh it too.
    void client.invalidateQueries({ queryKey: ['queries'] });
  };
  return useMutation({
    mutationFn: ({
      path,
      method = 'post',
      body,
    }: {
      path: string;
      method?: 'get' | 'post' | 'patch' | 'delete';
      body?: unknown;
    }) =>
      method === 'get'
        ? apiClient.get(`/quotations/${id}/${path}`)
        : method === 'delete'
          ? apiClient.delete(`/quotations/${id}/${path}`)
          : method === 'patch'
            ? apiClient.patch(`/quotations/${id}/${path}`, body)
            : apiClient.post(`/quotations/${id}/${path}`, body),
    onSuccess: refresh,
  });
}
/**
 * Generate the PDF for an exact quotation version, then resolve a short-lived
 * download URL for it. Two server calls, one user action: the button stays in a
 * single loading state until a real, openable PDF URL is ready. Returns the URL
 * plus the server-sanitised filename so the caller can open or download it.
 */
export function useGenerateQuotationPdf(quotationId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      versionId: string;
      style: 'CLASSIC' | 'STYLISH' | 'WEBLINK';
      coverSource?: 'DESTINATION' | 'UPLOAD';
      coverImageDataUrl?: string;
      page1HeroImageDataUrl?: string;
      page1CardImageDataUrls?: Array<string | null | undefined>;
    }) => {
      // force: true — an explicit "Generate PDF" always produces a fresh
      // document so the latest destination image / footer is included.
      const document = await apiClient.post<{ id: string; fileName: string }>(
        `/quotations/${quotationId}/versions/${input.versionId}/generate-pdf`,
        {
          force: true,
          style: input.style,
          ...(input.style === 'STYLISH' ? { coverSource: input.coverSource ?? 'DESTINATION' } : {}),
          ...(input.coverImageDataUrl ? { coverImageDataUrl: input.coverImageDataUrl } : {}),
          ...(input.page1HeroImageDataUrl
            ? { page1HeroImageDataUrl: input.page1HeroImageDataUrl }
            : {}),
          ...(input.page1CardImageDataUrls?.some(Boolean)
            ? { page1CardImageDataUrls: input.page1CardImageDataUrls }
            : {}),
        },
      );
      const { url } = await apiClient.get<{ url: string }>(
        `/quotations/${quotationId}/documents/${document.id}/download-url?disposition=inline`,
      );
      return { url, fileName: document.fileName };
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: quotationKeys.quotation(quotationId) });
    },
  });
}
export function useUpdateQuotationVersion(quotationId: string, versionId: string) {  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: QuotationVersionUpdate) =>
      apiClient.patch<QuotationVersion>(`/quotations/${quotationId}/versions/${versionId}`, input),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: quotationKeys.quotation(quotationId) });
      void client.invalidateQueries({ queryKey: quotationKeys.quotations });
      // Version edits change the final amount/margin shown in the Leads table.
      void client.invalidateQueries({ queryKey: ['queries'] });
    },
  });
}

/** Patch quotation-level fields (e.g. traveller names) without touching versions. */
export function useUpdateQuotation(quotationId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: QuotationUpdate) =>
      apiClient.patch<Quotation>(`/quotations/${quotationId}`, input),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: quotationKeys.quotation(quotationId) });
      void client.invalidateQueries({ queryKey: quotationKeys.quotations });
    },
  });
}

/** Toggle the weblink display flags (Quick Navigation) without a full edit. */
export function useUpdateQuotationWeblinkSettings(quotationId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({
      versionId,
      ...input
    }: {
      versionId: string;
      showQuickNav?: boolean;
      quickNavSticky?: boolean;
    }) =>
      apiClient.patch<QuotationVersion>(
        `/quotations/${quotationId}/versions/${versionId}/weblink-settings`,
        input,
      ),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: quotationKeys.quotation(quotationId) });
    },
  });
}

/** Set/clear the friendly Weblink Name (publicSlug). */
export function useUpdateQuotationWeblinkName(quotationId: string) {  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { publicSlug: string | null }) =>
      apiClient.patch<{ publicSlug: string | null }>(
        `/quotations/${quotationId}/weblink-name`,
        input,
      ),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: quotationKeys.quotation(quotationId) });
      void client.invalidateQueries({ queryKey: quotationKeys.quotations });
      // The Leads list renders the weblink URL (friendly when publicSlug exists),
      // so refresh its cache too or the WEBLINK column keeps showing the stale
      // token URL until the 30s staleTime elapses.
      void client.invalidateQueries({ queryKey: ['queries'] });
    },
  });
}

/**
 * Stylish PDF Page 1 selections (cover-only). Persisted per version so
 * regeneration reproduces the same hero + gallery cards.
 */
export type StylishPage1Slot = 'hero' | 'card-1' | 'card-2' | 'card-3';
export function useStylishPage1(quotationId: string, versionId: string | undefined) {
  return useQuery({
    queryKey: [...quotationKeys.quotation(quotationId), 'stylish-page1', versionId],
    queryFn: () =>
      apiClient.get(`/quotations/${quotationId}/versions/${versionId}/stylish-page1`),
    enabled: Boolean(versionId),
  });
}
export function useApproveStylishPage1(quotationId: string, versionId: string) {
  return useMutation({
    mutationFn: (input: { slot: StylishPage1Slot; fileName: string; mimeType: string; fileSize: number }) =>
      apiClient.post<{ uploadUrl: string; objectKey: string; expiresInSeconds: number }>(
        `/quotations/${quotationId}/versions/${versionId}/stylish-page1/${input.slot}/approve`,
        { fileName: input.fileName, mimeType: input.mimeType, fileSize: input.fileSize },
      ),
  });
}
export function useConfirmStylishPage1(quotationId: string, versionId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      slot: StylishPage1Slot;
      objectKey: string;
      fileName: string;
      mimeType: string;
      fileSize: number;
    }) =>
      apiClient.post(
        `/quotations/${quotationId}/versions/${versionId}/stylish-page1/${input.slot}/confirm`,
        input,
      ),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: quotationKeys.quotation(quotationId) });
    },
  });
}
export function useResetStylishPage1(quotationId: string, versionId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { slot: StylishPage1Slot }) =>
      apiClient.post(
        `/quotations/${quotationId}/versions/${versionId}/stylish-page1/${input.slot}/reset`,
        {},
      ),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: quotationKeys.quotation(quotationId) });
    },
  });
}
export function useSendQuotation(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: QuotationSendInput) =>
      apiClient.post<{ sent: boolean; publicUrl: string | null }>(`/quotations/${id}/send`, input),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: quotationKeys.quotation(id) });
      void client.invalidateQueries({ queryKey: quotationKeys.quotations });
    },
  });
}

/** Public weblink analytics for a quotation (authenticated, tenant-scoped). */
export interface WeblinkAnalyticsEntry {
  ipAddress: string;
  type: 'HOME' | 'EXTERNAL';
  views: number;
  firstViewedAt: string;
  lastViewedAt: string;
  browser: string | null;
  browserVersion: string | null;
  os: string | null;
  osVersion: string | null;
  deviceType: string | null;
  deviceVendor: string | null;
  deviceModel: string | null;
  country: string | null;
  region: string | null;
  city: string | null;
  isp: string | null;
  latitude: number | null;
  longitude: number | null;
  clientTimezone: string | null;
  language: string | null;
  languages: string | null;
  platform: string | null;
  userAgent: string | null;
  screenWidth: number | null;
  screenHeight: number | null;
  screenAvailWidth: number | null;
  screenAvailHeight: number | null;
  viewportWidth: number | null;
  viewportHeight: number | null;
  pixelRatio: number | null;
  colorDepth: number | null;
  orientation: string | null;
  cpuCores: number | null;
  deviceMemory: number | null;
  connectionType: string | null;
  connectionDownlink: number | null;
  connectionRtt: number | null;
  online: boolean | null;
  referrer: string | null;
  landingUrl: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  visitorId: string | null;
  maxScrollDepth: number | null;
  timeOnPageSeconds: number | null;
  ctaClicks: number | null;
}
export interface WeblinkAnalytics {
  totalViews: number;
  externalViews: number;
  homeIpViews: number;
  uniqueIps: number;
  entries: WeblinkAnalyticsEntry[];
}

/** Fetch weblink analytics for a quotation. */
export function useQuotationWeblinkAnalytics(quotationId: string | null) {
  return useQuery({
    queryKey: ['quotations', quotationId, 'weblink-analytics'],
    queryFn: ({ signal }) =>
      apiClient.get<WeblinkAnalytics>(`/quotations/${quotationId}/weblink-analytics`, signal),
    enabled: Boolean(quotationId),
    retry: false,
  });
}

export async function uploadQuotationAttachment(
  quotationId: string,
  file: File,
  quotationVersionId?: string,
) {
  const approved = await apiClient.post<{
    documentId: string;
    uploadUrl: string;
    requiredHeaders: Record<string, string>;
  }>(`/quotations/${quotationId}/uploads`, {
    fileName: file.name,
    mimeType: file.type,
    fileSize: file.size,
    documentType: 'SUPPORTING_ATTACHMENT',
    ...(quotationVersionId ? { quotationVersionId } : {}),
  });
  try {
    const response = await fetch(approved.uploadUrl, {
      method: 'PUT',
      headers: approved.requiredHeaders,
      body: file,
    });
    if (!response.ok) throw new Error('The storage provider rejected the upload.');
    await apiClient.post(`/quotations/${quotationId}/uploads/${approved.documentId}/confirm`);
    const { url } = await apiClient.get<{ url: string }>(
      `/quotations/${quotationId}/documents/${approved.documentId}/download-url?disposition=inline`,
    );
    return { documentId: approved.documentId, url };
  } catch (error) {
    // A failed direct PUT/confirmation must not leave a PENDING attachment that
    // consumes one of the quotation's limited attachment slots.
    await apiClient
      .delete(`/quotations/${quotationId}/documents/${approved.documentId}`)
      .catch(() => undefined);
    throw error;
  }
}

export async function quotationDocumentInlineUrl(quotationId: string, documentId: string) {
  const { url } = await apiClient.get<{ url: string }>(
    `/quotations/${quotationId}/documents/${documentId}/download-url?disposition=inline`,
  );
  return url;
}
