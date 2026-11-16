import { useRef, useState } from 'react';
import { Camera, Loader2, X } from 'lucide-react';
import { compressImage } from './Photos';
import { storePhoto } from '../core/upload';
import { toast } from './ui';
import { readBill, type BillInfo } from '../core/ocr';

/** Small row of bill / receipt pictures; click to enlarge. */
export function BillThumbs({ photos }: { photos?: string[] }) {
  const [big, setBig] = useState<string | null>(null);
  if (!photos?.length) return null;
  return <span className="bill-thumbs" onClick={(e) => e.stopPropagation()}>{photos.slice(0, 3).map((p, i) => <img key={i} src={p} alt="Bill" onClick={() => setBig(p)} />)}
    {big && <span className="modal-back" onMouseDown={() => setBig(null)}><img className="photo-big" src={big} alt="Bill" /></span>}</span>;
}

/** Add / remove bill pictures on an expense. */
export function BillPhotosEdit({ photos, onChange, onRead }: { photos?: string[]; onChange: (p: string[]) => void; onRead?: (b: BillInfo) => void }) {
  const ref = useRef<HTMLInputElement>(null); const [busy, setBusy] = useState(false); const [reading, setReading] = useState<number | null>(null);
  const add = async (files: FileList | null) => {
    if (!files?.length) return; setBusy(true);
    let first = '';
    try {
      const out = [...(photos || [])];
      for (const f of Array.from(files).slice(0, 6)) { const small = await compressImage(f, 1600, 0.75); if (!first) first = small; out.push(await storePhoto(small)); }
      onChange(out.slice(0, 8));
    } catch (e) { toast((e as Error).message); } finally { setBusy(false); if (ref.current) ref.current.value = ''; }
    if (onRead && first) {
      setReading(0);
      try { onRead(await readBill(first, setReading)); } catch (e) { toast('Could not read the bill: ' + (e as Error).message); } finally { setReading(null); }
    }
  };
  return (
    <div className="flex wrap">
      {(photos || []).map((p, i) => <div key={i} className="compose-ph" style={{ backgroundImage: `url(${p})` }}><button type="button" onClick={() => onChange((photos || []).filter((_, k) => k !== i))} aria-label="Remove"><X size={12} /></button></div>)}
      <input ref={ref} type="file" accept="image/*" multiple hidden onChange={(e) => add(e.target.files)} />
      <button type="button" className="btn sm" disabled={busy} onClick={() => ref.current?.click()}>{busy ? <Loader2 size={14} className="spin" /> : <Camera size={14} />}Bill photo</button>
      {reading !== null && <span className="muted flex"><Loader2 size={13} className="spin" />Reading the bill… {Math.round(reading * 100)}%</span>}
    </div>
  );
}
