import { useEffect, useMemo, useRef, useState } from 'react';
import { Camera, Send, Loader2, X, Check, Clock, Ban, ChevronLeft, Wallet, Undo2, Plus, Paperclip, Search, ScanText, Pencil } from 'lucide-react';
import { store, useDB, today, uid } from '../core/store';
import { useRoute, go } from '../core/router';
import type { ExpenseMsg, Settings, Txn } from '../core/types';
import { fmtDate, money, projectFinance, PROJECT_CATS } from '../core/calc';
import { compressImage } from '../components/Photos';
import { storePhoto } from '../core/upload';
import { readBill, type BillInfo } from '../core/ocr';
import { findDuplicates } from '../core/assistant';
import { useRole, useUser } from '../core/session';
import { Badge, Empty, toast } from '../components/ui';

export const expenseCats = (s: Settings) => [...new Set([...s.expenseCategories.filter((c) => c !== 'Salary'), ...PROJECT_CATS])];
const METHODS = ['Cash', 'Bank', 'Card', 'Cheque', 'Online'];

// keyword → categories to try, newest names first (older setups keep their own names)
const GUESS: [RegExp, string[]][] = [
  [/\b(ply|plywood|mdf|board|sheets?|hpl|laminates?|acp|acrylic|melamine|veneer|particle|timber|wood)\b/i, ['Wood and Plywood', 'Boards & Sheets']],
  [/\b(hinges?|screws?|handles?|runners?|channels?|locks?|nails?|bolts?|hardware|brackets?|knobs?|accessor(y|ies))\b/i, ['Hardware and Accessories', 'Hardware']],
  [/\b(polish|pu|lacquer|sealer|stain|varnish)\b/i, ['Polishing', 'Paint & Polish']],
  [/\b(paint|primer|thinner|putty|emulsion|enamel)\b/i, ['Painting', 'Paint & Polish']],
  [/\b(petrol|diesel|fuel|gasoline|taxi|pickup|truck|freight|transport|delivery|trip|shell|oman ?oil|super ?9[158]|m9[158]|litres?|ltrs?)\b/i, ['Transportation', 'Fuel & Transport', 'Transport']],
  [/\b(carpenter|wages?)\b/i, ['Carpenter Wages', 'Labour']],
  [/\b(labou?r|helper|coolie|mason)\b/i, ['Labour']],
  [/\b(sub-?contract(or)?|contractor|outsourc\w*)\b/i, ['Outsourced Work', 'Subcontractor']],
  [/\b(electricity|power|kwh|nama|dhofar power)\b/i, ['Electricity', 'Electricity & Water']],
  [/\b(install(ation)?|fixing)\b/i, ['Installation']],
  [/\b(tools?|blades?|bits?|drill|saw|router|grinder|sandpaper|discs?)\b/i, ['Tools']],
  [/\b(glue|silicone|foam|tape|edge ?band|fevicol|adhesive)\b/i, ['Materials']],
];
/** Best category for a bill text, limited to the categories that exist. */
export function guessCategory(text: string, cats: string[]) {
  const has = (c: string) => cats.find((x) => x.toLowerCase() === c.toLowerCase());
  for (const [re, cs] of GUESS) if (re.test(text)) for (const c of cs) { const hit = has(c); if (hit) return hit; }
  return has('Materials') || has('Other Expenses') || cats[0];
}
/** Amount written in a message: "OMR 12.5", "12.500 RO", "= 45", or a number at the very end ("petrol 5"). */
export function parseAmount(text: string): number | undefined {
  const t = text.replace(/,(?=\d{3}\b)/g, '');
  const m = /(?:omr|ro|r\.o\.?|bd|rs|aed|sar|=|:)\s*(\d+(?:\.\d{1,3})?)/i.exec(t) || /(\d+(?:\.\d{1,3})?)\s*(?:omr|ro|r\.o\.?|bd|rs|aed|sar)\b/i.exec(t) || /(\d+(?:\.\d{1,3})?)\s*$/.exec(t.trim());
  const n = m ? Number(m[1]) : NaN;
  return n > 0 ? n : undefined;
}

type Draft = { text: string; amount: string; category: string; method: string; date: string; photos: string[] };

