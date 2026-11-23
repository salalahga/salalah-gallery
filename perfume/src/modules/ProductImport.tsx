import { useState } from 'react';
import { api } from '../core/api';
import { useSession } from '../core/session';
import { Field, Modal, toastError, useData } from '../components/ui';

// Header text in the sheet → field name sent to the server. Matching ignores case, spaces and symbols,
// so "Retail price OMR *", "retail price" and "RetailPrice" all work.
const HEADERS: Record<string, string> = {
  name: 'name', productname: 'name', product: 'name', brand: 'brand', category: 'category', for: 'gender', gender: 'gender',
  type: 'concentration', concentration: 'concentration', sizeml: 'sizeMl', size: 'sizeMl', ml: 'sizeMl', label: 'label', sizelabel: 'label',
  retailpriceomr: 'retailPrice', retailprice: 'retailPrice', price: 'retailPrice', sellingprice: 'retailPrice',
  openingstock: 'openingQty', stock: 'openingQty', qty: 'openingQty', quantity: 'openingQty',
  unitcostomr: 'unitCost', unitcost: 'unitCost', cost: 'unitCost', buyingprice: 'unitCost',
  originalpriceomr: 'comparePrice', originalprice: 'comparePrice', wholesalepriceomr: 'wholesalePrice', wholesaleprice: 'wholesalePrice',
  websitepriceomr: 'webPrice', websiteprice: 'webPrice', lowstockalert: 'minStock', minstock: 'minStock', barcode: 'barcode', sku: 'sku',
  namearabic: 'nameAr', namear: 'nameAr', description: 'description', descriptionarabic: 'descriptionAr', topnotes: 'notesTop', heartnotes: 'notesHeart',
  basenotes: 'notesBase', photourl: 'imageUrl', imageurl: 'imageUrl', photo: 'imageUrl', showonwebsite: 'webVisible', website: 'webVisible',
  batch: 'batchNo', batchno: 'batchNo', expiry: 'expiryDate', expirydate: 'expiryDate',
};
const key = (h: unknown) => String(h ?? '').toLowerCase().replace(/[^a-z]/g, '');

/** Minimal CSV reader (quoted fields, commas or semicolons) for sheets saved as .csv. */
function parseCsv(text: string): unknown[][] {
  const sep = (text.split('\n')[0].match(/;/g)?.length || 0) > (text.split('\n')[0].match(/,/g)?.length || 0) ? ';' : ',';
  const rows: string[][] = []; let row: string[] = []; let cell = ''; let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c; }
    else if (c === '"') q = true;
    else if (c === sep) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

async function readRows(file: File) {
  let grid: unknown[][];
  if (/\.csv$/i.test(file.name)) grid = parseCsv((await file.text()).replace(/^﻿/, ''));
  else {
    const { readSheet } = await import('read-excel-file/browser');
    grid = (await readSheet(file)) as unknown[][];
  }
  const hi = grid.findIndex((r) => r.some((c) => HEADERS[key(c)] === 'name'));
  if (hi < 0) throw new Error('No "Name" column found. Use the template (first row = column names).');
  const cols = grid[hi].map((h) => HEADERS[key(h)] || null);
  const out: Record<string, unknown>[] = [];
  grid.slice(hi + 1).forEach((r, i) => {
    const o: Record<string, unknown> = { _line: hi + i + 2 };
    let any = false;
    cols.forEach((k, ci) => {
      if (!k) return;
      let v = r[ci];
      if (v instanceof Date) v = v.toISOString().slice(0, 10);
      if (v != null && String(v).trim() !== '') { o[k] = v; any = true; }
    });
    if (any) out.push(o);
  });
  if (!out.length) throw new Error('The sheet has no product rows under the column names.');
  return { rows: out, unknown: grid[hi].filter((h, i) => String(h ?? '').trim() && !cols[i]).map(String) };
}

type Result = { dryRun: boolean; summary: { created: number; added: number; skipped: number; errors: number; rows: number }; results: { lines: number[]; product: string; status: string; note: string }[] };
const BADGE: Record<string, [string, string]> = { created: ['New', 'ok'], added: ['+ sizes', 'ok'], skipped: ['Already there', 'muted'], error: ['Fix', 'bad'] };

