export type ID = string;

export interface Base { id: ID; createdAt: string; updatedAt?: string }

export interface Customer extends Base { name: string; phone?: string; email?: string; address?: string; type?: string; notes?: string }

export interface WorkType { id: ID; name: string; color: string; unit: string; rate: number; fields: string[] }

export type JobStatus = 'enquiry' | 'design' | 'production' | 'finishing' | 'installation' | 'completed' | 'cancelled';
export interface Job extends Base {
  code: string; title: string; customerId?: ID; workTypeId?: ID; status: JobStatus; priority: 'low' | 'normal' | 'high' | 'urgent';
  startDate?: string; dueDate?: string; value: number; staffIds: ID[]; details: Record<string, string>; notes?: string; quotationId?: ID;
  materials: { itemId: ID; qty: number; issued?: number }[]; progress: number;
  /** Additional / variation work added after the original contract — raises the project value. */
  extras?: ProjectExtra[];
  photos?: Photo[]; cutting?: CuttingList;
  /** Warranty given on completion (months) and the day the project was completed. */
  warrantyMonths?: number; completedDate?: string;
}

export type TaskStatus = 'todo' | 'doing' | 'review' | 'done';
export interface Task extends Base { title: string; jobId?: ID; staffId?: ID; status: TaskStatus; priority: 'low' | 'normal' | 'high' | 'urgent'; dueDate?: string; hours?: number; notes?: string;
  /** Actual hours worked — costed to the project at the staff member's hourly cost. */
  spent?: number }

export type SalaryType = 'monthly' | 'daily' | 'hourly';
export interface Photo { id: ID; url: string; kind: 'before' | 'progress' | 'after' | 'site'; caption?: string; at: string }
export interface CutPart { id: ID; name: string; length: number; width: number; qty: number; grain?: boolean }
export interface CuttingList { sheetL: number; sheetW: number; kerf: number; material?: string; itemId?: ID; parts: CutPart[] }
export interface StaffDoc { id: ID; type: string; number?: string; expiry?: string }

export interface Staff extends Base {
  name: string; role: string; phone?: string; nationality?: string; idNumber?: string; joinDate?: string; salaryType: SalaryType; rate: number;
  allowance: number; skills: string[]; active: boolean; color: string; bank?: string; telegramChatId?: string; email?: string; documents?: StaffDoc[];
  /** Leave is counted from leaveFrom (default: join date), starting with leaveOpening days carried in. */
  leaveFrom?: string; leaveOpening?: number;
}

export type AttendanceMark = 'P' | 'A' | 'H' | 'L';
export interface Attendance extends Base { date: string; staffId: ID; mark: AttendanceMark; overtime: number }

export interface Advance extends Base { staffId: ID; date: string; amount: number; note?: string; recovered: boolean; txnId?: ID }

export interface Payslip extends Base {
  month: string; staffId: ID; basic: number; daysPresent: number; overtimeHours: number; overtimePay: number; allowance: number;
  bonus: number; deductions: number; advance: number; net: number; paid: boolean; paidDate?: string;
}

export interface LineItem { id: ID; description: string; workTypeId?: ID; qty: number; unit: string; rate: number }
export type QuoteStatus = 'draft' | 'sent' | 'accepted' | 'rejected';
export interface Quotation extends Base {
  number: string; date: string; validUntil?: string; customerId?: ID; title: string; items: LineItem[]; discount: number; vat: number;
  status: QuoteStatus; terms?: string; jobId?: ID; revisionOf?: ID;
}
export type InvoiceStatus = 'unpaid' | 'partial' | 'paid';
export interface Invoice extends Base {
  number: string; date: string; dueDate?: string; customerId?: ID; title: string; items: LineItem[]; discount: number; vat: number;
  paid: number; jobId?: ID; quotationId?: ID; notes?: string;
  /** Total of credit notes issued against this invoice (reduces the balance). */
  credited?: number;
  /** Advance receipts credited to this invoice, so deleting it can release them. */
  advanceCredits?: { receiptId: ID; amount: number }[];
  /** Project additional-work lines billed on this invoice. */
  extraIds?: ID[];
}

