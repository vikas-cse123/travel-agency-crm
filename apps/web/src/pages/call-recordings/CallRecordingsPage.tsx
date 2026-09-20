import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Phone, Play, Pause, ExternalLink, Search } from 'lucide-react';
import { useCallRecordings, fetchCallRecordingPlayUrl } from '@/features/call-recordings/call-recordings.api';
import { Button } from '@/components/ui/Button';

function formatDuration(s: number | null | undefined) {
  if (s == null) return '—';
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

export function CallRecordingsPage() {
  const [search, setSearch] = useState('');
  const [direction, setDirection] = useState<string>('ALL');
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);

  const { data, isLoading, error } = useCallRecordings({ search: search || undefined, direction: direction !== 'ALL' ? direction : undefined });

  const handlePlay = async (callId: string) => {
    if (playingId === callId) {
      setPlayingId(null);
      setAudioUrl(null);
      return;
    }
    setLoadingId(callId);
    try {
      const { url } = await fetchCallRecordingPlayUrl(callId);
      setAudioUrl(url);
      setPlayingId(callId);
    } catch {
      setAudioUrl(null);
    } finally {
      setLoadingId(null);
    }
  };

  return (
    <div className="p-6">
      <h1 className="text-2xl font-semibold">Call Recordings</h1>
      <p className="text-sm text-slate-500">All calls with recordings available</p>
      <div className="mt-4 flex gap-3">
        <div className="relative">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
          <input
            placeholder="Search Lead ID, customer, phone"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 pr-3 py-2 border rounded-md text-sm"
          />
        </div>
        <select value={direction} onChange={(e) => setDirection(e.target.value)} className="border rounded-md px-3 py-2 text-sm">
          <option value="ALL">All directions</option>
          <option value="INCOMING">Incoming</option>
          <option value="OUTGOING">Outgoing</option>
        </select>
      </div>

      {isLoading && <p className="mt-6 text-sm text-slate-500">Loading...</p>}
      {error && <p className="mt-6 text-sm text-red-600">Failed to load</p>}
      {!isLoading && data?.data.length === 0 && <p className="mt-6 text-sm text-slate-500">No calls yet</p>}

      <div className="mt-6 grid gap-3">
        {data?.data.map((c) => (
          <div key={c.id} className="border rounded-lg p-4 flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2">
                <Phone className="h-4 w-4" />
                <span className="font-medium">{c.query?.customerName || c.customer?.displayName || c.phone}</span>
                <span className="text-xs text-slate-500">{c.query?.queryNumber || ''}</span>
              </div>
              <div className="text-xs text-slate-500">
                {c.phone} · {c.direction} · {new Date(c.startedAt).toLocaleString()} · {formatDuration(c.durationSeconds)}
              </div>
              <div className="text-xs">{c.recording ? 'Uploaded' : c.recordingStatus}</div>
              {playingId === c.id && audioUrl && (
                <audio controls autoPlay src={audioUrl} className="mt-2 w-80" onEnded={() => setPlayingId(null)} />
              )}
            </div>
            <div className="flex gap-2">
              {c.recording && (
                <Button size="sm" onClick={() => handlePlay(c.id)} disabled={loadingId === c.id}>
                  {playingId === c.id ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                  {loadingId === c.id ? 'Loading...' : playingId === c.id ? 'Pause' : 'Play'}
                </Button>
              )}
              {c.query && (
                <Link to={`/queries/${c.query.id}`}>
                  <Button size="sm" variant="secondary">
                    <ExternalLink className="h-4 w-4" /> Lead
                  </Button>
                </Link>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