export function ProductImport({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { me, can } = useSession();
  const { data: branches } = useData<any[]>('/branches');
  const [branchId, setBranchId] = useState<string>(me.user.branchId || '');
  const [file, setFile] = useState<File | null>(null);
  const [rows, setRows] = useState<Record<string, unknown>[] | null>(null);
  const [unknown, setUnknown] = useState<string[]>([]);
  const [res, setRes] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const branch = branchId || branches?.[0]?.id;
  const hasStock = rows?.some((r) => Number(r.openingQty) > 0);

  const send = async (dryRun: boolean, list = rows) => {
    if (!list) return;
    setBusy(true);
    try { setRes(await api.post<Result>('/products/import', { rows: list, dryRun, branchId: branch })); if (!dryRun) onDone(); }
    catch (e) { toastError(e); } finally { setBusy(false); }
  };
  const pick = async (f: File | null) => {
    setFile(f); setRows(null); setRes(null); setUnknown([]);
    if (!f) return;
    try { const r = await readRows(f); setRows(r.rows); setUnknown(r.unknown); await send(true, r.rows); }
    catch (e) { toastError(e); }
  };
  const done = res && !res.dryRun;
  const ready = res?.dryRun && res.summary.created + res.summary.added > 0;

  return (
    <Modal wide title="Import products from Excel" onClose={onClose} footer={
      done ? <button className="btn primary" onClick={onClose}>Close</button>
        : <button className="btn primary" disabled={busy || !ready} onClick={() => send(false)}>{busy ? 'Working…' : ready ? `Import ${res!.summary.created + res!.summary.added} product${res!.summary.created + res!.summary.added > 1 ? 's' : ''}` : 'Import'}</button>
    }>
      <ol className="small" style={{ margin: '0 0 12px', paddingInlineStart: 18, lineHeight: 1.7 }}>
        <li><a href="/product-import-template.xlsx" download><b>Download the Excel template</b></a>. One row = one size; same name + brand = one product.</li>
        <li>Fill it in Excel, Numbers or Google Sheets (Name and Retail price are required), and save it as .xlsx or .csv.</li>
        <li>Choose the file below. It is checked first — nothing is saved until you press <b>Import</b>.</li>
      </ol>
      <div className="row" style={{ alignItems: 'flex-end' }}>
        <Field label="Excel file (.xlsx or .csv)"><input type="file" accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv" onChange={(e) => pick(e.target.files?.[0] || null)} /></Field>
        {can('inventory', 'manage') && !me.branchScope && (branches?.length || 0) > 1 && (
          <Field label="Opening stock goes to"><select value={branch || ''} onChange={(e) => { setBranchId(e.target.value); if (rows && !done) send(true); }}>{branches?.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></Field>
        )}
      </div>
      {hasStock && !can('inventory', 'manage') && <div className="small bad" style={{ marginTop: 6 }}>Your login cannot enter opening stock — rows with stock will fail. Leave "Opening stock" empty or ask the owner.</div>}
      {unknown.length > 0 && <div className="small muted" style={{ marginTop: 6 }}>Ignored columns: {unknown.join(', ')}</div>}
      {busy && !res && <div className="muted" style={{ marginTop: 12 }}>Checking {file?.name}…</div>}
      {res && (
        <>
          <div className="row" style={{ gap: 8, margin: '14px 0 8px', flexWrap: 'wrap' }}>
            <b>{done ? 'Imported:' : 'Check result:'}</b>
            <span className="badge ok">{res.summary.created} new</span>
            {res.summary.added > 0 && <span className="badge ok">{res.summary.added} with new sizes</span>}
            {res.summary.skipped > 0 && <span className="badge">{res.summary.skipped} already there</span>}
            {res.summary.errors > 0 && <span className="badge bad">{res.summary.errors} to fix</span>}
            <span className="small muted">({res.summary.rows} rows)</span>
          </div>
          {!done && res.summary.errors > 0 && <div className="small" style={{ marginBottom: 8 }}>Rows marked <b className="bad">Fix</b> will not be imported. Correct them in the file and choose it again, or import the rest now.</div>}
          {done && <div className="small ok" style={{ marginBottom: 8 }}>Done. Barcodes were created for sizes without one — print labels from the Inventory list.</div>}
          <div className="tablewrap" style={{ maxHeight: 360, overflow: 'auto' }}>
            <table className="t">
              <thead><tr><th>Row</th><th>Product</th><th>Result</th><th>Details</th></tr></thead>
              <tbody>{[...res.results].sort((a, b) => (a.status === 'error' ? 0 : 1) - (b.status === 'error' ? 0 : 1) || a.lines[0] - b.lines[0]).map((r) => (
                <tr key={r.lines.join(',')}>
                  <td className="small">{r.lines.join(', ')}</td>
                  <td>{r.product}</td>
                  <td><span className={`badge ${BADGE[r.status]?.[1] || ''}`}>{BADGE[r.status]?.[0] || r.status}</span></td>
                  <td className={`small ${r.status === 'error' ? 'bad' : 'muted'}`}>{r.note}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </>
      )}
    </Modal>
  );
}
