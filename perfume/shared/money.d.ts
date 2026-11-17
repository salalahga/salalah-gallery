export const DECIMALS: Record<string, number>;
export function decimalsOf(cur?: string): number;
export function toMinor(v: string | number, cur?: string): number;
export function fmt(minor: number, cur?: string, opts?: { symbol?: boolean }): string;
export function roundHalf(x: number): number;
export function pct(amount: number, bp: number): number;
export function lineTax(gross: number, rateBp: number, inclusive: boolean): { net: number; vat: number; total: number };
export function allocate(total: number, weights: number[]): number[];
