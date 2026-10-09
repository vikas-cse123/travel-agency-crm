import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { PaymentCaseInput, PaymentInput } from '@interscale/shared';
import { apiClient } from '@/api/client';

export interface PaymentTrip {
  id: string;
  customerId: string | null;
  queryId: string | null;
  customerName: string;
  customerPhone: string | null;
  customerEmail: string | null;
  title: string;
  tripAmount: string | null;
  currency: string;
  collected: string;
  outstanding: string;
  paymentCount: number;
  status: string;
}

export interface PaymentTripPage {
  data: PaymentTrip[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
}

export interface TripPaymentRow {
  id: string;
  paymentNumber: string;
  amount: string | null;
  currency: string;
  paymentMethod: string;
  paymentStatus: string;
  receivedAt: string;
  referenceNumber: string | null;
  bankName: string | null;
  notes: string | null;
  createdAt: string;
  reversedAt: string | null;
  reversedById: string | null;
  reversalReason: string | null;
  recordedBy: { id: string; fullName: string } | null;
  reversedBy: { id: string; fullName: string } | null;
  receipt: { id: string; receiptNumber: string; uploadStatus: string } | null;
}

export interface PaymentTripDetails extends PaymentTrip {
  payments: TripPaymentRow[];
}

export interface LeadPaymentSuggestion {
  title: string;
  tripAmount: number | null;
  currency: string;
  quotationId: string | null;
  quotationNumber: string | null;
}

export interface LeadPaymentQuotation {
  id: string;
  quotationNumber: string;
  finalAmount: number | null;
  currency: string | null;
}

/** Server-resolved payment state for a lead. `case` is null when no payment
 * case exists yet (and none could be derived without user-supplied values). */
export interface LeadPaymentCaseState {
  lead: { id: string; queryNumber: string; customerName: string };
  quotation: LeadPaymentQuotation | null;
  suggestion: LeadPaymentSuggestion;
  requiresAmount: boolean;
  created?: boolean;
  case: PaymentTripDetails | null;
}

export interface LeadPaymentCaseInput {
  queryId: string;
  title?: string | null;
  tripAmount?: number | null;
  currency?: string | null;
}

export interface StandalonePayment {
  id: string;
  paymentNumber: string;
  amount: string | null;
  currency: string;
  paymentMethod: string;
  paymentStatus: string;
  receivedAt: string;
  referenceNumber: string | null;
  bankName: string | null;
  notes: string | null;
  createdAt: string;
  reversedAt: string | null;
  reversedById: string | null;
  reversalReason: string | null;
  recordedBy: { id: string; fullName: string } | null;
  reversedBy: { id: string; fullName: string } | null;
  receipt: { id: string; receiptNumber: string; uploadStatus: string } | null;
  paymentCase: PaymentTrip;
}

export interface StandalonePaymentDetails extends StandalonePayment {
  paymentCase: PaymentTrip;
}

export interface StandalonePaymentsLedger {
  data: StandalonePayment[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
  summary: {
    totalCollected: string;
    paymentCount: number;
    receivedToday: string;
    receivedThisMonth: string;
  };
}

export interface PaymentVoucher {
  id: string;
  receiptNumber: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  uploadStatus: string;
  visibility: string;
  createdAt: string;
  updatedAt: string;
  reused?: boolean;
}

export interface PaymentVoucherDownload {
  url: string;
  fileName: string;
  expiresInSeconds: number;
}

const keys = {
  all: ['standalone-payments'] as const,
  list: (query: string) => ['standalone-payments', query] as const,
  detail: (id: string) => ['standalone-payments', 'detail', id] as const,
  trips: (query: string) => ['standalone-payments', 'trips', query] as const,
  trip: (id: string) => ['standalone-payments', 'trip', id] as const,
};

function refresh(client: ReturnType<typeof useQueryClient>) {
  void client.invalidateQueries({ queryKey: keys.all });
}

export function usePaymentTrips(params = new URLSearchParams()) {
  return useQuery({
    queryKey: keys.trips(params.toString()),
    queryFn: ({ signal }) =>
      apiClient.get<PaymentTripPage>(`/payments/cases?${params.toString()}`, signal),
  });
}

export function usePaymentTrip(id?: string) {
  return useQuery({
    queryKey: keys.trip(id ?? ''),
    queryFn: ({ signal }) => apiClient.get<PaymentTripDetails>(`/payments/cases/${id}`, signal),
    enabled: Boolean(id),
  });
}

export function useCreatePaymentTrip() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: PaymentCaseInput) => apiClient.post<PaymentTrip>('/payments/cases', input),
    onSuccess: () => refresh(client),
  });
}

export function useStandalonePayments(params = new URLSearchParams()) {
  return useQuery({
    queryKey: keys.list(params.toString()),
    queryFn: ({ signal }) =>
      apiClient.get<StandalonePaymentsLedger>(`/payments?${params.toString()}`, signal),
  });
}

export function useStandalonePayment(id?: string) {
  return useQuery({
    queryKey: keys.detail(id ?? ''),
    queryFn: ({ signal }) => apiClient.get<StandalonePaymentDetails>(`/payments/${id}`, signal),
    enabled: Boolean(id),
  });
}

export function useRecordStandalonePayment() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: PaymentInput) => apiClient.post('/payments', input),
    onSuccess: () => refresh(client),
  });
}

export function useReverseStandalonePayment() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ paymentId, reason }: { paymentId: string; reason: string }) =>
      apiClient.post(`/payments/${paymentId}/reverse`, { reason }),
    onSuccess: () => refresh(client),
  });
}

export function useGeneratePaymentVoucher(paymentId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => apiClient.post<PaymentVoucher>(`/payments/${paymentId}/receipt`),
    onSuccess: () => refresh(client),
  });
}

export async function paymentVoucherDownloadUrl(
  paymentId: string,
): Promise<PaymentVoucherDownload> {
  return apiClient.get<PaymentVoucherDownload>(`/payments/${paymentId}/receipt/download-url`);
}

const leadCaseKey = (queryId: string) => ['standalone-payments', 'lead-case', queryId] as const;

/** Read-only payment state for a lead. Never creates a case. */
export function useLeadPaymentCase(queryId?: string, enabled = true) {
  return useQuery({
    queryKey: leadCaseKey(queryId ?? ''),
    queryFn: ({ signal }) =>
      apiClient.get<LeadPaymentCaseState>(`/payments/cases/by-lead/${queryId}`, signal),
    enabled: Boolean(queryId) && enabled,
  });
}

/** Find-or-create the payment case for a lead (derives from its quotation). */
export function useEnsureLeadPaymentCase() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: LeadPaymentCaseInput) =>
      apiClient.post<LeadPaymentCaseState>('/payments/cases/for-lead', input),
    onSuccess: (data) => {
      void client.invalidateQueries({ queryKey: leadCaseKey(data.lead.id) });
      refresh(client);
    },
  });
}
