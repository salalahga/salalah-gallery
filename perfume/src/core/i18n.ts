// Interface languages: English, Arabic (right-to-left) and Malayalam.
import { useSyncExternalStore } from 'react';

export type Lang = 'en' | 'ar' | 'ml';
type Dict = Record<string, string>;

const ar: Dict = {
  Dashboard: 'لوحة التحكم', 'Point of sale': 'نقطة البيع', 'Sales & orders': 'المبيعات والطلبات', Inventory: 'المخزون', Purchases: 'المشتريات', Suppliers: 'الموردون',
  Promotions: 'العروض', Customers: 'العملاء', Finance: 'المالية', Reports: 'التقارير', 'HR & staff': 'الموارد البشرية', Users: 'المستخدمون', Settings: 'الإعدادات',
  'Audit log': 'سجل التدقيق', Assistant: 'المساعد', Approvals: 'الموافقات', 'Log out': 'تسجيل الخروج', Search: 'بحث', Save: 'حفظ', Cancel: 'إلغاء', Add: 'إضافة',
  Total: 'الإجمالي', Subtotal: 'المجموع الفرعي', Discount: 'الخصم', VAT: 'ضريبة القيمة المضافة', Pay: 'ادفع', Cash: 'نقداً', Card: 'بطاقة', 'Bank transfer': 'تحويل بنكي',
  Customer: 'العميل', Quantity: 'الكمية', Price: 'السعر', Today: 'اليوم', 'This week': 'هذا الأسبوع', 'This month': 'هذا الشهر', 'Sales today': 'مبيعات اليوم',
  'Low stock': 'مخزون منخفض', 'Best sellers': 'الأكثر مبيعاً', 'Slow moving': 'بطيء الحركة', 'Pending orders': 'طلبات معلقة', 'Active offers': 'العروض الحالية',
  'Net profit': 'صافي الربح', 'Gross profit': 'إجمالي الربح', Revenue: 'الإيرادات', Expenses: 'المصروفات', 'Cash balance': 'رصيد النقد', 'Bank balance': 'رصيد البنك',
  'Inventory value': 'قيمة المخزون', 'Sign in': 'تسجيل الدخول', Username: 'اسم المستخدم', Password: 'كلمة المرور', 'Speak': 'تحدث', 'Confirm & take payment': 'تأكيد واستلام الدفع',
  'New sale': 'بيع جديد', Branch: 'الفرع', Language: 'اللغة', Notifications: 'الإشعارات', 'Business Manager': 'مدير الأعمال', 'My profile': 'ملفي', 'Check in': 'تسجيل الحضور', 'Check out': 'تسجيل الانصراف',
  'Request leave': 'طلب إجازة', 'My sales': 'مبيعاتي', Announcements: 'الإعلانات', Attendance: 'الحضور', Leave: 'الإجازات', 'Online sales': 'المبيعات الإلكترونية', 'Shop sales': 'مبيعات المحل', 'WhatsApp sales': 'مبيعات واتساب',
  'Sales by staff': 'المبيعات حسب الموظف', 'Customer growth': 'نمو العملاء', 'Outstanding': 'المستحق', 'Receivable': 'المستحق من العملاء', 'Payable': 'المستحق للموردين', Integrations: 'التكاملات',
};
const ml: Dict = {
  Dashboard: 'ഡാഷ്ബോർഡ്', 'Point of sale': 'പോയിന്റ് ഓഫ് സെയിൽ', 'Sales & orders': 'വിൽപ്പനയും ഓർഡറുകളും', Inventory: 'സ്റ്റോക്ക്', Purchases: 'വാങ്ങലുകൾ', Suppliers: 'വിതരണക്കാർ',
  Promotions: 'ഓഫറുകൾ', Customers: 'ഉപഭോക്താക്കൾ', Finance: 'ധനകാര്യം', Reports: 'റിപ്പോർട്ടുകൾ', 'HR & staff': 'എച്ച്ആർ & സ്റ്റാഫ്', Users: 'ഉപയോക്താക്കൾ', Settings: 'ക്രമീകരണങ്ങൾ',
  'Audit log': 'ഓഡിറ്റ് ലോഗ്', Assistant: 'സഹായി', Approvals: 'അംഗീകാരങ്ങൾ', 'Log out': 'പുറത്തുകടക്കുക', Search: 'തിരയുക', Save: 'സേവ്', Cancel: 'റദ്ദാക്കുക', Add: 'ചേർക്കുക',
  Total: 'ആകെ', Subtotal: 'ഉപമൊത്തം', Discount: 'കിഴിവ്', VAT: 'വാറ്റ്', Pay: 'പണമടയ്ക്കുക', Cash: 'പണം', Card: 'കാർഡ്', 'Bank transfer': 'ബാങ്ക് ട്രാൻസ്ഫർ',
  Customer: 'ഉപഭോക്താവ്', Quantity: 'അളവ്', Price: 'വില', Today: 'ഇന്ന്', 'This week': 'ഈ ആഴ്ച', 'This month': 'ഈ മാസം', 'Sales today': 'ഇന്നത്തെ വിൽപ്പന',
  'Low stock': 'കുറഞ്ഞ സ്റ്റോക്ക്', 'Best sellers': 'കൂടുതൽ വിറ്റത്', 'Slow moving': 'പതുക്കെ വിൽക്കുന്നവ', 'Pending orders': 'തീർപ്പാക്കാത്ത ഓർഡറുകൾ', 'Active offers': 'സജീവ ഓഫറുകൾ',
  'Net profit': 'അറ്റ ലാഭം', 'Gross profit': 'മൊത്ത ലാഭം', Revenue: 'വരുമാനം', Expenses: 'ചെലവുകൾ', 'Cash balance': 'ക്യാഷ് ബാലൻസ്', 'Bank balance': 'ബാങ്ക് ബാലൻസ്',
  'Inventory value': 'സ്റ്റോക്ക് മൂല്യം', 'Sign in': 'സൈൻ ഇൻ', Username: 'ഉപയോക്തൃനാമം', Password: 'പാസ്‌വേഡ്', Speak: 'സംസാരിക്കുക', 'Confirm & take payment': 'സ്ഥിരീകരിച്ച് പണം സ്വീകരിക്കുക',
  'New sale': 'പുതിയ വിൽപ്പന', Branch: 'ശാഖ', Language: 'ഭാഷ', Notifications: 'അറിയിപ്പുകൾ', 'Business Manager': 'ബിസിനസ് മാനേജർ', 'My profile': 'എന്റെ പ്രൊഫൈൽ', 'Check in': 'ചെക്ക് ഇൻ', 'Check out': 'ചെക്ക് ഔട്ട്',
  'Request leave': 'അവധി അപേക്ഷ', 'My sales': 'എന്റെ വിൽപ്പന', Announcements: 'അറിയിപ്പുകൾ', Attendance: 'ഹാജർ', Leave: 'അവധി', 'Online sales': 'ഓൺലൈൻ വിൽപ്പന', 'Shop sales': 'ഷോപ്പ് വിൽപ്പന', 'WhatsApp sales': 'വാട്ട്‌സ്ആപ്പ് വിൽപ്പന',
  'Sales by staff': 'സ്റ്റാഫ് തിരിച്ചുള്ള വിൽപ്പന', 'Customer growth': 'ഉപഭോക്തൃ വളർച്ച', Outstanding: 'ബാക്കി', Receivable: 'ലഭിക്കാനുള്ളത്', Payable: 'നൽകാനുള്ളത്', Integrations: 'ഇന്റഗ്രേഷനുകൾ',
};
const DICTS: Record<Lang, Dict> = { en: {}, ar, ml };

const KEY = 'pf-lang';
let lang: Lang = (() => { try { const v = localStorage.getItem(KEY); return v === 'ar' || v === 'ml' ? v : 'en'; } catch { return 'en'; } })();
const subs = new Set<() => void>();
function apply() {
  document.documentElement.lang = lang;
  document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
}
apply();
export function setLang(l: Lang) { lang = l; try { localStorage.setItem(KEY, l); } catch { /* private mode */ } apply(); subs.forEach((f) => f()); }
export function useLang() { return useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, () => lang); }
export const t = (s: string) => DICTS[lang][s] || s;
export const LANGS: { id: Lang; label: string }[] = [{ id: 'en', label: 'English' }, { id: 'ar', label: 'العربية' }, { id: 'ml', label: 'മലയാളം' }];
