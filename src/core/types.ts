export type ID = string;

export interface Base { id: ID; createdAt: string; updatedAt?: string }

export interface Customer extends Base { name: string; phone?: string; email?: string; address?: string; type?: string; notes?: string;
  /** Customer ID shown on documents (C-0001…). */ code?: string; whatsapp?: string; photos?: Photo[]; attachments?: Attachment[];
  /** Amount the customer already owed (+) or had paid in advance (−) when their ledger started. */
  openingBalance?: number; openingDate?: string;
  /** CRM: where the enquiry came from and how far the lead has got. */
  source?: string; leadStatus?: LeadStatus; enquiry?: string; nextFollowUp?: string }
export type LeadStatus = 'new' | 'contacted' | 'quoted' | 'won' | 'lost';
/** A stored file (drawing, design, PDF, document). */
export interface Attachment { id: ID; url: string; name: string; type: string; at: string; kind?: string }

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
  /** Day the project first reached each status (stage dates), and stages marked done by hand. */
  stageDates?: Partial<Record<JobStatus, string>>; stageDone?: { quote?: string; billing?: string };
  /** Detailed workflow step 1–20 (see core/workflow.ts) and its change history (date, time, user). */
  step?: number; history?: { at: string; by?: string; step?: number; status?: JobStatus; note?: string }[];
  /** Daily work updates from the workshop / site. */
  updates?: { id: ID; at: string; by?: string; text: string; photos?: string[] }[];
  siteAddress?: string; description?: string; /** Estimated cost budget for the project. */ budget?: number;
  attachments?: Attachment[];
  /** Workshop production: order number, current stage, when each stage was finished, daily production log. */
  production?: { orderNo: string; started: string; stage: ProdStage; done: Partial<Record<ProdStage, string>>; log: ProdLog[] };
  /** Final account approved and project closed (owner only). */
  closedAt?: string; closedBy?: string; closeNote?: string;
}
export type ProdStage = 'cutting' | 'assembly' | 'sanding' | 'polishing' | 'finishing' | 'qc' | 'packing' | 'dispatch';
export interface ProdLog { id: ID; date: string; stage: ProdStage; text: string; staffIds?: ID[]; hours?: number; by?: string }

export type TaskStatus = 'todo' | 'doing' | 'review' | 'done';
export interface Task extends Base { title: string; jobId?: ID; staffId?: ID; status: TaskStatus; priority: 'low' | 'normal' | 'high' | 'urgent'; dueDate?: string; hours?: number; notes?: string;
  /** Actual hours worked — costed to the project at the staff member's hourly cost. */
  spent?: number }

export type SalaryType = 'monthly' | 'daily' | 'hourly';
export interface Photo { id: ID; url: string; kind: 'before' | 'progress' | 'after' | 'site' | 'drawing' | 'document'; caption?: string; at: string }
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

export interface LineItem { id: ID; description: string; workTypeId?: ID; qty: number; unit: string; rate: number; /** item (default), material, labour or additional charge */ kind?: 'item' | 'material' | 'labour' | 'additional' }
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
  /** Pictures of the bill / receipt. */
  photos?: string[]; chatId?: ID;
  /** Entered in another currency: original amount and the rate used (amount is always in the home currency). */
  fx?: { currency: string; amount: number; rate: number };
  /** Supplier and bill number read from the bill, for duplicate checks. */
  vendor?: string; billNo?: string; vat?: number;
}

