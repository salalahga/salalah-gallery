import { useEffect, useMemo, useRef, useState } from 'react';
import { api, qs } from '../core/api';
import { t } from '../core/i18n';
import { money, parseMoney, useSession, variantName, today } from '../core/session';
import { parseCommand, matchVariants } from '../../shared/voice.js';
import { Bottle, Card, Empty, Field, Modal, toast, toastError, useAction, useData } from '../components/ui';
import { Icon } from '../components/Icon';
import { Receipt } from './Receipt';
import { ProductForm } from './Inventory';
import { cleanScan } from '../../shared/barcode.js';

/** Short confirmation beep (high = added, low = problem). Sound needs no files. */
let audio: AudioContext | null = null;
function beep(ok: boolean) {
  try {
    audio ||= new (window.AudioContext || (window as any).webkitAudioContext)();
    const o = audio.createOscillator(), g = audio.createGain();
    o.frequency.value = ok ? 1500 : 320; o.type = 'square'; g.gain.value = 0.05;
    o.connect(g); g.connect(audio.destination); o.start(); o.stop(audio.currentTime + (ok ? 0.08 : 0.3));
  } catch { /* no sound available */ }
}

/** Phone / tablet camera scanning (Chrome on Android, Edge; uses the built-in BarcodeDetector). */
function CameraScan({ onCode, onClose }: { onCode: (c: string) => void; onClose: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    let stream: MediaStream | null = null, stop = false;
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        if (!video.current) return;
        video.current.srcObject = stream; await video.current.play();
        const det = new (window as any).BarcodeDetector({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39'] });
        const loop = async () => {
          if (stop || !video.current) return;
          const found = await det.detect(video.current).catch(() => []);
          if (found[0]?.rawValue) { onCode(found[0].rawValue); return; }
          setTimeout(loop, 180);
        };
        loop();
      } catch (e: any) { setErr(e?.name === 'NotAllowedError' ? 'Allow camera access to scan.' : 'Camera not available on this device.'); }
    })();
    return () => { stop = true; stream?.getTracks().forEach((t) => t.stop()); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Modal title="Scan with camera" onClose={onClose}>
      {err ? <div className="alert bad">{err}</div> : <video ref={video} playsInline muted style={{ width: '100%', borderRadius: 14, background: '#000' }} />}
      <div className="small muted" style={{ marginTop: 8 }}>Hold the barcode inside the picture. It adds automatically when read.</div>
    </Modal>
  );
}

type Item = { id: string; sku: string; barcode?: string; name: string; name_ar?: string; brand?: string; label?: string; size_ml?: number; retail_price: number; qty: number; image_url?: string };
type Line = { variantId: string; qty: number; unitPrice?: number };
type Quote = { lines: any[]; applied: { id: string; name: string; amount: number }[]; subtotal: number; discount: number; net: number; vat: number; total: number; shortages: { variantId: string; available: number; needed: number }[]; customer?: any };
type Pay = { method: string; amount: string; reference: string };
const METHODS: [string, string][] = [['cash', 'Cash'], ['card', 'Card'], ['bank_transfer', 'Bank transfer'], ['wallet', 'Digital wallet'], ['payment_link', 'Payment link'], ['loyalty', 'Loyalty points']];

// Browser speech recognition (Chrome, Edge, Safari). Typed commands work everywhere.
const SR: any = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