export interface ProjectExtra { id: ID; date: string; description: string; amount: number; invoiced?: boolean }

/** jobId links money in/out to a project, so every project has its own income & expenses. */
export type MoneyAccount = 'cash' | 'bank';
export interface Txn extends Base {
  date: string; kind: 'income' | 'expense' | 'transfer'; category: string; amount: number; method: string; description: string; ref?: string; jobId?: ID;
  /** Cash box or bank; defaults from the method (Cash → cash, everything else → bank). For a transfer: the account money leaves. */
  account?: MoneyAccount; toAccount?: MoneyAccount; recurringId?: ID;
}

export interface Item extends Base {
  name: string; kind: 'material' | 'product'; category: string; sku?: string; unit: string; qty: number; cost: number; price: number;
  reorder: number; thickness?: string; size?: string; image?: string; description?: string; showOnWebsite?: boolean;
}

export interface SaleReturn { id: ID; date: string; lines: { itemId: ID; qty: number }[]; amount: number; method: string; reason?: string }
export interface Sale extends Base { number: string; date: string; customerId?: ID; lines: { itemId: ID; name: string; qty: number; price: number }[]; discount: number; vat: number; method: string; returns?: SaleReturn[] }

export interface SocialAccount extends Base { platform: string; handle: string; url: string; followers?: number }
export interface SocialPost extends Base { title: string; caption: string; platforms: string[]; date: string; status: 'idea' | 'draft' | 'scheduled' | 'posted'; image?: string; jobId?: ID }

export interface Settings {
  businessName: string; tagline: string; phone: string; whatsapp: string; email: string; address: string; city: string; country: string;
  currency: string; vatRate: number; vatNumber: string; crNumber: string; logo?: string; lang?: 'en';
  workTypes: WorkType[]; expenseCategories: string[]; incomeCategories: string[]; roles: string[]; quoteTerms: string;
  workHoursPerDay: number; overtimeMultiplier: number; workingDaysPerMonth: number;
  website: { hero: string; about: string; theme: string; gallery: string[]; showProducts: boolean; mapUrl: string };
  mlNumerals?: boolean;
  timezone?: string; dailyHour?: number;
  logoLight?: string; poBox?: string; paymentInfo?: string;
  /** Invoice numbering: empty prefix = plain numbers (1212, 1213…) continuing from invoiceStart. */
  invoicePrefix?: string; invoiceStart?: number;
  businessNameAr?: string; addressAr?: string; arabicOnDocs?: boolean; docExpiryDays?: number;
  /** Cash & bank balances start from these amounts on openingDate. */
  openingCash?: number; openingBank?: number; openingDate?: string;
  /** End-of-service gratuity (days of basic wage per year of service) and paid annual leave days per year. */
  gratuityDaysPerYear?: number; annualLeaveDays?: number;
  /** Non-secret plugin switches and options, shared with every device. Secrets live on the server only. */
  plugins?: Record<string, PluginState>;
}
export interface PluginState { enabled: boolean; [k: string]: unknown }

export interface DB {
  customers: Customer[]; jobs: Job[]; tasks: Task[]; staff: Staff[]; attendance: Attendance[]; advances: Advance[]; payslips: Payslip[];
  quotations: Quotation[]; invoices: Invoice[]; txns: Txn[]; items: Item[]; sales: Sale[]; socialAccounts: SocialAccount[]; socialPosts: SocialPost[];
  suppliers: Supplier[]; purchases: Purchase[]; receipts: Receipt[]; deliveries: Delivery[]; measurements: Measurement[];
  cheques: Cheque[]; creditNotes: CreditNote[]; services: ServiceCall[]; recurring: Recurring[];
  brands: Brand[]; catalog: CatalogItem[]; selections: Selection[];
  settings: Settings;
}
export type Collection = Exclude<keyof DB, 'settings'>;

