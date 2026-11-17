import { useEffect, useMemo, useRef, useState } from 'react';
import JsBarcode from 'jsbarcode';
import QRCode from 'qrcode';
import { detectSymbology } from '../../shared/barcode.js';
import { layoutLabel, toZPL, toTSPL, toESCPOS, hasNonAscii, fieldText, type Template, type LabelData } from '../../shared/labels.js';
import { api } from '../core/api';
import { agent } from '../core/agent';
import { useSession, variantName } from '../core/session';
import { Field, Modal, toast, toastError, useData } from './ui';

const JS_FORMAT: Record<string, string> = { ean13: 'EAN13', ean8: 'EAN8', code128: 'CODE128', code39: 'CODE39' };

/** Barcode drawn as SVG on screen. */
export function Barcode({ code, symbology, height = 40, width = 1.6, fontSize = 12 }: { code: string; symbology?: string | null; height?: number; width?: number; fontSize?: number }) {
  const ref = useRef<SVGSVGElement>(null);
  useEffect(() => {
    if (!ref.current || !code) return;
    try { JsBarcode(ref.current, code, { format: JS_FORMAT[symbology || detectSymbology(code)] || 'CODE128', height, width, fontSize, margin: 0, displayValue: true, textMargin: 1, background: 'transparent' }); }
    catch { ref.current.replaceChildren(); }
  }, [code, symbology, height, width, fontSize]);
  return <svg ref={ref} style={{ maxWidth: '100%', height: 'auto' }} />;
}

export type LabelItem = { id: string; barcode?: string | null; symbology?: string | null; sku: string; name: string; brand?: string | null; label?: string | null; size_ml?: number | null; retail_price: number; original_price?: number | null; batch_no?: string | null; copies: number };
export type Printer = {
  id: string; name: string; model?: string; connection: 'browser' | 'network' | 'usb' | 'bluetooth'; language: 'driver' | 'zpl' | 'tspl' | 'escpos'; host?: string; port?: number; queue?: string;
  dpi: number; density: number; speed: number; orientation: number; label_width_mm: number; label_height_mm: number; gap_mm: number; cols: number; col_gap_mm: number; offset_x_mm: number; offset_y_mm: number;
  template_id?: string; is_default: boolean; active: boolean; last_test_at?: string; last_test_ok?: boolean | null; last_test_method?: string; last_test_detail?: string; branch?: string; branch_id?: string;
};
export type PageOpts = { cols: number; colGapMm: number; offsetXMm: number; offsetYMm: number; a4?: boolean };
export const pageOf = (p?: Printer | null): PageOpts => ({ cols: p?.cols || 1, colGapMm: Number(p?.col_gap_mm ?? 2), offsetXMm: Number(p?.offset_x_mm || 0), offsetYMm: Number(p?.offset_y_mm || 0) });
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

