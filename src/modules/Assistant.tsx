import { useEffect, useRef, useState } from 'react';
import { Bot, Send, Camera, Loader2, Check, X, AlertTriangle, ArrowRight } from 'lucide-react';
import { store, useDB, today, uid } from '../core/store';
import type { Job, Txn } from '../core/types';
import { money, fmtDate } from '../core/calc';
import { answer, findDuplicates, findJob, EXAMPLES, type Answer, type ExpenseDraft } from '../core/assistant';
import { readBill } from '../core/ocr';
import { compressImage } from '../components/Photos';
import { storePhoto } from '../core/upload';
import { guessCategory, expenseCats } from './ExpenseChat';
import { go } from '../core/router';
import { useCanWrite, useUser } from '../core/session';
import { PageHeader, Badge, toast } from '../components/ui';

type Kind = 'bill' | 'payment' | 'progress' | 'delivery';
type Msg = { id: string; from: 'me' | 'bot'; text: string; image?: string; ans?: Answer; card?: Card; done?: string };
type Card = { draft: ExpenseDraft; photo?: string; kind: Kind; reading?: number; ocrText?: string; confidence?: number };
const KEY = 'ww-assistant';

/**
 * AI business assistant. Reads bill photos (OCR), understands short commands and answers questions
 * from the books. It never invents figures and never saves money entries without the owner's Confirm.
 */
