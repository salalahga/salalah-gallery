import { useRef, useState } from 'react';
import { Camera, Trash2, Share2, Globe, Loader2 } from 'lucide-react';
import type { Photo } from '../core/types';
import { uid } from '../core/store';
import { storePhoto } from '../core/upload';
import { toast } from './ui';

/** Resize a picked/camera image to max `max` px and JPEG-compress it, so photos stay small in the database. */
export function compressImage(file: Blob, max = 1280, quality = 0.72): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url); resolve(c.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read this image')); };
    img.src = url;
  });
}

const KINDS: { id: Photo['kind']; label: string }[] = [{ id: 'before', label: 'Before' }, { id: 'progress', label: 'Progress' }, { id: 'after', label: 'After' }, { id: 'site', label: 'Site' }];

export function Photos({ photos, onChange, readOnly, onShare, onWebsite, kinds = ['before', 'progress', 'after'] }: {
  photos: Photo[]; onChange: (p: Photo[]) => void; readOnly?: boolean; onShare?: (p: Photo) => void; onWebsite?: (p: Photo) => void; kinds?: Photo['kind'][];
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [kind, setKind] = useState<Photo['kind']>(kinds[0]);
  const [busy, setBusy] = useState(false);
  const [big, setBig] = useState<Photo | null>(null);
  const add = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    try {
      const next = [...photos];
      for (const f of Array.from(files).slice(0, 10)) next.push({ id: uid(), url: await storePhoto(await compressImage(f)), kind, at: new Date().toISOString() });
      if (next.length > 30) toast('Keep it to about 30 photos per record');
      onChange(next.slice(0, 30));
    } catch (e) { toast((e as Error).message); } finally { setBusy(false); if (ref.current) ref.current.value = ''; }
  };
  return (
    <div className="photos">
      {!readOnly && <div className="flex wrap" style={{ marginBottom: 10 }}>
        {kinds.length > 1 && <div className="chips">{KINDS.filter((k) => kinds.includes(k.id)).map((k) => <button key={k.id} type="button" className={`chip ${kind === k.id ? 'on' : ''}`} onClick={() => setKind(k.id)}>{k.label}</button>)}</div>}
        <input ref={ref} type="file" accept="image/*" capture="environment" multiple hidden onChange={(e) => add(e.target.files)} />
        <button type="button" className="btn sm" disabled={busy} onClick={() => ref.current?.click()}>{busy ? <Loader2 size={14} className="spin" /> : <Camera size={14} />}Add {KINDS.find((k) => k.id === kind)?.label.toLowerCase()} photo</button>
      </div>}
      {photos.length ? <div className="photo-grid">{photos.map((p) => (
        <figure key={p.id}>
          <img src={p.url} alt={p.caption || p.kind} onClick={() => setBig(p)} loading="lazy" />
          <figcaption><span className={`badge tone-${p.kind === 'after' ? 'green' : p.kind === 'before' ? 'amber' : 'blue'}`}>{p.kind}</span>
            <span className="photo-actions">
              {onShare && <button type="button" className="icon-btn" title="Use in a social post" onClick={() => onShare(p)}><Share2 size={14} /></button>}
              {onWebsite && <button type="button" className="icon-btn" title="Add to website gallery" onClick={() => onWebsite(p)}><Globe size={14} /></button>}
              {!readOnly && <button type="button" className="icon-btn" title="Delete" onClick={() => onChange(photos.filter((x) => x.id !== p.id))}><Trash2 size={14} /></button>}
            </span></figcaption>
        </figure>))}</div> : <p className="muted" style={{ margin: 0 }}>No photos yet.</p>}
      {big && <div className="modal-back" onMouseDown={() => setBig(null)}><img className="photo-big" src={big.url} alt="" /></div>}
    </div>
  );
}