export default function POS() {
  const { me, can } = useSession();
  const { data: registers, reload: reloadRegs } = useData<any[]>('/registers');
  const [branchId, setBranchId] = useState<string>(me.user.branchId || me.branchScope?.[0] || 'br_main');
  const { data: catalogue, reload: reloadCat } = useData<Item[]>('/inventory' + qs({ branchId }), [branchId]);
  const [cart, setCart] = useState<Line[]>([]);
  const [customer, setCustomer] = useState<any>(null);
  const [coupon, setCoupon] = useState('');
  const [manual, setManual] = useState<{ type: 'percent' | 'fixed'; value: string } | null>(null);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoteErr, setQuoteErr] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [paying, setPaying] = useState(false);
  const [receipt, setReceipt] = useState<string | null>(null);
  const [voiceLog, setVoiceLog] = useState<{ heard: string; did: string; ok: boolean }[]>([]);
  const [choices, setChoices] = useState<{ qty: number; list: Item[] } | null>(null);
  const [till, setTill] = useState<'open' | 'close' | 'cash' | null>(null);
  const [custOpen, setCustOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  const myBranches = useMemo(() => [...new Map((registers || []).map((r) => [r.branch_id, r.branch])).entries()], [registers]);
  const reg = (registers || []).find((r) => r.branch_id === branchId && r.session_id) || null;
  const byId = useMemo(() => new Map((catalogue || []).map((c) => [c.id, c])), [catalogue]);

  // live price check by the server (promotions, VAT, permission checks) whenever the cart changes
  useEffect(() => {
    if (!cart.length) { setQuote(null); setQuoteErr(null); return; }
    const h = setTimeout(() => {
      api.post<Quote>('/pos/quote', { branchId, items: cart, customerId: customer?.id, couponCode: coupon || undefined, manualDiscount: manual && manual.value ? { type: manual.type, value: manual.type === 'fixed' ? parseMoney(manual.value) : Number(manual.value) } : undefined })
        .then((q) => { setQuote(q); setQuoteErr(null); })
        .catch((e) => { setQuoteErr(e.message); });
    }, 180);
    return () => clearTimeout(h);
  }, [cart, customer, coupon, manual, branchId]);

  const add = (v: Item, qty = 1) => {
    setCart((c) => { const i = c.findIndex((l) => l.variantId === v.id); if (i >= 0) { const n = [...c]; n[i] = { ...n[i], qty: n[i].qty + qty }; return n; } return [...c, { variantId: v.id, qty }]; });
  };
  const setQty = (id: string, q: number) => setCart((c) => (q <= 0 ? c.filter((l) => l.variantId !== id) : c.map((l) => (l.variantId === id ? { ...l, qty: q } : l))));
  const clear = () => { setCart([]); setCustomer(null); setCoupon(''); setManual(null); setQuote(null); };

  const shown = useMemo(() => {
    const s = search.trim().toLowerCase();
    const list = catalogue || [];
    if (!s) return list.slice(0, 60);
    return list.filter((v) => [v.name, v.brand, v.sku, v.barcode, v.label, v.name_ar].some((x) => x && String(x).toLowerCase().includes(s))).slice(0, 60);
  }, [catalogue, search]);

  // ---------- barcode scanning (main way to sell) ----------
  // USB/Bluetooth scanners type the code very fast and press Enter. It works with the cursor in the
  // search box or anywhere else on the screen. Arabic keyboard digits are converted automatically.
  const [scan, setScan] = useState<{ kind: 'ready' | 'ok' | 'err'; text: string; code?: string }>({ kind: 'ready', text: 'Ready to scan — scan a bottle to add it' });
  const [flash, setFlash] = useState<{ id: string; n: number } | null>(null);
  const [newCode, setNewCode] = useState<string | null>(null);
  const [camera, setCamera] = useState(false);
  const handleScan = async (raw: string) => {
    const code = cleanScan(raw);
    if (!code) return;
    const hit = (catalogue || []).find((v) => v.barcode === code || v.sku.toLowerCase() === code.toLowerCase());
    if (hit) {
      const inCart = cart.find((l) => l.variantId === hit.id)?.qty || 0;
      if (hit.qty - inCart <= 0) { beep(false); setScan({ kind: 'err', text: `${variantName(hit)} — no stock left at this branch` }); return; }
      add(hit); beep(true);
      setFlash((f) => ({ id: hit.id, n: (f?.n || 0) + 1 }));
      setScan({ kind: 'ok', text: `Added ${variantName(hit)} · ${money(hit.retail_price)} OMR` });
      return;
    }
    beep(false);
    const other = await api.get<any>('/barcodes/lookup' + qs({ code })).catch(() => null);
    if (other && !other.active) setScan({ kind: 'err', text: `${variantName(other)} is switched off (inactive)`, code });
    else setScan({ kind: 'err', text: `Barcode ${code} is not in the system`, code });
  };
  useEffect(() => {
    let buf = '', last = 0;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
      if (document.querySelector('.modal-bg')) return;
      const now = Date.now();
      if (now - last > 60) buf = '';
      last = now;
      if (e.key === 'Enter') { if (buf.length >= 4) { e.preventDefault(); handleScan(buf); } buf = ''; return; }
      if (e.key.length === 1) buf += e.key;
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  const onSearchEnter = () => {
    const s = cleanScan(search);
    if (!s) return;
    const exact = (catalogue || []).find((v) => v.barcode === s || v.sku.toLowerCase() === s.toLowerCase());
    if (exact || /^[0-9]{6,}$/.test(s)) { handleScan(s); setSearch(''); return; }
    if (shown.length === 1) { add(shown[0]); setSearch(''); return; }
    runCommand(s);
  };

  // ---------- voice / typed commands ----------
  const say = (heard: string, did: string, ok = true) => setVoiceLog((l) => [{ heard, did, ok }, ...l].slice(0, 6));
  const vlist = useMemo(() => (catalogue || []).map((v) => ({ ...v, sizeMl: v.size_ml })), [catalogue]);
  async function runCommand(text: string) {
    const c = parseCommand(text);
    if (c.intent === 'add') {
      const m = matchVariants(c.query, c.sizeMl, vlist, 6);
      if (!m.length) return say(text, `No product matches “${c.query}”`, false);
      const clear1 = m.length === 1 || m[0].score >= m[1].score * 1.25;
      if (clear1) { add(m[0], c.qty); setSearch(''); return say(text, `Added ${c.qty} × ${variantName(m[0])}`); }
      setChoices({ qty: c.qty, list: m });
      return say(text, `Several matches for “${c.query}” — choose one`, true);
    }
    if (c.intent === 'remove') {
      const inCart = vlist.filter((v) => cart.some((l) => l.variantId === v.id));
      const m = matchVariants(c.query, c.sizeMl, inCart, 1)[0];
      if (!m) return say(text, 'That item is not in the cart', false);
      setQty(m.id, 0); return say(text, `Removed ${variantName(m)}`);
    }
    if (c.intent === 'discount') {
      if (!can('pos', 'edit')) return say(text, 'You are not allowed to give discounts', false);
      if (c.percent != null) { setManual({ type: 'percent', value: String(c.percent) }); return say(text, `Discount ${c.percent}% requested — check the total`); }
      if (c.amount != null) { setManual({ type: 'fixed', value: String(c.amount) }); return say(text, `Discount ${c.amount} OMR requested — check the total`); }
    }
    if (c.intent === 'availability') {
      const m = matchVariants(c.query, c.sizeMl, vlist, 3);
      if (!m.length) return say(text, `No product matches “${c.query}”`, false);
      return say(text, m.map((v) => `${variantName(v)}: ${v.qty} in stock`).join(' · '));
    }
    if (c.intent === 'today_sales') {
      try {
        const rows = await api.get<any[]>('/sales' + qs({ from: today(), to: today() }));
        const live = rows.filter((r) => !['cancelled', 'pending'].includes(r.status));
        return say(text, `Today: ${live.length} sales, ${money(live.reduce((a, r) => a + r.total - r.refunded, 0))} OMR${can('sales') ? '' : ' (your sales)'}`);
      } catch (e: any) { return say(text, e.message, false); }
    }
    if (c.intent === 'customer') {
      try {
        const rows = await api.get<any[]>('/customers' + qs({ search: c.phone }));
        if (!rows.length) return say(text, `No customer with ${c.phone}`, false);
        setCustomer(rows[0]); return say(text, `Customer: ${rows[0].name}`);
      } catch (e: any) { return say(text, e.message, false); }
    }
    if (c.intent === 'checkout') { if (!cart.length) return say(text, 'The cart is empty', false); setPaying(true); return say(text, 'Opened payment — confirm on screen'); }
    if (c.intent === 'clear') { clear(); return say(text, 'Cart cleared'); }
    say(text, 'Command not understood', false);
  }

  const [listening, setListening] = useState(false);
  const [voiceLang, setVoiceLang] = useState<'en-US' | 'ar-OM'>(document.documentElement.lang === 'ar' ? 'ar-OM' : 'en-US');
  const recRef = useRef<any>(null);
  const listen = () => {
    if (!SR) return toast('Voice input is not supported in this browser. Type the command instead (Chrome, Edge or Safari support voice).', true);
    if (listening) { recRef.current?.stop(); return; }
    const r = new SR();
    r.lang = voiceLang; r.interimResults = false; r.maxAlternatives = 1; r.continuous = false;
    r.onresult = (e: any) => { const text = e.results[0][0].transcript; runCommand(text); };
    r.onerror = (e: any) => toast(e.error === 'not-allowed' ? 'Allow microphone access to use voice commands' : 'Voice error: ' + e.error, true);
    r.onend = () => setListening(false);
    recRef.current = r; r.start(); setListening(true);
  };

  if (!registers || !catalogue) return <Empty>Loading the till…</Empty>;
  const lineOf = (id: string) => quote?.lines.find((l) => l.variantId === id);
  const short = new Set((quote?.shortages || []).map((s) => s.variantId));

  return (
    <>
      <div className="row no-print" style={{ marginBottom: 12 }}>
        {myBranches.length > 1 && <select value={branchId} onChange={(e) => { setBranchId(e.target.value); clear(); }} style={{ width: 'auto' }}>{myBranches.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select>}
        {reg ? <span className="badge ok">Till open: {reg.name} · {reg.opened_by_name}</span> : <span className="badge warn">Till closed — cash sales need an open till</span>}
        <div className="grow" />
        {reg ? <><button className="btn sm" onClick={() => setTill('cash')} disabled={!can('pos', 'edit')}>Pay in / out</button><button className="btn sm" onClick={() => setTill('close')}>Close till</button></> : <button className="btn sm primary" onClick={() => setTill('open')}>Open till</button>}
      </div>

      <div className="voice no-print" style={{ marginBottom: 12 }}>
        <button className={'mic' + (listening ? ' live' : '')} onClick={listen} title={t('Speak')} aria-label={t('Speak')}><Icon name="mic" size={20} /></button>
        <select value={voiceLang} onChange={(e) => setVoiceLang(e.target.value as 'en-US')} style={{ width: 'auto', background: '#1c1c21', color: '#f4ecd7', borderColor: '#33333a' }} aria-label="Voice language"><option value="en-US">EN</option><option value="ar-OM">ع</option></select>
        {'BarcodeDetector' in window && <button className="mic" style={{ background: 'linear-gradient(135deg,#c8d6c4,#7f9a7b)' }} onClick={() => setCamera(true)} title="Scan with camera" aria-label="Scan with camera">▦</button>}
        <input ref={searchRef} value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && onSearchEnter()} placeholder="Scan barcode, search, or type a command: “add two Khamrah”, “apply 10% discount”, “check availability of Oud Wood”" autoFocus />
      </div>
      <div className={'scanbar no-print ' + scan.kind}>
        <span className="dot" /><span className="grow">{scan.text}</span>
        {scan.kind === 'err' && scan.code && can('inventory', 'create') && <button className="btn sm" onClick={() => setNewCode(scan.code!)}>Create product with this barcode</button>}
      </div>
      {voiceLog.length > 0 && <div className="col no-print" style={{ marginBottom: 10, gap: 4 }}>{voiceLog.slice(0, 3).map((v, i) => <div key={i} className={'small ' + (v.ok ? '' : 'bad')}>🎙 “{v.heard}” → {v.did}</div>)}</div>}

      <div className="pos">
        <div>
          <div className="products">
            {shown.map((v) => (
              <button key={v.id} className="pcard" onClick={() => add(v)} disabled={v.qty <= 0} style={{ opacity: v.qty <= 0 ? 0.45 : 1 }}>
                <Bottle name={v.brand || v.name} url={v.image_url} />
                <div style={{ minWidth: 0 }}>
                  <div className="pn">{v.brand} {v.name}</div>
                  <div className="small muted">{v.label || (v.size_ml ? v.size_ml + 'ml' : '')} · {v.qty} in stock</div>
                  <div className="pp">{money(v.retail_price)}</div>
                </div>
              </button>
            ))}
            {!shown.length && <Empty>No product found</Empty>}
          </div>
        </div>

        <Card className="cart" title={t('New sale')} actions={cart.length ? <button className="btn ghost sm" onClick={clear}>Clear</button> : null}>
          <div className="row" style={{ marginBottom: 8 }}>
            {customer ? <div className="grow"><b>{customer.name}</b> <span className="small muted">{customer.phone}</span>{customer.vip && <span className="badge gold">VIP</span>}{quote?.customer && <div className="small muted">{quote.customer.loyaltyPoints} points{quote.customer.creditEnabled ? ' · credit account' : ''}</div>}</div> : <div className="grow muted small">Walk-in customer</div>}
            <button className="btn sm" onClick={() => setCustOpen(true)}>{customer ? 'Change' : '+ ' + t('Customer')}</button>
            {customer && <button className="btn ghost sm" onClick={() => setCustomer(null)}>✕</button>}
          </div>
          {!cart.length && <Empty>Tap a product, scan a barcode or speak.</Empty>}
          {cart.map((l) => {
            const v = byId.get(l.variantId);
            const q = lineOf(l.variantId);
            return (
              <div className={'line' + (flash?.id === l.variantId ? ' scanflash' : '')} key={l.variantId + (flash?.id === l.variantId ? flash.n : '')}>
                <div>
                  <div style={{ fontWeight: 600 }}>{v ? variantName(v) : l.variantId}</div>
                  <div className="row small" style={{ gap: 6 }}>
                    <span className="qty"><button onClick={() => setQty(l.variantId, l.qty - 1)}>−</button><span>{l.qty}</span><button onClick={() => setQty(l.variantId, l.qty + 1)}>+</button></span>
                    × {can('pos', 'edit') ? <input style={{ width: 80, padding: '3px 6px' }} defaultValue={money(l.unitPrice ?? v?.retail_price)} onBlur={(e) => { const p = parseMoney(e.target.value); if (!Number.isNaN(p) && p > 0) setCart((c) => c.map((x) => (x.variantId === l.variantId ? { ...x, unitPrice: p === v?.retail_price ? undefined : p } : x))); }} aria-label="Unit price" /> : money(v?.retail_price)}
                    {short.has(l.variantId) && <span className="badge bad">only {v?.qty} in stock</span>}
                  </div>
                  {q?.discount > 0 && <div className="small ok">− {money(q.discount)} discount</div>}
                </div>
                <div className="num"><b>{money(q?.total ?? (l.unitPrice ?? v?.retail_price ?? 0) * l.qty)}</b><br /><button className="btn ghost sm" onClick={() => setQty(l.variantId, 0)} aria-label="Remove">✕</button></div>
              </div>
            );
          })}
          {cart.length > 0 && (
            <>
              <div className="row" style={{ marginTop: 10 }}>
                <input placeholder="Coupon code" value={coupon} onChange={(e) => setCoupon(e.target.value.toUpperCase())} style={{ flex: 1 }} />
                {can('pos', 'edit') && <>
                  <select value={manual?.type || 'percent'} onChange={(e) => setManual({ type: e.target.value as 'percent', value: manual?.value || '' })} style={{ width: 70 }}><option value="percent">%</option><option value="fixed">OMR</option></select>
                  <input placeholder={t('Discount')} value={manual?.value || ''} onChange={(e) => setManual({ type: manual?.type || 'percent', value: e.target.value })} style={{ width: 90 }} />
                </>}
              </div>
              {quoteErr && <div className="alert bad" style={{ marginTop: 8 }}>{quoteErr}</div>}
              {quote?.applied.map((a) => <div key={a.id} className="small ok" style={{ marginTop: 6 }}>✓ {a.name}: −{money(a.amount)}</div>)}
              {quote && (
                <div className="totals">
                  <span className="muted">{t('Subtotal')}</span><span>{money(quote.subtotal)}</span>
                  {quote.discount > 0 && <><span className="muted">{t('Discount')}</span><span className="ok">−{money(quote.discount)}</span></>}
                  <span className="muted">{t('VAT')} {me.settings.tax.pricesIncludeVat ? '(included)' : ''}</span><span>{money(quote.vat)}</span>
                  <span className="grand">{t('Total')}</span><span className="grand">{money(quote.total)}</span>
                </div>
              )}
              <button className="btn gold lg" style={{ width: '100%', marginTop: 12 }} disabled={!quote || !!quoteErr || !!quote.shortages.length} onClick={() => setPaying(true)}>{t('Pay')} {quote && money(quote.total)}</button>
            </>
          )}
        </Card>
      </div>

      {choices && (
        <Modal title="Which product?" onClose={() => setChoices(null)}>
          <div className="col">{choices.list.map((v) => <button key={v.id} className="pcard" onClick={() => { add(v, choices.qty); setChoices(null); }}><Bottle name={v.brand} /><div><div className="pn">{variantName(v)}</div><div className="small muted">{v.qty} in stock · {money(v.retail_price)}</div></div></button>)}</div>
        </Modal>
      )}
      {custOpen && <CustomerPick onPick={(c) => { setCustomer(c); setCustOpen(false); }} onClose={() => setCustOpen(false)} />}
      {paying && quote && (
        <Payment quote={quote} customer={quote.customer} tillOpen={!!reg} onClose={() => setPaying(false)} onPaid={(id) => { setPaying(false); setReceipt(id); clear(); reloadCat(); }}
          payload={{ branchId, items: cart, customerId: customer?.id, couponCode: coupon || undefined, manualDiscount: manual && manual.value ? { type: manual.type, value: manual.type === 'fixed' ? parseMoney(manual.value) : Number(manual.value) } : undefined }} />
      )}
      {camera && <CameraScan onCode={(c) => { setCamera(false); handleScan(c); }} onClose={() => setCamera(false)} />}
      {newCode && <ProductForm id={null} barcode={newCode} onClose={() => setNewCode(null)} onDone={() => { setNewCode(null); reloadCat(); setScan({ kind: 'ready', text: 'Product created — scan it again to add it' }); }} />}
      {receipt && <Receipt saleId={receipt} onClose={() => { setReceipt(null); searchRef.current?.focus(); }} />}
      {till && <Till mode={till} branchId={branchId} reg={reg} registers={registers} onClose={() => setTill(null)} onDone={() => { setTill(null); reloadRegs(); }} />}
    </>
  );
}

function Payment({ quote, payload, customer, tillOpen, onClose, onPaid }: { quote: Quote; payload: any; customer: any; tillOpen: boolean; onClose: () => void; onPaid: (id: string) => void }) {
  const [pays, setPays] = useState<Pay[]>([{ method: tillOpen ? 'cash' : 'card', amount: money(quote.total), reference: '' }]);
  const [confirmed, setConfirmed] = useState(false);
  const { busy, run } = useAction();
  const sum = pays.reduce((a, p) => a + (parseMoney(p.amount) || 0), 0);
  const cashSum = pays.filter((p) => p.method === 'cash').reduce((a, p) => a + (parseMoney(p.amount) || 0), 0);
  const change = Math.max(0, Math.min(sum - quote.total, cashSum));
  const due = Math.max(0, quote.total - sum);
  const set = (i: number, k: keyof Pay, v: string) => setPays((p) => p.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
  const submit = () => run(async () => {
    const r = await api.post('/pos/checkout', { ...payload, confirmed: true, payments: pays.map((p) => ({ method: p.method, amount: parseMoney(p.amount), reference: p.reference || undefined })) });
    if (r.change) toast(`Change to give: ${money(r.change)} OMR`);
    onPaid(r.id);
  }, 'Sale completed');
  return (
    <Modal title={`Payment — ${money(quote.total)} OMR`} onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>Back to cart</button>
      <button className="btn gold lg" disabled={busy || !confirmed || (due > 0 && !customer?.creditEnabled)} onClick={submit}>{t('Confirm & take payment')}</button>
    </>}>
      <div className="col">
        {pays.map((p, i) => (
          <div className="row" key={i}>
            <select value={p.method} onChange={(e) => set(i, 'method', e.target.value)} style={{ width: 160 }}>{METHODS.map(([k, l]) => <option key={k} value={k} disabled={(k === 'cash' && !tillOpen) || (k === 'loyalty' && !customer)}>{t(l)}</option>)}</select>
            <input value={p.amount} onChange={(e) => set(i, 'amount', e.target.value)} inputMode="decimal" style={{ width: 120 }} aria-label="Amount" />
            {p.method !== 'cash' && <input value={p.reference} onChange={(e) => set(i, 'reference', e.target.value)} placeholder={p.method === 'card' ? 'Approval code / last 4 (never the card number)' : 'Reference'} style={{ flex: 1 }} />}
            {pays.length > 1 && <button className="btn ghost sm" onClick={() => setPays(pays.filter((_, j) => j !== i))}>✕</button>}
          </div>
        ))}
        <div className="row">
          <button className="btn sm" onClick={() => setPays([...pays, { method: 'card', amount: money(due), reference: '' }])}>+ Split payment</button>
          {[5, 10, 20, 50].map((n) => <button key={n} className="btn sm" disabled={!tillOpen} onClick={() => setPays([{ method: 'cash', amount: String(Math.max(n, Math.ceil(quote.total / 1000 / n) * n)), reference: '' }])}>Cash {Math.max(n, Math.ceil(quote.total / 1000 / n) * n)}</button>)}
        </div>
        <div className="totals">
          <span>Received</span><span>{money(sum)}</span>
          {change > 0 && <><span className="grand">Change</span><span className="grand ok">{money(change)}</span></>}
          {due > 0 && <><span className="bad">Balance due</span><span className="bad">{money(due)}</span></>}
        </div>
        {due > 0 && (customer?.creditEnabled ? <div className="alert">The balance of {money(due)} will be added to {customer.name}'s credit account.</div> : <div className="alert bad">Take the full amount (or select a customer with a credit account).</div>)}
        {!tillOpen && <div className="small muted">Cash is disabled because the till is closed.</div>}
        <label className="check" style={{ marginTop: 6 }}><input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} /> I have checked the items and the amount with the customer.</label>
      </div>
    </Modal>
  );
}

export function CustomerPick({ onPick, onClose }: { onPick: (c: any) => void; onClose: () => void }) {
  const [s, setS] = useState('');
  const [rows, setRows] = useState<any[]>([]);
  const [nw, setNw] = useState({ name: '', phone: '' });
  const { busy, run } = useAction();
  useEffect(() => { const h = setTimeout(() => api.get<any[]>('/customers' + qs({ search: s })).then(setRows).catch(toastError), 200); return () => clearTimeout(h); }, [s]);
  return (
    <Modal title="Customer" onClose={onClose}>
      <input autoFocus placeholder="Search name or phone" value={s} onChange={(e) => setS(e.target.value)} />
      <div style={{ maxHeight: 260, overflowY: 'auto', margin: '10px 0' }}>
        <table className="t"><tbody>{rows.slice(0, 30).map((c) => <tr key={c.id} className="click" onClick={() => onPick(c)}><td><b>{c.name}</b> {c.vip && <span className="badge gold">VIP</span>}</td><td>{c.phone}</td><td className="num small muted">{c.loyalty_points} pts</td></tr>)}</tbody></table>
      </div>
      <hr className="sep" />
      <div className="row">
        <input placeholder="New customer name" value={nw.name} onChange={(e) => setNw({ ...nw, name: e.target.value })} style={{ flex: 2 }} />
        <input placeholder="Phone" value={nw.phone} onChange={(e) => setNw({ ...nw, phone: e.target.value })} style={{ flex: 1 }} inputMode="tel" />
        <button className="btn primary" disabled={busy || !nw.name} onClick={() => run(async () => { const r = await api.post('/customers', { ...nw, source: 'pos' }); onPick({ id: r.id, ...nw }); }, 'Customer added')}>Add</button>
      </div>
    </Modal>
  );
}

function Till({ mode, branchId, reg, registers, onClose, onDone }: { mode: 'open' | 'close' | 'cash'; branchId: string; reg: any; registers: any[]; onClose: () => void; onDone: () => void }) {
  const [float, setFloat] = useState('50');
  const [regId, setRegId] = useState(registers.find((r) => r.branch_id === branchId && !r.session_id)?.id || '');
  const [counted, setCounted] = useState('');
  const [note, setNote] = useState('');
  const [mv, setMv] = useState({ kind: 'pay_out', amount: '', reason: '' });
  const { data: sum } = useData<any>(mode === 'close' && reg ? `/register-sessions/${reg.session_id}` : null);
  const { busy, run } = useAction();
  if (mode === 'open') return (
    <Modal title="Open till" onClose={onClose} footer={<button className="btn primary" disabled={busy || !regId} onClick={() => run(() => api.post(`/registers/${regId}/open`, { openingFloat: parseMoney(float) }), 'Till opened').then((r) => r && onDone())}>Open</button>}>
      <div className="col">
        <Field label="Register"><select value={regId} onChange={(e) => setRegId(e.target.value)}>{registers.filter((r) => r.branch_id === branchId && !r.session_id).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></Field>
        <Field label="Opening cash float (OMR)"><input value={float} onChange={(e) => setFloat(e.target.value)} inputMode="decimal" /></Field>
      </div>
    </Modal>
  );
  if (mode === 'cash') return (
    <Modal title="Cash in / out of the till" onClose={onClose} footer={<button className="btn primary" disabled={busy} onClick={() => run(() => api.post(`/register-sessions/${reg.session_id}/cash`, { kind: mv.kind, amount: parseMoney(mv.amount), reason: mv.reason }), 'Recorded').then((r) => r && onDone())}>Record</button>}>
      <div className="col">
        <div className="pill-group">{[['pay_out', 'Pay out (petty expense)'], ['pay_in', 'Pay in (add cash)']].map(([k, l]) => <button key={k} className={mv.kind === k ? 'on' : ''} onClick={() => setMv({ ...mv, kind: k })}>{l}</button>)}</div>
        <Field label="Amount (OMR)"><input value={mv.amount} onChange={(e) => setMv({ ...mv, amount: e.target.value })} inputMode="decimal" /></Field>
        <Field label="Reason"><input value={mv.reason} onChange={(e) => setMv({ ...mv, reason: e.target.value })} /></Field>
      </div>
    </Modal>
  );
  const variance = sum && counted ? parseMoney(counted) - sum.expectedCash : null;
  return (
    <Modal title="Close till — daily cash closing" onClose={onClose} footer={<><button className="btn" onClick={() => window.print()}>Print</button><button className="btn primary" disabled={busy || !counted} onClick={() => run(() => api.post(`/register-sessions/${reg.session_id}/close`, { countedCash: parseMoney(counted), note }), 'Till closed').then((r) => r && onDone())}>Close till</button></>}>
      {!sum ? <Empty>Loading…</Empty> : (
        <div className="col">
          <table className="t"><tbody>
            <tr><td>Opening float</td><td className="num">{money(sum.session.opening_float)}</td></tr>
            {sum.byMethod.map((m: any) => <tr key={m.method + m.direction}><td>{m.method.replace('_', ' ')} {m.direction === 'out' ? 'refunds' : 'received'} ({m.n})</td><td className="num">{m.direction === 'out' ? '−' : ''}{money(m.amount)}</td></tr>)}
            <tr><td>Pay in / pay out</td><td className="num">{money(sum.payIn)} / −{money(sum.payOut)}</td></tr>
            <tr><td><b>Expected cash in drawer</b></td><td className="num"><b>{money(sum.expectedCash)}</b></td></tr>
            <tr><td>Sales on this till</td><td className="num">{sum.sales} · {money(sum.salesTotal)}</td></tr>
          </tbody></table>
          <Field label="Cash counted (OMR)"><input value={counted} onChange={(e) => setCounted(e.target.value)} inputMode="decimal" autoFocus /></Field>
          {variance != null && !Number.isNaN(variance) && <div className={'alert ' + (variance === 0 ? 'ok' : 'bad')}>{variance === 0 ? 'Cash matches.' : `${variance > 0 ? 'Over' : 'Short'} by ${money(Math.abs(variance))} OMR — this will be recorded.`}</div>}
          <Field label="Note"><input value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        </div>
      )}
    </Modal>
  );
}