export default function Assistant() {
  const db = useDB(); const s = db.settings; const user = useUser(); const canTx = useCanWrite()('txns');
  const [msgs, setMsgs] = useState<Msg[]>(() => { try { return JSON.parse(sessionStorage.getItem(KEY) || '[]'); } catch { return []; } });
  const [text, setText] = useState(''); const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null); const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => { try { sessionStorage.setItem(KEY, JSON.stringify(msgs.slice(-40).map((m) => ({ ...m, image: m.image && m.image.length > 200000 ? undefined : m.image })))); } catch { /* */ } endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [msgs]);
  const push = (...m: Msg[]) => setMsgs((x) => [...x, ...m]);
  const patch = (id: string, p: Partial<Msg>) => setMsgs((x) => x.map((m) => (m.id === id ? { ...m, ...p } : m)));
  const patchCard = (id: string, p: Partial<Card>) => setMsgs((x) => x.map((m) => (m.id === id && m.card ? { ...m, card: { ...m.card, ...p } } : m)));

  const ask = (q: string) => {
    if (!q.trim()) return;
    const a = answer(store.get(), q, today());
    const me: Msg = { id: uid(), from: 'me', text: q };
    if (a.type === 'draft') push(me, { id: uid(), from: 'bot', text: a.text, card: { draft: a.draft, kind: a.draft.kind === 'income' ? 'payment' : 'bill' } });
    else push(me, { id: uid(), from: 'bot', text: a.text, ans: a });
    setText('');
  };

  const onPhoto = async (f?: File) => {
    if (!f) return; setBusy(true);
    try {
      const img = await compressImage(f, 1600, 0.8);
      const hint = text.trim(); const job = hint ? findJob(store.get(), hint) : undefined;
      const id = uid();
      push({ id: uid(), from: 'me', text: hint || 'Photo', image: img }, { id, from: 'bot', text: 'Reading the photo…', card: { kind: 'bill', photo: img, reading: 0, draft: { kind: 'expense', category: guessCategory(hint, expenseCats(s)), jobId: job?.id, description: hint, date: today(), method: 'Cash' } } });
      setText('');
      try {
        const r = await readBill(img, (p) => patchCard(id, { reading: p }));
        const words = `${hint} ${r.vendor || ''} ${r.text}`;
        setMsgs((x) => x.map((m) => m.id !== id || !m.card ? m : { ...m, text: r.amount ? 'I read this from the bill. Check every field, choose the project, then Confirm.' : 'I could not find a total on this photo. If it is a bill, type the amount; it may also be a progress photo or delivery document.', card: { ...m.card, reading: undefined, ocrText: r.text, confidence: r.confidence, kind: r.amount ? 'bill' : (job ? 'progress' : 'bill'), draft: { ...m.card.draft, amount: r.amount, date: r.date || m.card.draft.date, vendor: r.vendor, billNo: r.billNo, vat: r.vat, items: r.items, category: guessCategory(words, expenseCats(s)), description: m.card.draft.description || [r.vendor, r.billNo && `bill ${r.billNo}`].filter(Boolean).join(' · ') || 'Bill' } } }));
      } catch (e) { patch(id, { text: `Could not read the photo (${(e as Error).message}). Fill in the details yourself.` }); patchCard(id, { reading: undefined }); }
    } finally { setBusy(false); if (fileRef.current) fileRef.current.value = ''; }
  };

  const confirm = async (m: Msg) => {
    const c = m.card!; const d = c.draft; const job = db.jobs.find((j) => j.id === d.jobId);
    if (c.kind === 'progress' || c.kind === 'delivery') {
      if (!job) return toast('Choose the project');
      const url = c.photo ? await storePhoto(c.photo) : undefined; if (!url) return;
      if (c.kind === 'progress') store.upsert('jobs', { ...job, photos: [...(job.photos || []), { id: uid(), url, kind: 'progress', caption: d.description || undefined, at: new Date().toISOString() }] });
      else store.upsert('jobs', { ...job, attachments: [...(job.attachments || []), { id: uid(), url, name: d.description || `Delivery document ${fmtDate(d.date)}`, type: 'image/jpeg', at: new Date().toISOString(), kind: 'delivery' }] });
      patch(m.id, { done: `Saved to ${job.code} as ${c.kind === 'progress' ? 'a progress photo' : 'a delivery document'}.` }); return;
    }
    const amount = Number(d.amount);
    if (!(amount > 0)) return toast('Enter the amount');
    if (!canTx) return toast('This login cannot add money entries');
    const photos = c.photo ? [await storePhoto(c.photo)] : undefined;
    const kind = c.kind === 'payment' ? 'income' : 'expense';
    const t = store.upsert('txns', { date: d.date, kind, category: d.category, amount: +amount.toFixed(3), method: d.method, description: d.description || d.category, jobId: d.jobId, ref: d.billNo || (job ? job.code : 'Assistant'), photos, vendor: d.vendor, billNo: d.billNo, vat: d.vat } as Txn);
    if (kind === 'expense' && job) store.upsert('expenseChat', { jobId: job.id, text: d.description || d.category, photos: photos || [], amount: +amount.toFixed(3), category: d.category, method: d.method, date: d.date, byUserId: user?.id, byName: user?.name, status: 'posted', txnId: t.id, ocr: c.ocrText ? { amount: d.amount, date: d.date, vendor: d.vendor, billNo: d.billNo, vat: d.vat, confidence: c.confidence } : undefined });
    patch(m.id, { done: `Saved: ${kind} ${money(amount, s)} · ${d.category}${job ? ` · ${job.code}` : ' · workshop'} (Accounts${job ? ', project costs and expense chat' : ''} updated).` });
  };

  return (
    <>
      <PageHeader title="Assistant" sub="Send a bill photo or type a command. Figures come only from your books, and nothing is saved until you confirm." />
      <div className="card assistant">
        <div className="chat-log">
          {!msgs.length && <div className="assist-empty"><Bot size={36} /><p>Try:</p><div className="chips">{EXAMPLES.map((e) => <button key={e} className="chip" onClick={() => ask(e)}>{e}</button>)}</div>
            <p className="muted" style={{ fontSize: 12 }}>📷 Photo of a purchase bill, expense receipt, supplier invoice, payment receipt, delivery note or project progress — type the project (e.g. “kitchen project”) before sending to pick it automatically.</p></div>}
          {msgs.map((m) => <div key={m.id} className={`bubble ${m.from}`}>
            {m.image && <img src={m.image} alt="" className="bubble-img" />}
            <div style={{ whiteSpace: 'pre-wrap' }}>{m.text}</div>
            {m.ans?.type === 'text' && m.ans.rows?.length ? <ul className="ans-rows">{m.ans.rows.slice(0, 25).map((r, i) => <li key={i} className={r.go ? 'click' : ''} onClick={() => r.go && go(r.go[0], r.go[1])}><span>{r.label}</span><b>{r.value}</b>{r.go && <ArrowRight size={13} />}</li>)}</ul> : null}
            {m.card && !m.done && <DraftCard card={m.card} jobs={db.jobs} onChange={(p) => patchCard(m.id, p)} onConfirm={() => void confirm(m)} onCancel={() => patch(m.id, { done: 'Cancelled — nothing saved.' })} />}
            {m.done && <div className="muted" style={{ marginTop: 6 }}><Check size={13} /> {m.done}</div>}
          </div>)}
          <div ref={endRef} />
        </div>
        <div className="chat-input">
          <input ref={fileRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => void onPhoto(e.target.files?.[0])} />
          <button className="icon-btn" title="Photo of a bill, receipt or progress" disabled={busy} onClick={() => fileRef.current?.click()}>{busy ? <Loader2 size={18} className="spin" /> : <Camera size={18} />}</button>
          <input placeholder="e.g. Add 150 OMR wood purchase to Project 105" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') ask(text); }} />
          <button className="btn primary" onClick={() => ask(text)}><Send size={16} /></button>
          {msgs.length > 0 && <button className="btn ghost sm" onClick={() => setMsgs([])}>Clear</button>}
        </div>
      </div>
    </>
  );
}

