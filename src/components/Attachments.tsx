import { useRef, useState } from 'react';
import { FileText, Loader2, Paperclip, Trash2 } from 'lucide-react';
import type { Attachment } from '../core/types';
import { uid } from '../core/store';
import { compressImage } from './Photos';
import { storePhoto } from '../core/upload';
import { toast } from './ui';

const readAsDataUrl = (f: File) => new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = () => rej(new Error('Could not read the file')); r.readAsDataURL(f); });

/** Drawings, designs and documents: pictures (shrunk) or PDF files, stored on the server. */
export function Attachments({ files, onChange, readOnly, label = 'Add drawing / PDF', kind }: { files: Attachment[]; onChange: (f: Attachment[]) => void; readOnly?: boolean; label?: string; kind?: string }) {
  const ref = useRef<HTMLInputElement>(null); const [busy, setBusy] = useState(false); const [big, setBig] = useState<string | null>(null);
  const add = async (list: FileList | null) => {
    if (!list?.length) return; setBusy(true);
    try {
      const out = [...files];
      for (const f of Array.from(list).slice(0, 10)) {
        if (f.type === 'application/pdf') { if (f.size > 10e6) { toast(`${f.name} is larger than 10 MB`); continue; } out.push({ id: uid(), url: await storePhoto(await readAsDataUrl(f)), name: f.name, type: f.type, at: new Date().toISOString(), kind }); }
        else if (f.type.startsWith('image/')) out.push({ id: uid(), url: await storePhoto(await compressImage(f, 2000, 0.8)), name: f.name, type: 'image/jpeg', at: new Date().toISOString(), kind });
        else toast(`${f.name}: only pictures or PDF files`);
      }
      onChange(out);
    } catch (e) { toast((e as Error).message); } finally { setBusy(false); if (ref.current) ref.current.value = ''; }
  };
  return (
    <div>
      {files.length > 0 && <div className="attach-grid">{files.map((a) => (
        <div key={a.id} className="attach">
          {a.type.startsWith('image/') ? <img src={a.url} alt={a.name} onClick={() => setBig(a.url)} /> : <a href={a.url} target="_blank" rel="noreferrer" className="attach-pdf"><FileText size={30} /><span>PDF</span></a>}
          <div className="attach-name" title={a.name}>{a.name}</div>
          {!readOnly && <button type="button" className="icon-btn" title="Remove" onClick={() => onChange(files.filter((x) => x.id !== a.id))}><Trash2 size={13} /></button>}
        </div>))}</div>}
      {!readOnly && <><input ref={ref} type="file" accept="image/*,application/pdf" multiple hidden onChange={(e) => add(e.target.files)} />
        <button type="button" className="btn sm" disabled={busy} onClick={() => ref.current?.click()}>{busy ? <Loader2 size={14} className="spin" /> : <Paperclip size={14} />}{label}</button></>}
      {!files.length && readOnly && <p className="muted" style={{ margin: 0 }}>None yet.</p>}
      {big && <div className="modal-back" onMouseDown={() => setBig(null)}><img className="photo-big" src={big} alt="" /></div>}
    </div>
  );
}