export interface Item extends Base {
  name: string; kind: 'material' | 'product'; category: string; sku?: string; unit: string; qty: number; cost: number; price: number;
  reorder: number; thickness?: string; size?: string; image?: string; description?: string; showOnWebsite?: boolean;
  /** Quantity kept at each store location (the total is qty). */
  locQty?: Record<string, number>;
}
/** Every stock movement: received, issued to a project, moved between stores, wasted or counted. */
export interface StockMove extends Base {
  date: string; itemId: ID; kind: 'in' | 'out' | 'transfer' | 'waste' | 'adjust' | 'return' | 'sale' | 'saleReturn';
  saleId?: ID; qty: number; cost?: number;
  jobId?: ID; from?: string; to?: string; note?: string; purchaseId?: ID; by?: string;
}
/** Manual double-entry journal (opening balances, adjustments, depreciation, owner capital…). */
export interface JournalLine { account: string; debit: number; credit: number; jobId?: ID; note?: string }
export interface Journal extends Base { number: string; date: string; memo: string; lines: JournalLine[]; by?: string }
/** Staff daily work report. */
export interface WorkReport extends Base { date: string; staffId: ID; jobId?: ID; hours: number; text: string; rating?: number }

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
  /** Project codes: PREFIX-101 … or PREFIX-26-001 with the year. */
  projectPrefix?: string; projectCodeYear?: boolean;
  /** Overheads (rent, electricity, office…) charged to each project as % of its value, for net profit. */
  overheadRate?: number; catsV2?: boolean;
  businessNameAr?: string; addressAr?: string; arabicOnDocs?: boolean; docExpiryDays?: number;
  /** Cash & bank balances start from these amounts on openingDate. */
  openingCash?: number; openingBank?: number; openingDate?: string;
  /** End-of-service gratuity (days of basic wage per year of service) and paid annual leave days per year. */
  gratuityDaysPerYear?: number; annualLeaveDays?: number;
  /** Store locations for stock transfers (Main store, Workshop, Site…). */
  stockLocations?: string[];
  /** Other currencies and their rate to the home currency (1 USD = 0.385 OMR). */
  currencies?: { code: string; rate: number }[];
  /** Named VAT rates (Oman: standard 5%, zero-rated 0%, exempt). */
  taxRates?: { name: string; rate: number }[];
  /** Notifications: amount from which a single money entry is flagged as important. */
  bigTxn?: number;
  /** Non-secret plugin switches and options, shared with every device. Secrets live on the server only. */
  plugins?: Record<string, PluginState>;
}
export interface PluginState { enabled: boolean; [k: string]: unknown }

export interface DB {
  customers: Customer[]; jobs: Job[]; tasks: Task[]; staff: Staff[]; attendance: Attendance[]; advances: Advance[]; payslips: Payslip[];
  quotations: Quotation[]; invoices: Invoice[]; txns: Txn[]; items: Item[]; sales: Sale[]; socialAccounts: SocialAccount[]; socialPosts: SocialPost[];
  suppliers: Supplier[]; purchases: Purchase[]; receipts: Receipt[]; deliveries: Delivery[]; measurements: Measurement[];
  cheques: Cheque[]; creditNotes: CreditNote[]; services: ServiceCall[]; recurring: Recurring[];
  brands: Brand[]; catalog: CatalogItem[]; selections: Selection[]; expenseChat: ExpenseMsg[];
  stockMoves: StockMove[]; journals: Journal[]; workReports: WorkReport[];
  settings: Settings;
}
export type Collection = Exclude<keyof DB, 'settings'>;

export interface Supplier extends Base { name: string; phone?: string; email?: string; address?: string; category?: string; vatNumber?: string; notes?: string }
export interface PurchaseLine { id: ID; itemId?: ID; description: string; qty: number; unit: string; rate: number; received?: number }
export interface Purchase extends Base {
  number: string; date: string; supplierId?: ID; jobId?: ID; status: 'ordered' | 'received' | 'cancelled'; lines: PurchaseLine[];
  vat: number; paid: number; dueDate?: string; billNo?: string; notes?: string; receivedDate?: string;
  /** Supplier payments made against this purchase and goods sent back. */
  payments?: { id: ID; date: string; amount: number; method: string; txnId?: ID; chequeNo?: string }[];
  returns?: { id: ID; date: string; lines: { lineId: ID; qty: number }[]; amount: number; reason?: string; refund?: number; txnId?: ID }[];
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

/**
 * One message in a project's expense chat: bill photos + text + amount. From the office it is posted
 * to Accounts straight away; from staff it is a claim the office approves.
 */
export interface ExpenseMsg extends Base {
  jobId?: ID; text: string; photos: string[]; amount?: number; category?: string; method?: string; date: string;
  byUserId?: string; byName?: string; byStaffId?: ID;
  status: 'note' | 'pending' | 'posted' | 'rejected'; txnId?: ID; reply?: string;
  /** Filled in by reading the bill photo (OCR): check these. */
  ocr?: { amount?: number; date?: string; vendor?: string; billNo?: string; vat?: number; confidence?: number };
}