function barcodeSvg(code: string, sym: string, module: number) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  try { JsBarcode(svg, code, { format: JS_FORMAT[sym] || 'CODE128', height: 60, width: module, fontSize: 16, margin: 0, marginLeft: 12, marginRight: 12, displayValue: true, textMargin: 1, background: '#ffffff' }); }
  catch { return `<div style="font:700 7pt Arial">${esc(code)} (cannot draw as ${esc(sym)})</div>`; }
  const w = svg.getAttribute('width')?.replace('px', '') || '200', h = svg.getAttribute('height')?.replace('px', '') || '60';
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`); svg.setAttribute('preserveAspectRatio', 'none');
  svg.removeAttribute('width'); svg.removeAttribute('height'); svg.removeAttribute('style');
  return svg.outerHTML;
}

/**
 * Self-contained HTML print document from the shared layout. Page size = exactly the label stock,
 * so the operating-system driver prints label by label instead of on A4.
 */
export async function labelHtml(tpl: Template, labels: LabelData[], shop: string, page: PageOpts, preview = false) {
  const qrCache = new Map<string, string>();
  const one = async (it: LabelData) => {
    const parts: string[] = [];
    for (const e of layoutLabel(tpl, it, shop)) {
      const box = `left:${e.x}mm;top:${e.y}mm;`;
      if (e.type === 'text') parts.push(`<div class="t" style="${box}width:${e.w}mm;height:${e.h}mm;font-size:${e.size.toFixed(2)}pt;text-align:${e.align};font-weight:${e.bold ? 700 : 400}">${esc(e.text)}</div>`);
      else if (e.type === 'barcode') parts.push(`<div class="b" style="${box}width:${e.w}mm;height:${e.h}mm">${barcodeSvg(e.code, e.sym, e.module)}</div>`);
      else if (e.type === 'logo') parts.push(`<img class="l" src="${location.origin}/brand/logo-dark.png" style="${box}width:${e.w}mm;height:${e.h}mm" alt="">`);
      else if (e.type === 'qr') {
        if (!qrCache.has(e.data)) qrCache.set(e.data, await QRCode.toString(e.data, { type: 'svg', margin: 0, errorCorrectionLevel: 'M' }));
        parts.push(`<div class="q" style="${box}width:${e.size}mm;height:${e.size}mm">${qrCache.get(e.data)}</div>`);
      }
    }
    return `<div class="lbl">${parts.join('')}</div>`;
  };
  const W = tpl.widthMm, H = tpl.heightMm;
  let body: string, pageCss: string;
  if (page.a4) {
    const cols = Math.max(1, Math.floor(200 / W)), rowsPerPage = Math.max(1, Math.floor(277 / H));
    pageCss = '@page { size: A4 portrait; margin: 10mm 5mm; }';
    const cells = await Promise.all(labels.map(one));
    const pages: string[] = [];
    for (let i = 0; i < cells.length; i += cols * rowsPerPage) pages.push(`<div class="sheet" style="grid-template-columns:repeat(${cols},${W}mm);grid-auto-rows:${H}mm">${cells.slice(i, i + cols * rowsPerPage).join('')}</div>`);
    body = pages.join('');
  } else {
    const pw = page.cols * W + (page.cols - 1) * page.colGapMm + Math.max(0, page.offsetXMm);
    pageCss = `@page { size: ${pw}mm ${H + Math.max(0, page.offsetYMm)}mm; margin: 0; }`;
    const rows: string[] = [];
    for (let i = 0; i < labels.length; i += page.cols) rows.push(`<div class="row" style="width:${pw}mm;height:${H + Math.max(0, page.offsetYMm)}mm;gap:${page.colGapMm}mm;padding:${Math.max(0, page.offsetYMm)}mm 0 0 ${Math.max(0, page.offsetXMm)}mm">${(await Promise.all(labels.slice(i, i + page.cols).map(one))).join('')}</div>`);
    body = rows.join('');
  }
  return `<!doctype html><html><head><meta charset="utf-8"><title>Labels</title><style>
