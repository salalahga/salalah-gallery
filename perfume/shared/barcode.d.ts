export function ean13CheckDigit(first12: string): string;
export function isValidEan13(code: string): boolean;
export function internalEan13(n: number): string;
export function cleanScan(raw: string): string;
export const SYMBOLOGIES: Record<'ean13' | 'ean8' | 'code128' | 'code39', string>;
export function ean8CheckDigit(first7: string): string;
export function isValidEan8(code: string): boolean;
export function detectSymbology(code: string): 'ean13' | 'ean8' | 'code128';
export function barcodeProblem(code: string, sym: string): string | null;
