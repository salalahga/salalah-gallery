import { useEffect, useRef, useState } from 'react';
import { cleanScan } from '../../shared/barcode.js';

/** Short confirmation beep (high = OK, low = problem). */
let audio: AudioContext | null = null;
export function beep(ok: boolean) {
  try {
    audio ||= new (window.AudioContext || (window as any).webkitAudioContext)();
    const o = audio.createOscillator(), g = audio.createGain();
    o.frequency.value = ok ? 1500 : 320; o.type = 'square'; g.gain.value = 0.05;
    o.connect(g); g.connect(audio.destination); o.start(); o.stop(audio.currentTime + (ok ? 0.08 : 0.3));
  } catch { /* no sound */ }
}

/**
 * USB / Bluetooth / wireless scanners act as a keyboard: they type the code quickly and press Enter.
 * This catches such bursts anywhere on the page (when no text box has focus), so staff can scan without
 * clicking first. Inside a text box, ScanBox below handles it.
 */
export function useScanner(onScan: (code: string) => void, enabled = true) {
  const ref = useRef(onScan);
  ref.current = onScan;
  useEffect(() => {
    if (!enabled) return;
    let buf = '', last = 0;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
      const now = Date.now();
      if (now - last > 60) buf = '';
      last = now;
      if (e.key === 'Enter') { if (buf.length >= 4) { e.preventDefault(); ref.current(cleanScan(buf)); } buf = ''; return; }
      if (e.key.length === 1) buf += e.key;
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [enabled]);
}

/** A text box for scanning or typing a barcode. Calls onScan on Enter and clears itself. */
export function ScanBox({ onScan, placeholder = 'Scan or type a barcode / SKU, then Enter', autoFocus = true }: { onScan: (code: string) => void; placeholder?: string; autoFocus?: boolean }) {
  const [v, setV] = useState('');
  return (
    <div className="scanbox">
      <span aria-hidden="true">▥</span>
      <input value={v} autoFocus={autoFocus} onChange={(e) => setV(e.target.value)} placeholder={placeholder} aria-label="Scan barcode"
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); const c = cleanScan(v); if (c) onScan(c); setV(''); } }} />
    </div>
  );
}
