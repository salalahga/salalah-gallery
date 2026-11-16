import type { ReactNode } from 'react';
import type { Settings } from '../core/types';
import { useSettings } from '../core/store';

/** Arabic labels printed under the English ones on customer documents (Settings → Arabic on documents). */
export const AR: Record<string, string> = {
  QUOTATION: 'عرض سعر', INVOICE: 'فاتورة', 'TAX INVOICE': 'فاتورة ضريبية', RECEIPT: 'سند قبض', 'ADVANCE RECEIPT': 'سند قبض مقدم',
  'DELIVERY NOTE': 'مذكرة تسليم', 'PURCHASE ORDER': 'أمر شراء', 'Bill to': 'إلى', 'Deliver to': 'التسليم إلى', 'Received from': 'استلمنا من', Supplier: 'المورد',
  Date: 'التاريخ', 'Valid until': 'صالح حتى', Due: 'تاريخ الاستحقاق', Subject: 'الموضوع', Description: 'البيان', Qty: 'الكمية', Unit: 'الوحدة',
  Rate: 'السعر', Amount: 'المبلغ', Subtotal: 'المجموع الفرعي', Discount: 'الخصم', VAT: 'ضريبة القيمة المضافة', Total: 'الإجمالي', Paid: 'المدفوع',
  'Balance due': 'الرصيد المستحق', 'Amount in words': 'المبلغ كتابةً', 'Authorised signature': 'التوقيع المعتمد', 'Customer acceptance': 'توقيع العميل',
  'Received by': 'استلم بواسطة', 'Delivered by': 'سلم بواسطة', 'Payment method': 'طريقة الدفع', 'Against': 'مقابل', 'Received in good condition': 'استلمت بحالة جيدة',
  'Terms & conditions': 'الشروط والأحكام', 'Cheque no.': 'رقم الشيك', Vehicle: 'المركبة', 'Ref': 'المرجع',
};

export function useArabic() { return useSettings().arabicOnDocs !== false; }

/** "English" with the Arabic under it (when enabled). */
export function Bi({ en, inline }: { en: string; inline?: boolean }) {
  const on = useArabic(); const ar = AR[en];
  if (!on || !ar) return <>{en}</>;
  return inline ? <>{en} / <span className="ar" dir="rtl">{ar}</span></> : <span className="bi">{en}<span className="ar" dir="rtl">{ar}</span></span>;
}

export function Letterhead({ s, title, meta }: { s: Settings; title: string; meta: ReactNode }) {
  const on = s.arabicOnDocs !== false;
  return (
    <>
      {s.logo && <img className="doc-watermark" src={s.logo} alt="" />}
      <div className="doc-head">
        <div className="flex" style={{ gap: 16, alignItems: 'flex-start' }}>{s.logo && <img src={s.logo} alt="" style={{ height: 76 }} />}
          <div><h2>{s.businessName}</h2>{on && s.businessNameAr && <div className="ar ar-name" dir="rtl">{s.businessNameAr}</div>}
            {s.tagline && <div>{s.tagline}</div>}<div>{s.address}, {s.city}, {s.country}</div>{on && s.addressAr && <div className="ar" dir="rtl">{s.addressAr}</div>}
            <div>{s.phone && `GSM: ${s.phone}`}{s.phone && s.email ? ' · ' : ''}{s.email}</div>{s.crNumber && <div>C.R: {s.crNumber}</div>}{s.vatNumber && <div>VATIN: {s.vatNumber}</div>}</div></div>
        <div className="right"><h2>{title}</h2>{on && AR[title] && <div className="ar ar-title" dir="rtl">{AR[title]}</div>}{meta}</div>
      </div>
    </>
  );
}

export function Signatures({ left = 'Authorised signature', right = 'Customer acceptance' }: { left?: string; right?: string }) {
  return <div className="doc-sign"><div><Bi en={left} /></div><div><Bi en={right} /></div></div>;
}
