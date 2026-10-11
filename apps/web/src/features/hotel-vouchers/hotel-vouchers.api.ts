import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { HotelVoucherInput, HotelVoucherUpdateInput } from '@interscale/shared';
import { apiClient } from '@/api/client';

export interface HotelVoucherRef {
  id: string;
  displayName?: string | null;
  name?: string | null;
  queryNumber?: string | null;
  customerName?: string | null;
  phone?: string | null;
  email?: string | null;
}

export interface HotelVoucherPricingRow {
  id: string;
  sequence: number;
  roomType: string;
  unit: number;
  quantity: number;
  gst: number | null;
  amount: number | null;
  taxablePay: number | null;
  gstService: number | null;
}

export interface HotelVoucherGuestRow {
  id: string;
  sequence: number;
  guestName: string;
  age: number | null;
  sex: 'M' | 'F';
  paxType: 'ADULT' | 'CHILD';
}

export interface HotelVoucherStayRoomRow {
  id: string;
  sequence: number;
  roomType: string;
  rooms: number;
  extraBedQuantity: number;
}

export interface HotelVoucherStayMealRow {
  id: string;
  sequence: number;
  mealPlan: string;
}

export interface HotelVoucherDocument {
  id: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  uploadStatus: string;
  visibility: string;
  createdAt: string;
  reused?: boolean;
}

export interface HotelVoucher {
  id: string;
  voucherNumber: string;
  issueDate: string | null;
  customerId: string | null;
  queryId: string | null;
  hotelId: string | null;
  guestName: string;
  guestPhone: string | null;
  guestEmail: string | null;
  adults: number;
  children: number;
  hotelName: string;
  hotelAddress: string | null;
  hotelCity: string | null;
  hotelPhone: string | null;
  hotelEmail: string | null;
  hotelStarRating: string | null;
  checkIn: string;
  checkOut: string;
  nights: number | null;
  roomTypeName: string | null;
  rooms: number;
  mealPlanName: string | null;
  confirmationNumber: string | null;
  bookingId: string | null;
  confirmationNumberLabel: string | null;
  bookingIdLabel: string | null;
  specialRequests: string | null;
  remarks: string | null;
  termsSnapshot: string | null;
  createdById?: string | null;
  createdBy?: { id: string; fullName: string } | null;
  createdAt: string;
  updatedAt: string;
  cancelledAt: string | null;
  customer?: HotelVoucherRef | null;
  query?: HotelVoucherRef | null;
  hotel?: HotelVoucherRef | null;
  documents?: HotelVoucherDocument[];
  pricing: HotelVoucherPricingRow[];
  guests: HotelVoucherGuestRow[];
  packageIncludes: string[];
  stayRooms: HotelVoucherStayRoomRow[];
  stayMeals: HotelVoucherStayMealRow[];
}

export interface HotelVoucherPage {
  data: HotelVoucher[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
}

const keys = {
  all: ['hotel-vouchers'] as const,
  list: (query: string) => ['hotel-vouchers', query] as const,
  detail: (id: string) => ['hotel-vouchers', 'detail', id] as const,
};

function invalidate(client: ReturnType<typeof useQueryClient>, id?: string) {
  void client.invalidateQueries({ queryKey: keys.all });
  if (id) void client.invalidateQueries({ queryKey: keys.detail(id) });
}

export function useHotelVouchers(params = new URLSearchParams()) {
  return useQuery({
    queryKey: keys.list(params.toString()),
    queryFn: ({ signal }) =>
      apiClient.get<HotelVoucherPage>(`/hotel-vouchers?${params.toString()}`, signal),
  });
}

export function useHotelVoucher(id?: string) {
  return useQuery({
    queryKey: keys.detail(id ?? ''),
    queryFn: ({ signal }) => apiClient.get<HotelVoucher>(`/hotel-vouchers/${id}`, signal),
    enabled: Boolean(id),
  });
}

export function useCreateHotelVoucher() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: HotelVoucherInput) =>
      apiClient.post<HotelVoucher>('/hotel-vouchers', input),
    onSuccess: (saved) => {
      client.setQueryData(keys.detail(saved.id), saved);
      invalidate(client);
    },
  });
}

export function useUpdateHotelVoucher(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: HotelVoucherUpdateInput) =>
      apiClient.patch<HotelVoucher>(`/hotel-vouchers/${id}`, input),
    onSuccess: (saved) => {
      client.setQueryData(keys.detail(id), saved);
      invalidate(client, id);
    },
  });
}

export function useDeleteHotelVoucher() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (voucherId: string) =>
      apiClient.delete<{ id: string }>(`/hotel-vouchers/${voucherId}`),
    onSuccess: (_, voucherId) => invalidate(client, voucherId),
  });
}

export function useGenerateHotelVoucherPdf(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => apiClient.post<HotelVoucherDocument>(`/hotel-vouchers/${id}/generate-pdf`),
    onSuccess: () => invalidate(client, id),
  });
}

export async function hotelVoucherDownloadUrl(
  voucherId: string,
  documentId: string,
): Promise<{ url: string; fileName: string; expiresInSeconds: number }> {
  return apiClient.get<{ url: string; fileName: string; expiresInSeconds: number }>(
    `/hotel-vouchers/${voucherId}/documents/${documentId}/download-url`,
  );
}
