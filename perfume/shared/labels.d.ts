export type Field = { key: string; on: boolean; size: number; align: 'left' | 'center' | 'right'; bold: boolean };
export type Template = { id: string; name: string; builtin?: boolean; widthMm: number; heightMm: number; marginMm: number; symbology: string; barcodeHeightMm: number; module: number; qrData: 'barcode' | 'sku' | 'text'; qrText: string; fields: Field[] };
export type LabelData = { barcode?: string | null; symbology?: string | null; sku: string; name: string; brand?: string | null; label?: string | null; size_ml?: number | null; retail_price: number; original_price?: number | null; batch_no?: string | null };
export type El = { type: 'text'; key: string; text: string; x: number; y: number; w: number; h: number; size: number; align: string; bold: boolean }
  | { type: 'barcode'; code: string; sym: string; x: number; y: number; w: number; h: number; module: number }
  | { type: 'qr'; data: string; x: number; y: number; size: number } | { type: 'logo'; x: number; y: number; w: number; h: number };
export type PrinterOpts = { dpi?: number; density?: number; speed?: number; orientation?: number; cols?: number; colGapMm?: number; offsetXMm?: number; offsetYMm?: number; gapMm?: number; cut?: boolean };
export const FIELDS: Record<string, string>;
export const BUILTIN_TEMPLATES: Template[];
export function fieldText(key: string, it: LabelData, shop: string): string;
export function qrContent(tpl: Template, it: LabelData): string;
export function layoutLabel(tpl: Template, it: LabelData, shop: string): El[];
export function asciiText(s: string): string;
export function hasNonAscii(s: string): boolean;
export function toZPL(tpl: Template, labels: LabelData[], shop: string, printer?: PrinterOpts): string;
export function toTSPL(tpl: Template, labels: LabelData[], shop: string, printer?: PrinterOpts): string;
export function toESCPOS(tpl: Template, labels: LabelData[], shop: string, printer?: PrinterOpts): Uint8Array;
export function testLabel(barcode?: string): LabelData;