export default function ExpenseChat() {
  const db = useDB(); const s = db.settings; const role = useRole(); const user = useUser(); const { params } = useRoute();
  const office = role !== 'staff'; const me = user?.staffId;
  const [thread, setThread] = useState<string | null>(params.job ?? null);
  const [q, setQ] = useState('');
  useEffect(() => { if (params.job !== undefined) { setThread(params.job); go('expchat'); } }, [params.job]);
  const key = (jobId?: string) => jobId || 'general';
  const msgs = db.expenseChat;
  const threads = useMemo(() => {
    const jobs = db.jobs.filter((j) => !['completed', 'cancelled'].includes(j.status) || msgs.some((m) => m.jobId === j.id));
    const rows = [{ id: 'general', title: 'General / workshop', code: 'GEN' }, ...jobs.map((j) => ({ id: j.id, title: j.title, code: j.code }))].map((t) => {
      const ms = msgs.filter((m) => key(m.jobId) === t.id);
      const last = ms.reduce<ExpenseMsg | undefined>((a, m) => (!a || m.createdAt > a.createdAt ? m : a), undefined);
      return { ...t, count: ms.length, pending: ms.filter((m) => m.status === 'pending').length, posted: ms.filter((m) => m.status === 'posted').reduce((n, m) => n + (m.amount || 0), 0), last };
    });
    return rows.filter((t) => `${t.code} ${t.title}`.toLowerCase().includes(q.toLowerCase()))
      .sort((a, b) => (b.pending - a.pending) || (b.last?.createdAt || '').localeCompare(a.last?.createdAt || '') || (a.id === 'general' ? -1 : 0));
  }, [db.jobs, msgs, q]);
  const pendingAll = msgs.filter((m) => m.status === 'pending').length;

  return (
    <div className={`xchat ${thread ? 'has-thread' : ''}`}>
      <aside className="xchat-list">
        <div className="xchat-list-head"><h2>Expense chat</h2>{office && pendingAll > 0 && <Badge tone="amber">{pendingAll} to approve</Badge>}</div>
        <p className="muted" style={{ margin: '0 0 10px' }}>Snap the bill, write what it was and the amount — it goes into that project's expenses.</p>
        <div className="search" style={{ marginBottom: 8 }}><Search size={15} /><input placeholder="Find a project" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <ul className="xchat-threads">{threads.map((t) => <li key={t.id} className={thread === t.id ? 'on' : ''} onClick={() => setThread(t.id)}>
          <div className="xchat-avatar">{t.id === 'general' ? <Wallet size={18} /> : t.code.replace(/\D/g, '').slice(-3) || t.code.slice(0, 3)}</div>
          <div className="grow"><div className="flex between"><b>{t.id === 'general' ? t.title : `${t.code} · ${t.title}`}</b>{t.last && <small className="muted xchat-date">{fmtDate(t.last.date).slice(0, 6)}</small>}</div>
            <div className="muted xchat-preview">{t.last ? `${t.last.byName ? t.last.byName.split(' ')[0] + ': ' : ''}${t.last.text || (t.last.photos.length ? '📷 Photo' : '')}` : 'No bills yet'}</div></div>
          {office && t.pending > 0 ? <Badge tone="amber">{t.pending}</Badge> : t.posted > 0 && office ? <small className="muted">{money(t.posted, s)}</small> : null}
        </li>)}</ul>
      </aside>
      <section className="xchat-main">
        {thread ? <Thread jobId={thread === 'general' ? undefined : thread} onBack={() => setThread(null)} office={office} me={me} user={user} />
          : <div className="xchat-empty"><Empty title="Choose a project" hint="Every project has its own chat. Send bill photos there and they are added to that project's expenses." /></div>}
      </section>
    </div>
  );
}

