import { FileSpreadsheet, FileText } from 'lucide-react';
import { store } from '../core/store';

type Cell = string | number | null | undefined;
const esc = (v: Cell) => String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

/** Excel file (SpreadsheetML — opens directly in Excel, LibreOffice and Google Sheets, numbers stay numbers). */
export function downloadExcel(name: string, head: string[], rows: Cell[][]) {
  const cell = (v: Cell) => (typeof v === 'number' && Number.isFinite(v) ? `<Cell><Data ss:Type="Number">${v}</Data></Cell>` : `<Cell><Data ss:Type="String">${esc(v)}</Data></Cell>`);
  const xml = `<?xml version="1.0"?><?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
<Styles><Style ss:ID="h"><Font ss:Bold="1"/><Interior ss:Color="#EFE6DA" ss:Pattern="Solid"/></Style></Styles>
<Worksheet ss:Name="${esc(name.slice(0, 30))}"><Table>
<Row>${head.map((h) => `<Cell ss:StyleID="h"><Data ss:Type="String">${esc(h)}</Data></Cell>`).join('')}</Row>
${rows.map((r) => `<Row>${r.map(cell).join('')}</Row>`).join('\n')}
</Table></Worksheet></Workbook>`;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([xml], { type: 'application/vnd.ms-excel' }));
  a.download = `${name}-${new Date().toISOString().slice(0, 10)}.xls`; a.click();
}

/** Printable PDF: opens the table on a clean page with the business name; choose “Save as PDF”. */
export function printTable(title: string, head: string[], rows: Cell[][], sub = '') {
  const s = store.get().settings;
  const fmt = (v: Cell) => (typeof v === 'number' ? v.toLocaleString('en-GB', { maximumFractionDigits: 3 }) : esc(v));
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>
body{font-family:Inter,system-ui,sans-serif;color:#222;margin:28px}h1{font-size:18px;margin:0}h2{font-size:14px;margin:4px 0 16px;color:#666;font-weight:500}
table{width:100%;border-collapse:collapse;font-size:12px}th{background:#efe6da;text-align:left}th,td{padding:6px 8px;border-bottom:1px solid #ddd}td.n{text-align:right;font-variant-numeric:tabular-nums}
.foot{margin-top:18px;font-size:11px;color:#888}@media print{body{margin:10mm}}</style></head><body>
<h1>${esc(s.businessName)}</h1><h2>${esc(title)}${sub ? ' · ' + esc(sub) : ''}</h2>
<table><thead><tr>${head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>
${rows.map((r) => `<tr>${r.map((v) => `<td class="${typeof v === 'number' ? 'n' : ''}">${fmt(v)}</td>`).join('')}</tr>`).join('')}
</tbody></table><div class="foot">Printed ${new Date().toLocaleString('en-GB')} · amounts in ${esc(s.currency)}</div>
<script>window.onload=()=>setTimeout(()=>window.print(),200)</script></body></html>`;
  const w = window.open('', '_blank'); if (!w) return; w.document.write(html); w.document.close();
}

export function ExportButtons({ name, title, head, rows, sub }: { name: string; title?: string; head: string[]; rows: Cell[][]; sub?: string }) {
  return <span className="flex no-print" style={{ gap: 6 }}>
    <button type="button" className="btn sm" title="Download for Excel" onClick={() => downloadExcel(name, head, rows)}><FileSpreadsheet size={14} />Excel</button>
    <button type="button" className="btn sm" title="Print or save as PDF" onClick={() => printTable(title || name.replace(/-/g, ' '), head, rows, sub)}><FileText size={14} />PDF</button>
  </span>;
}
