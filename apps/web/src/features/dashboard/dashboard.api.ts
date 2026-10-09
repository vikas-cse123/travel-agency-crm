import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/api/client';
import type { DashboardPeriod } from '@interscale/shared';

export interface DashboardCapabilities {
  canViewLeads: boolean;
  canViewQuotations: boolean;
  canViewBookings: boolean;
  canViewFinancials: boolean;
  canViewVendors: boolean;
  canViewVendorFinancials: boolean;
  canViewFollowUps: boolean;
}

export interface LeadSourceRow {
  source: string;
  label: string;
  count: number;
  percentage: number;
}
export interface DestinationRow {
  destination: string;
  enquiryCount: number;
}
export interface DestinationRevenueRow {
  destination: string;
  totalAmount: string;
}
export interface UpcomingTravelRow {
  id: string;
  customerName: string;
  travelDate: string;
  city: string;
  leadStage: string;
}
export interface UpcomingTravelSection {
  totalCount: number;
  items: UpcomingTravelRow[];
}
export interface StaffConversionRow {
  userId: string;
  displayName: string;
  totalLeads: number;
  convertedLeads: number;
  lostLeads: number;
  conversionRate: number;
  rank: number;
}
export interface StaffFinancialRow {
  userId: string;
  displayName: string;
  bookingCount: number;
  revenue: string;
  netRevenue: string;
  grossProfit: string;
  netProfit: string;
  marginPercentage: string;
  rank: number;
}

export interface DashboardAnalytics {
  period: { key: DashboardPeriod; from: string | null; to: string | null; timezone: string };
  capabilities: DashboardCapabilities;
  leads?: {
    totalLeads: number;
    convertedLeads: number;
    lostLeads: number;
    qualifiedLeads: number;
    hotLeads: number;
    quotationRequired: number;
    readyToBook: number;
    conversionRate: number;
    winRate: number;
  };
  quotations?: {
    totalQuotations: number;
    acceptedQuotations: number;
    rejectedQuotations: number;
    quotationAcceptanceRate: number;
  };
  bookings?: {
    totalBookings: number;
    confirmedBookings: number;
    pendingConfirmation: number;
    travelInProgress: number;
    completed: number;
    cancelled: number;
  };
  financials?: {
    totalCustomerAmount: string;
    totalPayable: string;
    customerPaymentsReceived: string;
    customerOutstanding: string;
    totalRefunded: string;
    netRevenue: string;
    totalCost: string;
    totalVendorOutstanding: string;
    grossProfit: string;
    netProfit: string;
    profitMarginPercentage: string;
  };
  leadSources?: LeadSourceRow[];
  topDestinations?: DestinationRow[];
  confirmedRevenueByDestination?: DestinationRevenueRow[];
  staffConversions?: StaffConversionRow[];
  staffFinancials?: StaffFinancialRow[];
}

export interface OperationsSection<T> {
  totalCount: number;
  items: T[];
  viewAllPath: string;
}
export interface DashboardOperations {
  capabilities: DashboardCapabilities;
  priorityFollowUps?: OperationsSection<Record<string, unknown>>;
  nearTravelDates?: OperationsSection<Record<string, unknown>>;
  upcomingTrips?: OperationsSection<Record<string, unknown>>;
  pendingCompletion?: OperationsSection<Record<string, unknown>>;
  clientPaymentsDue?: OperationsSection<Record<string, unknown>>;
  vendorPaymentsDue?: OperationsSection<Record<string, unknown>>;
}

export interface DashboardParams {
  period: DashboardPeriod;
  from?: string;
  to?: string;
  limit?: number;
}

function toQuery(params: DashboardParams) {
  const search = new URLSearchParams({ period: params.period });
  if (params.from) search.set('from', params.from);
  if (params.to) search.set('to', params.to);
  if (params.limit) search.set('limit', String(params.limit));
  return search.toString();
}

export function useDashboardAnalytics(params: DashboardParams) {
  const query = toQuery(params);
  return useQuery({
    queryKey: ['dashboard', 'analytics', query],
    queryFn: ({ signal }) =>
      apiClient.get<DashboardAnalytics>(`/dashboard/analytics?${query}`, signal),
  });
}

export function useDashboardOperations(params: DashboardParams) {
  const query = toQuery(params);
  return useQuery({
    queryKey: ['dashboard', 'operations', query],
    queryFn: ({ signal }) =>
      apiClient.get<DashboardOperations>(`/dashboard/operations?${query}`, signal),
  });
}

export interface UpcomingTravelParams {
  days?: '7' | '30' | '90';
  from?: string;
  to?: string;
  limit?: number;
}

export interface UpcomingTravelResponse {
  range: { from: string; to: string; timezone: string; days: '7' | '30' | '90' };
  confirmed: UpcomingTravelSection;
  others: UpcomingTravelSection;
}

function toTravelQuery(params: UpcomingTravelParams) {
  const search = new URLSearchParams({ days: params.days ?? '30' });
  if (params.from) search.set('from', params.from);
  if (params.to) search.set('to', params.to);
  if (params.limit) search.set('limit', String(params.limit));
  return search.toString();
}

export function useDashboardUpcomingTravel(params: UpcomingTravelParams) {
  const query = toTravelQuery(params);
  return useQuery({
    queryKey: ['dashboard', 'upcoming-travel', query],
    queryFn: ({ signal }) =>
      apiClient.get<UpcomingTravelResponse>(`/dashboard/upcoming-travel?${query}`, signal),
  });
}