export interface Supplier extends Base { name: string; phone?: string; email?: string; address?: string; category?: string; vatNumber?: string; notes?: string }
export interface PurchaseLine { id: ID; itemId?: ID; description: string; qty: number; unit: string; rate: number; received?: number }
export interface Purchase extends Base {
  number: string; date: string; supplierId?: ID; jobId?: ID; status: 'ordered' | 'received' | 'cancelled'; lines: PurchaseLine[];
  vat: number; paid: number; dueDate?: string; billNo?: string; notes?: string; receivedDate?: string;
}
export interface Receipt extends Base {
  number: string; date: string; customerId?: ID; amount: number; method: string; kind: 'advance' | 'payment';
  /** For advances: how much has already been credited to invoices (invoiceId = the last one). */
  applied?: number;
  jobId?: ID; quotationId?: ID; invoiceId?: ID; chequeNo?: string; chequeDate?: string; note?: string;
  voided?: boolean; voidedAt?: string; voidReason?: string;
}
export interface DeliveryLine { id: ID; description: string; qty: number; unit: string }
export interface Delivery extends Base {
  number: string; date: string; customerId?: ID; jobId?: ID; invoiceId?: ID; lines: DeliveryLine[]; deliveredBy?: string; vehicle?: string; address?: string; notes?: string;
}
export interface MeasureItem { id: ID; name: string; width?: number; height?: number; depth?: number; qty: number; notes?: string }
export interface Measurement extends Base {
  number: string; date: string; customerId?: ID; customerName?: string; customerPhone?: string; jobId?: ID; site?: string; lat?: number; lng?: number; measuredBy?: ID; unit: 'mm' | 'cm' | 'm' | 'in';
  items: MeasureItem[]; photos?: Photo[]; notes?: string; status: 'new' | 'quoted' | 'done'; quotationId?: ID;
}

/** Cheques received from customers or issued to suppliers, tracked until they clear (PDC). */
export interface Cheque extends Base {
  direction: 'received' | 'issued'; chequeNo: string; bank?: string; date: string; amount: number; party: string;
  status: 'pending' | 'deposited' | 'cleared' | 'bounced' | 'cancelled'; receiptId?: ID; purchaseId?: ID; txnId?: ID; note?: string; statusDate?: string;
}
/** Credit note against an invoice: reduces what the customer owes; any amount beyond the balance is refunded. */
export interface CreditNote extends Base { number: string; date: string; invoiceId: ID; customerId?: ID; amount: number; reason: string; refund?: number; method?: string }
/** After-sales service / warranty visit. */
export interface ServiceCall extends Base {
  number: string; date: string; customerId?: ID; jobId?: ID; issue: string; status: 'open' | 'scheduled' | 'done' | 'cancelled';
  staffId?: ID; visitDate?: string; warranty: boolean; charge?: number; invoiceId?: ID; notes?: string; resolution?: string; photos?: Photo[];
}
/** Expense posted automatically every month (rent, electricity, internet…). */
export interface Recurring extends Base {
  description: string; category: string; amount: number; method: string; day: number; active: boolean; startMonth: string; lastMonth?: string; jobId?: ID;
}

/** A material company / brand whose catalogue you keep (Formica, Egger, Hettich, Asian Paints…). */
export interface Brand extends Base { name: string; logo?: string; website?: string; country?: string; supplierId?: ID; notes?: string }
/** One material in a brand's catalogue: a laminate, board decor, handle, hinge, paint colour… */
export interface CatalogItem extends Base {
  brandId: ID; code: string; name: string; category: string; image?: string; finish?: string; size?: string; thickness?: string;
  price?: number; unit?: string; tags?: string[]; notes?: string; sourceUrl?: string; stockItemId?: ID; active?: boolean;
}
export interface SelectionPick { itemId: ID; qty?: number; area?: string; note?: string }
/** A set of catalogue items shared with a customer by link; the customer picks what they want. */
export interface Selection extends Base {
  token: string; title: string; message?: string; customerId?: ID; jobId?: ID; itemIds: ID[]; maxPicks?: number;
  status: 'sent' | 'viewed' | 'submitted' | 'closed'; picks: SelectionPick[]; viewedAt?: string; submittedAt?: string;
  customerName?: string; customerPhone?: string; customerNote?: string; quotationId?: ID; showPrices?: boolean;
}
