import { useSyncExternalStore } from 'react';
import { useSettings } from './store';

const ml: Record<string, string> = {
  Dashboard: 'ഡാഷ്ബോർഡ്', Jobs: 'വർക്കുകൾ', Tasks: 'ടാസ്കുകൾ', Staff: 'സ്റ്റാഫ്', Attendance: 'ഹാജർ', Payroll: 'ശമ്പളം', Customers: 'കസ്റ്റമേഴ്സ്',
  Quotations: 'കൊട്ടേഷൻസ്', Invoices: 'ഇൻവോയ്സുകൾ', Accounts: 'അക്കൗണ്ട്സ്', Inventory: 'സ്റ്റോക്ക്', Sales: 'വിൽപ്പന', 'Social Media': 'സോഷ്യൽ മീഡിയ',
  Website: 'വെബ്സൈറ്റ്', Settings: 'സെറ്റിംഗ്സ്', Plugins: 'പ്ലഗ്ഗിനുകൾ', Automations: 'ഓട്ടോമേഷൻ', Workshop: 'വർക്ക്ഷോപ്പ്', Team: 'ടീം', Money: 'പണം', Business: 'ബിസിനസ്', Growth: 'വളർച്ച', System: 'സിസ്റ്റം',
  Add: 'ചേർക്കുക', Save: 'സേവ്', Cancel: 'റദ്ദാക്കുക', Delete: 'ഡിലീറ്റ്', Edit: 'എഡിറ്റ്', Search: 'തിരയുക', Print: 'പ്രിന്റ്', Total: 'ആകെ',
  Income: 'വരവ്', Expense: 'ചെലവ്', Profit: 'ലാഭം', 'Active jobs': 'നടക്കുന്ന വർക്കുകൾ', 'Due this week': 'ഈ ആഴ്ച തീരേണ്ടവ', 'Unpaid invoices': 'കിട്ടാനുള്ള പണം',
  'Low stock': 'സ്റ്റോക്ക് കുറവ്', 'Today': 'ഇന്ന്', 'Good morning': 'സുപ്രഭാതം', 'Good afternoon': 'ശുഭ ഉച്ച', 'Good evening': 'ശുഭ സന്ധ്യ',
  'New job': 'പുതിയ വർക്ക്', 'New quotation': 'പുതിയ കൊട്ടേഷൻ', 'New sale': 'പുതിയ വിൽപ്പന', 'Add expense': 'ചെലവ് ചേർക്കുക',
};

// Language is chosen per device (each staff member can pick theirs); Settings holds the default.
const LKEY = 'ww-lang';
const lsubs = new Set<() => void>();
const readLang = () => { try { return localStorage.getItem(LKEY) as 'en' | 'ml' | null; } catch { return null; } };
export function setLang(l: 'en' | 'ml') { try { localStorage.setItem(LKEY, l); } catch { /* */ } lsubs.forEach((f) => f()); }
export function useLang(): 'en' | 'ml' {
  const def = useSettings().lang;
  return useSyncExternalStore((f) => { lsubs.add(f); return () => lsubs.delete(f); }, readLang) || def || 'en';
}

export function useT() {
  const lang = useLang();
  return (s: string) => (lang === 'ml' && ml[s] ? ml[s] : s);
}
