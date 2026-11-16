import { useEffect, useMemo, useState } from 'react';
import { Check, Send, Loader2, MessageCircle, Search, X, ImageOff } from 'lucide-react';

type Item = { id: string; brandId: string; code: string; name: string; category: string; image?: string; finish?: string; size?: string; thickness?: string; unit?: string; price?: number };
type Pick = { itemId: string; qty?: number; area?: string; note?: string };
type Data = {
  business: { name: string; nameAr?: string; logo?: string; phone?: string; whatsapp?: string; currency: string; tagline?: string };
  selection: { title: string; message?: string; status: string; picks: Pick[]; maxPicks?: number; showPrices: boolean; submittedAt?: string; customerName: string; customerPhone: string; customerNote: string };
  items: Item[]; brands: { id: string; name: string; logo?: string }[];
};
const money = (n: number, cur: string) => `${cur} ${n.toLocaleString('en-US', { minimumFractionDigits: ['OMR', 'KWD', 'BHD'].includes(cur) ? 3 : 2, maximumFractionDigits: 3 })}`;

/** The page a customer opens from a selection link: no login, pick materials, send. */
export default function PublicPick({ token }: { token: string }) {
  const [d, setD] = useState<Data | null>(null); const [err, setErr] = useState('');
  const [picks, setPicks] = useState<Record<string, Pick>>({});
  const [brand, setBrand] = useState(''); const [cat, setCat] = useState(''); const [q, setQ] = useState('');
  const [form, setForm] = useState({ name: '', phone: '', note: '' }); const [step, setStep] = useState<'pick' | 'send' | 'done'>('pick');
  const [busy, setBusy] = useState(false); const [big, setBig] = useState<Item | null>(null); const [msg, setMsg] = useState('');
  useEffect(() => {
    document.documentElement.dataset.theme = 'light';
    fetch(`/api/public/pick/${token}`).then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.error || 'Not found'); return j as Data; }).then((j) => {
      setD(j); document.title = `${j.selection.title} — ${j.business.name}`;
      setPicks(Object.fromEntries(j.selection.picks.map((p) => [p.itemId, p])));
      setForm({ name: j.selection.customerName, phone: j.selection.customerPhone, note: j.selection.customerNote });
    }).catch((e) => setErr(e.message));
  }, [token]);
  const cats = useMemo(() => [...new Set((d?.items || []).map((i) => i.category))], [d]);
  if (err) return <div className="pp-center"><div className="pp-card"><h2>Link not available</h2><p>{err}</p></div></div>;
  if (!d) return <div className="pp-center"><Loader2 className="spin" /></div>;
  const b = d.business; const sel = d.selection; const closed = sel.status === 'closed';
  const bname = (id: string) => d.brands.find((x) => x.id === id)?.name || '';
  const list = d.items.filter((i) => (!brand || i.brandId === brand) && (!cat || i.category === cat) && `${i.code} ${i.name} ${i.finish || ''} ${bname(i.brandId)}`.toLowerCase().includes(q.toLowerCase()));
  const chosen = Object.values(picks);
  const toggle = (id: string) => {
    if (closed) return;
    setMsg('');
    setPicks((p) => { const n = { ...p }; if (n[id]) delete n[id]; else { if (sel.maxPicks && Object.keys(n).length >= sel.maxPicks) { setMsg(`You can choose up to ${sel.maxPicks}`); return p; } n[id] = { itemId: id }; } return n; });
  };
  const upd = (id: string, patch: Partial<Pick>) => setPicks((p) => ({ ...p, [id]: { ...p[id], ...patch } }));
  const send = async () => {
    if (!form.name.trim()) return setMsg('Please enter your name');
    setBusy(true); setMsg('');
    try {
      const r = await fetch(`/api/public/pick/${token}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ picks: chosen, customerName: form.name, customerPhone: form.phone, customerNote: form.note }) });
      const j = await r.json(); if (!r.ok) throw new Error(j.error || 'Could not send');
      setStep('done');
    } catch (e) { setMsg((e as Error).message); } finally { setBusy(false); }
  };
  const wa = (b.whatsapp || b.phone || '').replace(/\D/g, '');
  const header = <header className="pp-head">{b.logo && <img src={b.logo} alt="" />}<div><b>{b.name}</b>{b.nameAr && <div dir="rtl" className="pp-ar">{b.nameAr}</div>}{b.tagline && <small>{b.tagline}</small>}</div></header>;
  if (step === 'done') return <div className="pp">{header}<div className="pp-card pp-done"><div className="pp-tick"><Check size={34} /></div><h2>Thank you{form.name ? `, ${form.name.split(' ')[0]}` : ''}!</h2>
    <p>We received your choice of {chosen.length} item{chosen.length === 1 ? '' : 's'}. We will get back to you soon.</p>
    <ul className="pp-sum">{chosen.map((p) => { const it = d.items.find((x) => x.id === p.itemId)!; return <li key={p.itemId}><span className="pp-sw" style={it.image ? { backgroundImage: `url(${it.image})` } : undefined} /><span><b>{it.code}</b> {it.name}{p.qty ? ` × ${p.qty}` : ''}{p.area ? ` — ${p.area}` : ''}</span></li>; })}</ul>
    {wa && <a className="pp-btn" href={`https://wa.me/${wa}?text=${encodeURIComponent(`Hello ${b.name}, I sent my choice for "${sel.title}".`)}`} target="_blank" rel="noreferrer"><MessageCircle size={17} />Message us on WhatsApp</a>}
    <button className="pp-link" onClick={() => setStep('pick')}>Change my choice</button></div></div>;
  return (
    <div className="pp">
      {header}
      <section className="pp-intro"><h1>{sel.title}</h1>{sel.message && <p>{sel.message}</p>}
        {closed ? <div className="pp-note">This selection is closed. Contact us to change it.</div> : sel.submittedAt ? <div className="pp-note">You already sent your choice. You can change it and send again.</div> : <p className="pp-hint">Tap the items you like{sel.maxPicks ? ` (up to ${sel.maxPicks})` : ''}, then press <b>Send my choice</b>.</p>}</section>
      <div className="pp-filters">
        <div className="pp-search"><Search size={16} /><input placeholder="Search code or colour" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        {d.brands.length > 1 && <select value={brand} onChange={(e) => setBrand(e.target.value)}><option value="">All brands</option>{d.brands.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>}
        {cats.length > 1 && <select value={cat} onChange={(e) => setCat(e.target.value)}><option value="">All types</option>{cats.map((c) => <option key={c}>{c}</option>)}</select>}
      </div>
      <div className="pp-grid">{list.map((i) => { const on = !!picks[i.id]; return (
        <div key={i.id} className={`pp-item ${on ? 'on' : ''}`}>
          <button type="button" className="pp-img" style={i.image ? { backgroundImage: `url(${i.image})` } : undefined} onClick={() => toggle(i.id)} aria-pressed={on} aria-label={`${on ? 'Remove' : 'Choose'} ${i.code}`}>
            {!i.image && <ImageOff size={26} />}<span className="pp-check">{on ? <Check size={18} /> : null}</span></button>
          <div className="pp-info" onClick={() => i.image && setBig(i)}><b>{i.code}</b><span>{i.name}</span><small>{[bname(i.brandId), i.finish, i.thickness, i.size].filter(Boolean).join(' · ')}</small>
            {sel.showPrices && i.price ? <small className="pp-price">{money(i.price, b.currency)}{i.unit ? ` / ${i.unit}` : ''}</small> : null}</div>
          {on && !closed && <div className="pp-extra">
            <input inputMode="decimal" placeholder="Qty" value={picks[i.id].qty ?? ''} onChange={(e) => upd(i.id, { qty: e.target.value === '' ? undefined : Number(e.target.value) || undefined })} />
            <input placeholder="Room / place" value={picks[i.id].area || ''} onChange={(e) => upd(i.id, { area: e.target.value })} />
          </div>}
        </div>); })}</div>
      {!list.length && <p className="pp-hint" style={{ textAlign: 'center' }}>Nothing matches your search.</p>}
      {!closed && <div className="pp-bar">
        {msg && <div className="pp-msg">{msg}</div>}
        {step === 'send' ? <div className="pp-send">
          <div className="pp-send-head"><b>Send your choice ({chosen.length})</b><button className="pp-x" onClick={() => setStep('pick')} aria-label="Back"><X size={18} /></button></div>
          <input placeholder="Your name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <input placeholder="Mobile number" inputMode="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          <textarea placeholder="Anything to tell us? (optional)" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
          <button className="pp-btn" disabled={busy} onClick={send}>{busy ? <Loader2 size={17} className="spin" /> : <Send size={17} />}Send my choice</button>
        </div> : <button className="pp-btn" disabled={!chosen.length} onClick={() => { setMsg(''); setStep('send'); }}><Send size={17} />{chosen.length ? `Send my choice (${chosen.length})` : 'Tap items to choose'}</button>}
      </div>}
      {big && <div className="modal-back" onMouseDown={() => setBig(null)}><figure className="cat-big"><img src={big.image} alt={big.name} /><figcaption><b>{big.code}</b> {big.name}</figcaption></figure></div>}
      <footer className="pp-foot">{b.name}{b.phone ? ` · ${b.phone}` : ''}</footer>
    </div>
  );
}
