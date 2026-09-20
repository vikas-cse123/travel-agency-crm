import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/api/client';

export interface CallRecordingListItem {
  id: string;
  direction: string;
  phone: string;
  startedAt: string;
  endedAt: string | null;
  durationSeconds: number | null;
  matchStatus: string;
  recordingStatus: string;
  query: { id: string; queryNumber: string; customerName: string } | null;
  customer: { id: string; displayName: string } | null;
  recording: { id: string; mimeType: string; sizeBytes: number; uploadedAt: string } | null;
}

export function useCallRecordings(params: Record<string, string | undefined>) {
  return useQuery({
    queryKey: ['call-recordings', params],
    queryFn: async ({ signal }) => {
      const clean = Object.fromEntries(Object.entries(params).filter(([, v]) => v != null && v !== ''));
      const qs = new URLSearchParams(clean as Record<string, string>).toString();
      const path = qs ? `/call-recordings?${qs}` : '/call-recordings';
      return apiClient.get<{ data: CallRecordingListItem[]; total: number }>(path, signal);
    },
  });
}

export async function fetchCallRecordingPlayUrl(callId: string): Promise<{ url: string; expiresAt: string }> {
  return apiClient.get<{ url: string; expiresAt: string }>(`/call-recordings/${callId}/play`);
}
