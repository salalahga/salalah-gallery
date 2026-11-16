import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { useSettings } from '../core/store';
import type { PluginState } from '../core/types';
import { PLUGINS, WA_TEMPLATES } from './catalog';

/** Plugin state for this workshop. `alwaysOn` plugins are enabled even without saved settings. */
export function usePlugin(id: string): PluginState {
  const s = useSettings();
  const def = PLUGINS.find((p) => p.id === id);
  const st = s.plugins?.[id];
  return { ...(st || {}), enabled: !!(def?.alwaysOn || st?.enabled) };
}

export function fillTemplate(text: string, vars: Record<string, unknown>) {
  return text.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => (vars[k] == null ? '' : String(vars[k])));
}
/** WhatsApp message text from the (editable) template. */
export function useWaText() {
  const wa = usePlugin('whatsapp');
  return (key: keyof typeof WA_TEMPLATES, vars: Record<string, unknown>) => fillTemplate(String(wa['tpl_' + key] || WA_TEMPLATES[key].text), vars);
}

export function gcalLink(title: string, date: string, details = '', location = '') {
  const d = date.replace(/-/g, ''); const n = new Date(date + 'T00:00:00'); n.setDate(n.getDate() + 1);
  const e = `${n.getFullYear()}${String(n.getMonth() + 1).padStart(2, '0')}${String(n.getDate()).padStart(2, '0')}`;
  return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(title)}&dates=${d}/${e}&details=${encodeURIComponent(details)}&location=${encodeURIComponent(location)}`;
}
export const mapsLink = (address: string) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;

export function downloadCsv(name: string, rows: Record<string, unknown>[]) {
  const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const cell = (v: unknown) => { const s = v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v); return `"${s.replace(/"/g, '""')}"`; };
  const csv = '﻿' + [cols.map(cell).join(','), ...rows.map((r) => cols.map((c) => cell(r[c])).join(','))].join('\r\n');
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' })); a.download = `${name}.csv`; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export function QR({ value, size = 96, caption }: { value: string; size?: number; caption?: string }) {
  const [src, setSrc] = useState('');
  useEffect(() => { QRCode.toDataURL(value, { margin: 1, width: size * 2, errorCorrectionLevel: 'M' }).then(setSrc, () => setSrc('')); }, [value, size]);
  if (!src) return null;
  return <div className="qr"><img src={src} width={size} height={size} alt="QR code" />{caption && <small>{caption}</small>}</div>;
}

/** The link a document QR code should open, based on the QR plugin settings. */
export function useDocQr() {
  const qr = usePlugin('qr'); const s = useSettings();
  if (!qr.enabled) return null;
  const target = String(qr.target || 'WhatsApp chat');
  const url = target === 'Custom link' && qr.url ? String(qr.url) : target === 'Website' ? window.location.origin : `https://wa.me/${s.whatsapp.replace(/\D/g, '')}`;
  return { url, caption: String(qr.caption || (target === 'WhatsApp chat' ? 'Scan to chat with us on WhatsApp' : 'Scan me')) };
}