function DraftCard({ card, jobs, onChange, onConfirm, onCancel }: { card: Card; jobs: Job[]; onChange: (p: Partial<Card>) => void; onConfirm: () => void; onCancel: () => void }) {
  const db = useDB(); const s = db.settings; const d = card.draft;
  const set = (p: Partial<ExpenseDraft>) => onChange({ draft: { ...d, ...p } });
  const money$ = card.kind === 'bill' || card.kind === 'payment';
  const dups = money$ && card.kind === 'bill' ? findDuplicates(db, d) : [];
  const cats = card.kind === 'payment' ? s.incomeCategories : expenseCats(s);
  if (card.reading !== undefined) return <div className="draft-card"><Loader2 size={14} className="spin" /> Reading… {Math.round(card.reading * 100)}%</div>;
  return (
    <div className="draft-card">
      {card.photo && <div className="chips" style={{ marginBottom: 6 }}>{([['bill', 'Bill / receipt (expense)'], ['payment', 'Payment received'], ['progress', 'Progress photo'], ['delivery', 'Delivery document']] as const).map(([k, l]) => <button key={k} className={`chip ${card.kind === k ? 'on' : ''}`} onClick={() => onChange({ kind: k, draft: { ...d, kind: k === 'payment' ? 'income' : 'expense', category: k === 'payment' ? (s.incomeCategories.find((c) => /job|project/i.test(c)) || s.incomeCategories[0]) : d.category } })}>{l}</button>)}</div>}
      <div className="form two compact">
        <label>Project<select value={d.jobId || ''} onChange={(e) => set({ jobId: e.target.value || undefined })}><option value="">{money$ ? 'Workshop / general (no project)' : '— choose —'}</option>{jobs.filter((j) => j.status !== 'cancelled').map((j) => <option key={j.id} value={j.id}>{j.code} · {j.title}</option>)}</select></label>
        {money$ && <label>Amount ({s.currency})<input type="number" value={d.amount ?? ''} onChange={(e) => set({ amount: e.target.value === '' ? undefined : +e.target.value })} /></label>}
        {money$ && <label>Category<select value={d.category} onChange={(e) => set({ category: e.target.value })}>{cats.map((c) => <option key={c}>{c}</option>)}</select></label>}
        <label>Date<input type="date" value={d.date} onChange={(e) => set({ date: e.target.value })} /></label>
        {money$ && <label>Paid by<select value={d.method} onChange={(e) => set({ method: e.target.value })}>{['Cash', 'Bank', 'Card', 'Cheque', 'Online'].map((x) => <option key={x}>{x}</option>)}</select></label>}
        {card.kind === 'bill' && <label>Supplier<input value={d.vendor || ''} onChange={(e) => set({ vendor: e.target.value })} /></label>}
        {card.kind === 'bill' && <label>Invoice no.<input value={d.billNo || ''} onChange={(e) => set({ billNo: e.target.value })} /></label>}
        {card.kind === 'bill' && <label>VAT<input type="number" value={d.vat ?? ''} onChange={(e) => set({ vat: e.target.value === '' ? undefined : +e.target.value })} /></label>}
        <label style={{ gridColumn: '1 / -1' }}>Description<input value={d.description} onChange={(e) => set({ description: e.target.value })} /></label>
      </div>
      {d.items?.length ? <table className="mini"><thead><tr><th>Item</th><th className="num">Qty</th><th className="num">Price</th><th className="num">Total</th></tr></thead><tbody>{d.items.map((it, i) => <tr key={i}><td>{it.description}</td><td className="num">{it.qty}</td><td className="num">{it.price}</td><td className="num">{it.total}</td></tr>)}</tbody></table> : null}
      {dups.length > 0 && <div className="alert" style={{ marginTop: 6 }}><AlertTriangle size={14} /> Possible duplicate: {dups.slice(0, 3).map((t) => `${fmtDate(t.date)} ${money(t.amount, s)} ${t.description}${t.billNo ? ` (bill ${t.billNo})` : ''}`).join('; ')}</div>}
      {card.confidence !== undefined && card.confidence < 60 && <div className="muted" style={{ fontSize: 12 }}>The photo was hard to read ({Math.round(card.confidence)}% sure) — check the figures.</div>}
      <div className="flex" style={{ marginTop: 8, gap: 6 }}><button className="btn primary sm" onClick={onConfirm}><Check size={14} />Confirm & save</button><button className="btn sm" onClick={onCancel}><X size={14} />Cancel</button>{d.jobId && <Badge>{jobs.find((j) => j.id === d.jobId)?.code}</Badge>}</div>
    </div>
  );
}
