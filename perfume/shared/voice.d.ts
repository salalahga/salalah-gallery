export type Command =
  | { intent: 'add'; qty: number; query: string; sizeMl: number | null; raw: string; explicit: boolean }
  | { intent: 'remove'; query: string; sizeMl: number | null; raw: string }
  | { intent: 'availability'; query: string; sizeMl: number | null; raw: string }
  | { intent: 'discount'; percent?: number; amount?: number; raw: string }
  | { intent: 'customer'; phone: string; raw: string }
  | { intent: 'today_sales' | 'checkout' | 'clear' | 'unknown'; raw: string };
export function normalise(text: string): string;
export function parseCommand(text: string): Command;
export function matchVariants<T extends { id: string; sizeMl?: number | null }>(query: string, sizeMl: number | null, variants: T[], limit?: number): (T & { score: number })[];