function Thread({ jobId, onBack, office, me, user }: { jobId?: string; onBack: () => void; office: boolean; me?: string; user: { id: string; name: string } | null }) {
  const db = useDB(); const s = db.settings; const cats = expenseCats(s);
  const job = db.jobs.find((j) => j.id === jobId);
  const list = db.expenseChat.filter((m) => (m.jobId || undefined) === jobId).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const f = job && office ? projectFinance(db, job) : null;
  const blank = (): Draft => ({ text: '', amount: '', category: '', method: 'Cash', date: today(), photos: [] });
  const [d, setD] = useState<Draft>(blank); const [busy, setBusy] = useState(false); const [big, setBig] = useState<string | null>(null);
  const [reading, setReading] = useState<number | null>(null);
  const [auto, setAuto] = useState(() => { try { return localStorage.getItem('ww-bill-auto') !== '0'; } catch { return true; } });
  const setAutoSave = (v: boolean) => { setAuto(v); try { localStorage.setItem('ww-bill-auto', v ? '1' : '0'); } catch { /* */ } };
  const [edit, setEdit] = useState<{ id: string; amount: string; category: string; method: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null); const camRef = useRef<HTMLInputElement>(null); const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }); }, [list.length, jobId]);
  useEffect(() => { setD(blank()); setEdit(null); }, [jobId]); // eslint-disable-line react-hooks/exhaustive-deps

  const autoAmount = d.amount === '' ? parseAmount(d.text) : Number(d.amount) || undefined;
  const autoCat = d.category || guessCategory(d.text, cats);
  const addPhotos = async (files: FileList | null) => {
    if (!files?.length) return; setBusy(true);
    let next: Draft | null = null;
    try {
      const out: string[] = []; for (const f of Array.from(files).slice(0, 8)) out.push(await compressImage(f, 1600, 0.75));
      next = { ...d, photos: [...d.photos, ...out].slice(0, 8) }; setD(next);
    } catch (e) { toast((e as Error).message); } finally { setBusy(false); if (fileRef.current) fileRef.current.value = ''; if (camRef.current) camRef.current.value = ''; }
    // read the bill: fill amount, date, shop and category; with "auto" on, the entry is made at once
    if (next && !next.text.trim() && next.amount === '') {
      setReading(0);
      let info: BillInfo | null = null;
      try { info = await readBill(next.photos[next.photos.length - files.length] || next.photos[0], (p) => setReading(p)); }
      catch (e) { toast('Could not read the bill — type the amount. (' + (e as Error).message + ')'); }
      setReading(null);
      if (!info) return;
      const text = info.vendor ? `${info.vendor}${info.billNo ? ` — bill ${info.billNo}` : ' bill'}` : info.billNo ? `Bill ${info.billNo}` : 'Bill';
      const filled: Draft = { ...next, text, amount: info.amount ? String(info.amount) : '', date: info.date || next.date, category: guessCategory(info.text, cats) };
      setD(filled);
      const ocr = { amount: info.amount, date: info.date, vendor: info.vendor, billNo: info.billNo, vat: info.vat, confidence: Math.round(info.confidence) };
      if (!info.amount) { toast('Could not find the total on the bill — please type the amount'); return; }
      if (auto) await send(filled, ocr);
      else toast(`Read from the bill: ${money(info.amount, s)} — check and press Send`);
    }
  };
  /** Office: post a message to Accounts as a project expense. */
  const post = (m: ExpenseMsg, amount: number, category: string, method: string) => {
    const dups = findDuplicates(store.get(), { amount: +amount.toFixed(3), date: m.date, billNo: m.ocr?.billNo, vendor: m.ocr?.vendor, jobId: m.jobId });
    if (dups.length && !window.confirm(`This bill may already be entered:\n${dups.slice(0, 3).map((t) => `${t.date} · ${t.amount} · ${t.description}`).join('\n')}\n\nAdd it anyway?`)) return;
    const t = store.upsert('txns', { date: m.date, kind: 'expense', category, amount: +amount.toFixed(3), method, description: m.text || 'Bill', jobId: m.jobId, ref: m.ocr?.billNo || (m.byStaffId && m.byStaffId !== me ? `Chat · ${m.byName}` : 'Chat'), photos: m.photos, chatId: m.id, vendor: m.ocr?.vendor, billNo: m.ocr?.billNo, vat: m.ocr?.vat } as Txn);
    store.upsert('expenseChat', { ...m, amount: +amount.toFixed(3), category, method, status: 'posted', txnId: t.id });
  };
  const send = async (dr: Draft = d, ocr?: ExpenseMsg['ocr']) => {
    const d = dr;
    const autoAmount = d.amount === '' ? parseAmount(d.text) : Number(d.amount) || undefined;
    const autoCat = d.category || guessCategory(d.text, cats);
    if (!d.text.trim() && !d.photos.length) return;
    if (d.amount !== '' && !(Number(d.amount) > 0)) return toast('The amount must be more than zero');
    setBusy(true);
    try {
      const photos: string[] = []; for (const p of d.photos) photos.push(await storePhoto(p));
      const base: ExpenseMsg = { id: uid(), createdAt: new Date().toISOString(), jobId, text: d.text.trim(), photos, date: d.date, byUserId: user?.id, byName: user?.name || 'Owner', byStaffId: me,
        amount: autoAmount, category: autoAmount ? autoCat : undefined, method: autoAmount ? d.method : undefined, status: autoAmount ? (office ? 'posted' : 'pending') : 'note', ...(ocr ? { ocr } : {}) };
      if (office && autoAmount) { post(base, autoAmount, autoCat, d.method); toast(`${money(autoAmount, s)} added to ${job ? job.code : 'general'} expenses${ocr ? ' — read from the bill, please check' : ''}`); }
      else { store.upsert('expenseChat', base); if (!office && autoAmount) toast('Sent — the office will approve it'); }
      setD(blank());
    } catch (e) { toast((e as Error).message); } finally { setBusy(false); }
  };
  const approve = () => {
    const m = list.find((x) => x.id === edit?.id); if (!m || !edit) return;
    const a = Number(edit.amount); if (!(a > 0)) return toast('Enter the amount');
    if (m.status === 'posted' && m.txnId) {
      const t = db.txns.find((x) => x.id === m.txnId);
      if (t) store.upsert('txns', { ...t, amount: +a.toFixed(3), category: edit.category, method: edit.method });
      store.upsert('expenseChat', { ...m, amount: +a.toFixed(3), category: edit.category, method: edit.method });
      setEdit(null); return toast('Corrected in Accounts');
    }
    post(m, a, edit.category, edit.method); setEdit(null); toast(`${money(a, s)} added to ${job ? job.code : 'general'} expenses`);
  };
  const reject = (m: ExpenseMsg) => { const why = window.prompt('Why is this bill not accepted?', ''); if (why === null) return; store.upsert('expenseChat', { ...m, status: 'rejected', reply: why || undefined }); };
  const undo = (m: ExpenseMsg) => {
    if (!window.confirm(`Take ${money(m.amount || 0, s)} back out of Accounts? The message stays here.`)) return;
    if (m.txnId) store.remove('txns', m.txnId);
    store.upsert('expenseChat', { ...m, status: m.byStaffId && m.byStaffId !== me ? 'pending' : 'note', txnId: undefined });
  };

  return (
    <>
      <header className="xchat-head">
        <button className="icon-btn xchat-back" onClick={onBack} aria-label="Back"><ChevronLeft size={20} /></button>
        <div className="grow"><b>{job ? `${job.code} · ${job.title}` : 'General / workshop'}</b>
          <div className="muted">{f ? `Expenses ${money(f.expenses, s)} · value ${money(f.contract, s)} · profit ${money(f.profit, s)}` : office ? 'Workshop expenses not tied to a project' : 'Send your bills here'}</div></div>
        {job && office && <button className="btn sm" onClick={() => go('jobs', { id: job.id })}><Wallet size={14} />Project</button>}
      </header>
      <div className="xchat-body">
        {!list.length && <div className="xchat-hint">📷 Take a photo of the bill, type what it was — e.g. <i>“6 sheets marine ply 102.000”</i> — and send. {office ? 'It is added to this project’s expenses at once.' : 'The office checks it and adds it to the project.'}</div>}
        {list.map((m) => { const mine = m.byUserId ? m.byUserId === user?.id : !m.byStaffId; return (
          <div key={m.id} className={`bubble-row ${mine ? 'mine' : ''}`}>
            <div className={`bubble st-${m.status}`}>
              {!mine && <div className="bubble-name">{m.byName}</div>}
              {m.photos.length > 0 && <div className={`bubble-photos n${Math.min(m.photos.length, 4)}`}>{m.photos.map((p, i) => <img key={i} src={p} alt="Bill" loading="lazy" onClick={() => setBig(p)} />)}</div>}
              {m.text && <div className="bubble-text">{m.text}</div>}
              {m.amount !== undefined && m.status !== 'note' && <div className="bubble-amount"><b>{money(m.amount, s)}</b> <span>{m.category}{m.method ? ` · ${m.method}` : ''}</span></div>}
              {m.ocr && <div className="bubble-ocr"><ScanText size={13} />Read from the bill{m.ocr.date ? ` · dated ${fmtDate(m.ocr.date)}` : ''}{m.ocr.vat ? ` · VAT ${money(m.ocr.vat, s)}` : ''}{m.status === 'posted' || m.status === 'pending' ? ' — please check' : ''}</div>}
              <div className="bubble-meta">
                {m.status === 'posted' && <span className="ok"><Check size={13} />In expenses</span>}
                {m.status === 'pending' && <span className="wait"><Clock size={13} />Waiting for approval</span>}
                {m.status === 'rejected' && <span className="no"><Ban size={13} />Not accepted{m.reply ? `: ${m.reply}` : ''}</span>}
                <span className="muted">{fmtDate(m.date)} {new Date(m.createdAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</span>
              </div>
              {office && edit?.id === m.id ? <div className="bubble-edit">
                <input type="number" inputMode="decimal" placeholder={s.currency} autoFocus value={edit.amount} onChange={(e) => setEdit({ ...edit, amount: e.target.value })} />
                <select value={edit.category} onChange={(e) => setEdit({ ...edit, category: e.target.value })}>{cats.map((c) => <option key={c}>{c}</option>)}</select>
                <select value={edit.method} onChange={(e) => setEdit({ ...edit, method: e.target.value })}>{METHODS.map((x) => <option key={x}>{x}</option>)}</select>
                <button className="btn sm primary" onClick={approve}><Check size={14} />Add to expenses</button><button className="btn sm ghost" onClick={() => setEdit(null)}>Cancel</button>
              </div> : office && <div className="bubble-actions">
                {m.status === 'pending' && <><button className="btn sm primary" onClick={() => setEdit({ id: m.id, amount: String(m.amount ?? ''), category: m.category || guessCategory(m.text, cats), method: m.method || 'Cash' })}><Check size={14} />Approve</button><button className="btn sm ghost" onClick={() => reject(m)}><Ban size={14} />Reject</button></>}
                {(m.status === 'note' || m.status === 'rejected') && <button className="btn sm" onClick={() => setEdit({ id: m.id, amount: String(m.amount ?? parseAmount(m.text) ?? ''), category: m.category || guessCategory(m.text, cats), method: m.method || 'Cash' })}><Plus size={14} />Add as expense</button>}
                {m.status === 'posted' && <><button className="btn sm ghost" onClick={() => setEdit({ id: m.id, amount: String(m.amount ?? ''), category: m.category || cats[0], method: m.method || 'Cash' })}><Pencil size={14} />Edit</button><button className="btn sm ghost" onClick={() => undo(m)}><Undo2 size={14} />Undo</button></>}
              </div>}
            </div>
          </div>); })}
        <div ref={endRef} />
      </div>
      <footer className="xchat-compose">
        {d.photos.length > 0 && <div className="compose-photos">{d.photos.map((p, i) => <div key={i} className="compose-ph" style={{ backgroundImage: `url(${p})` }}><button onClick={() => setD({ ...d, photos: d.photos.filter((_, k) => k !== i) })} aria-label="Remove"><X size={12} /></button></div>)}</div>}
        {(d.text || d.photos.length > 0) && <div className="compose-extra">
          <input type="number" inputMode="decimal" placeholder={autoAmount ? `${autoAmount} (found)` : `Amount ${s.currency}`} value={d.amount} onChange={(e) => setD({ ...d, amount: e.target.value })} />
          <select value={autoCat} onChange={(e) => setD({ ...d, category: e.target.value })}>{cats.map((c) => <option key={c}>{c}</option>)}</select>
          <select value={d.method} onChange={(e) => setD({ ...d, method: e.target.value })}>{METHODS.map((x) => <option key={x}>{x}</option>)}</select>
          <input type="date" value={d.date} onChange={(e) => setD({ ...d, date: e.target.value })} />
          <span className="muted compose-preview">{autoAmount ? `${office ? 'Adds' : 'Asks to add'} ${money(autoAmount, s)} · ${autoCat}` : 'No amount — sent as a note'}</span>
        </div>}
        {reading !== null && <div className="compose-reading"><Loader2 size={14} className="spin" />Reading the bill… {Math.round(reading * 100)}%</div>}
        <label className="compose-auto"><input type="checkbox" checked={auto} onChange={(e) => setAutoSave(e.target.checked)} /><ScanText size={14} />Read bill photos and add them automatically</label>
        <div className="compose-row">
          <input ref={camRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => addPhotos(e.target.files)} />
          <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => addPhotos(e.target.files)} />
          <button className="icon-btn" title="Take photo" onClick={() => camRef.current?.click()} disabled={busy}><Camera size={20} /></button>
          <button className="icon-btn" title="Attach pictures" onClick={() => fileRef.current?.click()} disabled={busy}><Paperclip size={19} /></button>
          <textarea rows={1} placeholder="What was it? e.g. Plywood 6 sheets 102.000" value={d.text} onChange={(e) => setD({ ...d, text: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); } }} />
          <button className="btn primary xchat-send" onClick={() => send()} disabled={busy || (!d.text.trim() && !d.photos.length)} aria-label="Send">{busy ? <Loader2 size={18} className="spin" /> : <Send size={18} />}</button>
        </div>
      </footer>
      {big && <div className="modal-back" onMouseDown={() => setBig(null)}><img className="photo-big" src={big} alt="Bill" /></div>}
    </>
  );
}
