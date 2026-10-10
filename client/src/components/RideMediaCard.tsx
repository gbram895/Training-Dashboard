import { useEffect, useState } from 'react';
import { apiFetch, getToken } from '../api/client';
import useConfirm from './useConfirm';

/**
 * Screenshots and recordings IndoorWarior took during this ride, each one a
 * download. The files need the login token, so they are fetched here and
 * shown from object URLs rather than linked directly. Nothing renders for a
 * workout without any.
 */
type Media = { id: string; takenAt: string; kind: 'photo' | 'video'; mime: string; size: number };
type Loaded = Media & { url: string | null };

function sizeLabel(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

async function blobOf(id: string): Promise<Blob> {
  const res = await fetch(`/api/media/${id}/file`, { headers: { Authorization: `Bearer ${getToken()}` } });
  if (!res.ok) throw new Error(res.statusText);
  return res.blob();
}

function fileName(m: Media): string {
  const ext = m.mime === 'image/png' ? 'png' : m.mime === 'image/jpeg' ? 'jpg' : m.mime === 'video/mp4' ? 'mp4' : 'webm';
  return `indoorwarior-${m.takenAt.slice(0, 19).replace(/[:T]/g, '-')}.${ext}`;
}

export default function RideMediaCard({ workoutId }: { workoutId: string }) {
  const [items, setItems] = useState<Loaded[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [confirm, confirmSheet] = useConfirm();

  useEffect(() => {
    let cancelled = false;
    const urls: string[] = [];
    apiFetch<{ items: Media[] }>(`/media?workoutId=${encodeURIComponent(workoutId)}`)
      .then(async ({ items: list }) => {
        if (cancelled) return;
        setItems(list.map((m) => ({ ...m, url: null })));
        // Photos are small enough to show straight away; recordings load on
        // demand, since one can be tens of megabytes.
        for (const m of list.filter((x) => x.kind === 'photo')) {
          const url = URL.createObjectURL(await blobOf(m.id));
          if (cancelled) return URL.revokeObjectURL(url);
          urls.push(url);
          setItems((prev) => prev.map((p) => (p.id === m.id ? { ...p, url } : p)));
        }
      })
      .catch(() => !cancelled && setError('Could not load the ride’s screenshots.'));
    return () => {
      cancelled = true;
      urls.forEach((u) => URL.revokeObjectURL(u));
    };
  }, [workoutId]);

  async function download(m: Loaded) {
    try {
      const url = m.url ?? URL.createObjectURL(await blobOf(m.id));
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName(m);
      document.body.appendChild(a);
      a.click();
      a.remove();
      if (!m.url) setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch {
      setError('That download failed. Try again.');
    }
  }

  async function remove(m: Loaded) {
    const what = m.kind === 'video' ? 'recording' : 'screenshot';
    if (!(await confirm({ title: `Delete this ${what}?`, confirmLabel: 'Delete' }))) return;
    try {
      await apiFetch(`/media/${m.id}`, { method: 'DELETE' });
      if (m.url) URL.revokeObjectURL(m.url);
      setItems((prev) => prev.filter((p) => p.id !== m.id));
    } catch {
      setError('Could not delete it. Try again.');
    }
  }

  if (!items.length && !error) return null;
  return (
    <div className="gd-set-group">
      <p className="gd-set-group-label">Screenshots and recordings</p>
      {error && <p className="gd-set-note gd-set-danger">{error}</p>}
      <div className="gd-media-grid">
        {items.map((m) => (
          <div key={m.id} className="gd-media-item">
            {m.kind === 'photo' ? (
              m.url ? <img src={m.url} alt="Screenshot from the ride" /> : <div className="gd-media-blank" />
            ) : (
              <div className="gd-media-blank gd-media-video">Recording · {sizeLabel(m.size)}</div>
            )}
            <div className="gd-media-actions">
              <button type="button" className="secondary" onClick={() => download(m)}>
                Download
              </button>
              <button type="button" className="secondary" onClick={() => remove(m)}>
                Delete
              </button>
            </div>
          </div>
        ))}
      </div>
      {confirmSheet}
    </div>
  );
}