${pageCss}
* { box-sizing: border-box; } html, body { margin: 0; padding: 0; background: #fff; color: #000; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { font-family: Arial, Helvetica, sans-serif; }
.row { display: flex; overflow: hidden; break-after: page; page-break-after: always; } .row:last-child { break-after: auto; page-break-after: auto; }
.sheet { display: grid; break-after: page; page-break-after: always; } .sheet:last-child { break-after: auto; }
.lbl { position: relative; width: ${W}mm; height: ${H}mm; overflow: hidden; flex: none; }
.t { position: absolute; line-height: 1.12; white-space: nowrap; overflow: hidden; text-overflow: clip; }
.b, .q, .l { position: absolute; display: flex; align-items: center; justify-content: center; } .b svg, .q svg { width: 100%; height: 100%; display: block; } .l { object-fit: contain; }
${preview ? 'body { padding: 10px; background: #efe8dc; } .row, .sheet { background: #fff; margin-bottom: 8px; outline: 1px dashed #b9ab95; } .lbl { outline: 1px dotted #d3c4ad; }' : ''}
</style></head><body>${body}</body></html>`;
}

function printViaBrowser(html: string) {
  const f = document.createElement('iframe');
  f.setAttribute('aria-hidden', 'true');
  Object.assign(f.style, { position: 'fixed', right: '0', bottom: '0', width: '0', height: '0', border: '0' });
  document.body.appendChild(f);
  const w = f.contentWindow!;
  w.document.open(); w.document.write(html); w.document.close();
  return new Promise<void>((resolve) => {
    const go = () => { w.focus(); w.print(); resolve(); setTimeout(() => f.remove(), 3000); };
    setTimeout(go, 250);
  });
}

/** Raw command data for a printer that speaks ZPL / TSPL / ESC/POS. */
export function printerCommands(p: Printer, tpl: Template, labels: LabelData[], shop: string): Uint8Array | string {
  const opts = { dpi: p.dpi, density: p.density, speed: p.speed, orientation: p.orientation, cols: p.cols, colGapMm: Number(p.col_gap_mm), offsetXMm: Number(p.offset_x_mm), offsetYMm: Number(p.offset_y_mm), gapMm: Number(p.gap_mm) };
  if (p.language === 'zpl') return toZPL(tpl, labels, shop, opts);
  if (p.language === 'tspl') return toTSPL(tpl, labels, shop, opts);
  return toESCPOS(tpl, labels, shop, opts);
}
const agentTarget = (p: Printer) => (p.connection === 'network' ? { connection: 'network', host: p.host, port: p.port || 9100 } : { connection: 'queue', queue: p.queue });

/**
 * Send labels to a printer. Returns an honest status:
 *  sent           — the print agent confirmed the bytes reached the printer / print queue
 *  dialog_opened  — the browser print window opened (the browser cannot tell whether paper came out)
 */
export async function sendLabels(p: Printer | null, tpl: Template, labels: LabelData[], shop: string): Promise<{ status: 'sent' | 'dialog_opened'; detail: string }> {
  if (!p || p.connection === 'browser' || p.language === 'driver') {
    await printViaBrowser(await labelHtml(tpl, labels, shop, pageOf(p)));
    return { status: 'dialog_opened', detail: `Browser print window opened${p ? ` for ${p.name}` : ''}` };
  }
  const r = await agent.print(agentTarget(p) as any, printerCommands(p, tpl, labels, shop));
  return { status: 'sent', detail: `Print agent delivered ${r.bytes} bytes to ${p.connection === 'network' ? `${p.host}:${p.port || 9100}` : p.queue}` };
}
export const agentProbe = (p: Printer) => agent.probe({ ...agentTarget(p), language: p.language } as any);

/** Pick printer, template and copies, preview, print — and record it in the printing history. */
export function LabelPrinter({ items: initial, onClose, source = 'bulk', refId, reprintOf, reason }: { items: LabelItem[]; onClose: () => void; source?: string; refId?: string; reprintOf?: string; reason?: string }) {
  const { me, can } = useSession();
  const shop = me.settings.business.name;
  const { data: printers } = useData<Printer[]>('/printers');
  const { data: templates } = useData<Template[]>('/label-templates');
  const [printerId, setPrinterId] = useState<string>(() => { try { return localStorage.getItem('pf-label-printer') || ''; } catch { return ''; } });
  const [templateId, setTemplateId] = useState<string>('');
  const [items, setItems] = useState(initial.map((i) => ({ ...i, copies: Math.max(0, i.copies ?? 1) })));
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState('');
  const active = (printers || []).filter((p) => p.active);
  const printer = printerId === 'browser' ? null : active.find((p) => p.id === printerId) || active.find((p) => p.is_default) || null;
  const tpl = (templates || []).find((t) => t.id === templateId) || (templates || []).find((t) => t.id === printer?.template_id) || (templates || []).find((t) => t.id === 'tpl_small');
  const labels = useMemo(() => items.flatMap((it) => Array.from({ length: it.copies }, () => it)), [items]);
  useEffect(() => { if (tpl) labelHtml(tpl, labels.slice(0, Math.max(2, (printer?.cols || 1) * 2)), shop, pageOf(printer), true).then(setPreview); }, [tpl, labels, printer, shop]);
  const warnings: string[] = [];
  if (tpl && printer && printer.language !== 'driver' && (Number(printer.label_width_mm) !== tpl.widthMm || Number(printer.label_height_mm) !== tpl.heightMm)) warnings.push(`The template is ${tpl.widthMm} × ${tpl.heightMm} mm but ${printer.name} is set for ${printer.label_width_mm} × ${printer.label_height_mm} mm labels.`);
  if (tpl && printer && printer.language !== 'driver' && items.some((it) => hasNonAscii([fieldText('name', it, shop), it.brand, shop].join(' ')))) warnings.push('Printer languages print plain Latin letters only: accents are simplified and Arabic text is left out. Use a browser/driver printer for Arabic labels.');
  if (printer && printer.last_test_ok !== true) warnings.push(`${printer.name} has not passed a connection test yet.`);
  if (items.some((i) => !i.barcode)) warnings.push('Some products have no barcode.');

  const print = async () => {
    if (!tpl || !labels.length) return;
    setBusy(true);
    let jobId: string | null = null;
    try {
      const job = await api.post('/print-jobs', { printerId: printer?.id, printerName: printer?.name || 'Browser print window', templateId: tpl.id, templateName: tpl.name, source, refId, reprintOf, reason,
        items: items.filter((i) => i.copies > 0).map((i) => ({ variantId: i.id, copies: i.copies, batchNo: i.batch_no })) });
      jobId = job.id;
      const r = await sendLabels(printer, tpl, labels, shop);
      await api.post(`/print-jobs/${jobId}/result`, r);
      toast(r.status === 'sent' ? `${job.number}: ${labels.length} labels sent to ${printer?.name}` : `${job.number}: print window opened — check that ${labels.length} labels came out`);
      try { localStorage.setItem('pf-label-printer', printer ? printer.id : 'browser'); } catch { /* ignore */ }
      onClose();
    } catch (e: any) {
      if (jobId) await api.post(`/print-jobs/${jobId}/result`, { status: 'failed', detail: e.message }).catch(() => {});
      toastError(e);
    } finally { setBusy(false); }
  };

  return (
    <Modal wide title="Print barcode labels" onClose={onClose} footer={<>
      <a className="btn" href="#/barcodes/printers" onClick={onClose}>Printer settings</a>
      <button className="btn gold" disabled={busy || !labels.length || !tpl || !can('barcodes', 'create')} onClick={print}>{busy ? 'Printing…' : `Print ${labels.length} label${labels.length === 1 ? '' : 's'}`}</button>
    </>}>
      {!can('barcodes', 'create') && <div className="alert bad" style={{ marginBottom: 10 }}>You are not allowed to print labels. Ask the owner to give you “Barcodes & label printing → create”.</div>}
      <div className="grid g2">
        <div className="col">
          <div className="row">
            <Field label="Printer"><select value={printer?.id || 'browser'} onChange={(e) => setPrinterId(e.target.value)}>
              <option value="browser">{active.length ? 'Browser print window (any installed printer)' : 'Browser print (no printer set up yet)'}</option>
              {active.map((p) => <option key={p.id} value={p.id}>{p.name}{p.is_default ? ' (default)' : ''} — {p.language === 'driver' ? 'driver' : p.language.toUpperCase()}</option>)}
            </select></Field>
            <Field label="Label template"><select value={tpl?.id || ''} onChange={(e) => setTemplateId(e.target.value)}>{(templates || []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></Field>
          </div>
          {warnings.map((w) => <div key={w} className="alert small">{w}</div>)}
          <table className="t"><thead><tr><th>Product</th><th>Barcode</th><th>Copies</th></tr></thead>
            <tbody>{items.map((it, i) => (
              <tr key={it.id + i}><td>{variantName(it)}<div className="small muted">{it.sku}{it.batch_no ? ` · batch ${it.batch_no}` : ''}</div></td><td className="small">{it.barcode || <span className="bad">none</span>}</td>
                <td><input type="number" min={0} max={5000} value={it.copies} onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, copies: Math.max(0, Math.min(5000, Number(e.target.value) || 0)) } : x)))} style={{ width: 84 }} aria-label="Copies" /></td></tr>
            ))}</tbody></table>
          {items.length > 1 && <div className="row"><button className="btn sm" onClick={() => setItems(items.map((x) => ({ ...x, copies: 1 })))}>1 each</button><button className="btn sm" onClick={() => setItems(items.map((x) => ({ ...x, copies: 0 })))}>Clear all</button></div>}
        </div>
        <div>
          <div className="small muted" style={{ marginBottom: 6 }}>Preview — exactly what the printer receives (dashed line = one printed row)</div>
          <iframe title="Label preview" srcDoc={preview} style={{ width: '100%', height: 300, border: '1px solid var(--line)', borderRadius: 14, background: '#efe8dc' }} />
          {printer && <div className="small muted" style={{ marginTop: 6 }}>{printer.language === 'driver' ? 'Prints through the computer’s printer driver (a print window opens).' : `Sent as ${printer.language.toUpperCase()} through the print agent on this computer.`}</div>}
        </div>
      </div>
    </Modal>
  );
}
