// Copies the free OCR engine (Tesseract) and its English data into public/ocr so bill reading
// works from our own server — no outside service, no API key. Runs after npm install.
import fs from 'node:fs';
import path from 'node:path';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const out = path.join(root, 'public', 'ocr');
const files = [
  ['node_modules/tesseract.js/dist/worker.min.js', 'worker.min.js'],
  ['node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm.js', 'tesseract-core-simd-lstm.wasm.js'],
  ['node_modules/tesseract.js-core/tesseract-core-lstm.wasm.js', 'tesseract-core-lstm.wasm.js'],
  ['node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz', 'eng.traineddata.gz'],
];
try {
  fs.mkdirSync(out, { recursive: true });
  for (const [from, to] of files) {
    const src = path.join(root, from); const dst = path.join(out, to);
    if (!fs.existsSync(src)) { console.warn('[ocr] missing', from); continue; }
    if (!fs.existsSync(dst) || fs.statSync(dst).size !== fs.statSync(src).size) fs.copyFileSync(src, dst);
  }
  console.log('[ocr] bill reader files ready in public/ocr');
} catch (e) { console.warn('[ocr] could not copy OCR files:', e.message); }
