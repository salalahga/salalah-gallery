import type { DB, Settings } from './types';

const d = (offset: number) => { const x = new Date(); x.setDate(x.getDate() + offset); return x.toISOString().slice(0, 10); };
const ts = new Date().toISOString();

export const defaultSettings: Settings = {
  businessName: 'Teraz Investment L.L.C', tagline: 'Carpentry, CNC & signboard works', phone: '+968 9808 2291', whatsapp: '96898082291',
  email: '', address: 'P.O. Box 811, Postal Code 215', city: 'Salalah', country: 'Oman', currency: 'OMR', vatRate: 0, vatNumber: '', crNumber: '1360908',
  logo: '/teraz-logo.png', logoLight: '/teraz-logo-light.png', poBox: 'P.O. Box 811, Postal Code 215',
  paymentInfo: 'Payment Mode - Cash or Cheque\nBank cheque can be issued in the name of Teraz Investment LLC\nBank Account Name: Teraz Investment LLC\nBank Name: Bank Muscat\nAccount No: 0423057913090018\nIBAN: OM400270423057913090018',
  invoicePrefix: '', invoiceStart: 1212,
  businessNameAr: 'تيراز للاستثمار ش.م.م', addressAr: 'ص.ب ٨١١، الرمز البريدي ٢١٥، صلالة، سلطنة عمان', arabicOnDocs: true, docExpiryDays: 30,
  workTypes: [
    { id: 'wt-cnc', name: 'CNC Work', color: '#2563eb', unit: 'sheet', rate: 25, fields: ['Design file', 'Material', 'Sheet size', 'Thickness (mm)', 'Machine hours', 'Bit / tool'] },
    { id: 'wt-carp', name: 'Carpentry', color: '#b45309', unit: 'job', rate: 0, fields: ['Item type', 'Dimensions (W×H×D)', 'Wood type', 'Hardware', 'Site address'] },
    { id: 'wt-board', name: 'Board Work', color: '#059669', unit: 'sheet', rate: 18, fields: ['Board type', 'Thickness (mm)', 'Sheets', 'Edge banding (m)', 'Colour / finish'] },
    { id: 'wt-polish', name: 'Polish & Paint', color: '#9333ea', unit: 'sqm', rate: 4, fields: ['Finish type', 'Colour code', 'Area (sqm)', 'Coats'] },
    { id: 'wt-sign', name: 'Signboards', color: '#0891b2', unit: 'pcs', rate: 0, fields: ['Size (W×H)', 'Material (ACP / Acrylic / MDF)', 'Letters / design', 'Lighting (LED)', 'Installation height / site'] },
    { id: 'wt-install', name: 'Installation', color: '#dc2626', unit: 'visit', rate: 15, fields: ['Site address', 'Contact on site', 'Team size', 'Vehicle'] },
  ],
  expenseCategories: ['Materials', 'Boards & Sheets', 'Hardware', 'Labour', 'Subcontractor', 'Salary', 'Rent', 'Electricity & Water', 'Fuel & Transport', 'Machine Maintenance', 'Tools', 'Marketing', 'Visa & Labour', 'Other'],
  incomeCategories: ['Job Payment', 'Product Sale', 'CNC Service', 'Advance', 'Other'],
  roles: ['Carpenter', 'CNC Operator', 'Helper', 'Polisher', 'Supervisor', 'Designer', 'Driver', 'Accountant'],
  quoteTerms: '50% advance to confirm the order. Balance on delivery.\nQuotation valid for 15 days.\nDelivery time starts after design approval.',
  workHoursPerDay: 8, overtimeMultiplier: 1.25, workingDaysPerMonth: 26, gratuityDaysPerYear: 30, annualLeaveDays: 30, openingCash: 0, openingBank: 0, timezone: 'Asia/Muscat', dailyHour: 8,
  plugins: { whatsapp: { enabled: true }, print: { enabled: true }, maps: { enabled: true }, export: { enabled: true } },
  website: {
    hero: 'Carpentry, precise CNC cutting, signboards and complete interior woodwork in Salalah.',
    about: 'Teraz Investment L.L.C is a Salalah workshop delivering carpentry, CNC work, signboards and custom furniture with quality materials and on-time installation.',
    theme: 'walnut', gallery: [
      'https://images.unsplash.com/photo-1556911220-bff31c812dba?w=800',
      'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?w=800',
      'https://images.unsplash.com/photo-1595428774223-ef52624120d2?w=800',
    ], showProducts: true, mapUrl: '',
  },
};

export function emptyDB(): Omit<DB, 'settings'> {
  return { customers: [], jobs: [], tasks: [], staff: [], attendance: [], advances: [], payslips: [], quotations: [], invoices: [], txns: [], items: [], sales: [], socialAccounts: [], socialPosts: [], suppliers: [], purchases: [], receipts: [], deliveries: [], measurements: [], cheques: [], creditNotes: [], services: [], recurring: [], brands: [], catalog: [], selections: [], expenseChat: [] };
}

export function seed(): DB {
  return {
    settings: structuredClone(defaultSettings),
    customers: [
      { id: 'c1', createdAt: ts, name: 'Ahmed Al Mashani', phone: '+968 9123 4567', email: 'ahmed@example.com', address: 'Al Saada, Salalah', type: 'Individual' },
      { id: 'c2', createdAt: ts, name: 'Dhofar Interiors LLC', phone: '+968 2321 0000', email: 'projects@dhofar-int.example', address: 'Al Dahariz', type: 'Company' },
      { id: 'c3', createdAt: ts, name: 'Fatima Al Kathiri', phone: '+968 9988 7766', address: 'Awqad', type: 'Individual' },
    ],
    staff: [
      { id: 's1', createdAt: ts, name: 'Rajesh Kumar', role: 'Carpenter', phone: '+968 9500 1111', nationality: 'Indian', salaryType: 'monthly', rate: 220, allowance: 20, skills: ['Kitchen', 'Wardrobe', 'Doors'], active: true, color: '#b45309', joinDate: '2022-03-01', leaveFrom: `${new Date().getFullYear()}-01-01`, leaveOpening: 0, documents: [{ id: 'd1', type: 'Resident card', number: 'RC-12345678', expiry: d(12) }, { id: 'd2', type: 'Passport', number: 'P1234567', expiry: d(400) }] },
      { id: 's2', createdAt: ts, name: 'Anil Thomas', role: 'CNC Operator', phone: '+968 9500 2222', nationality: 'Indian', salaryType: 'monthly', rate: 260, allowance: 25, skills: ['CNC', 'AutoCAD', 'Aspire'], active: true, color: '#2563eb', joinDate: '2023-01-15', leaveFrom: `${new Date().getFullYear()}-01-01`, leaveOpening: 4 },
      { id: 's3', createdAt: ts, name: 'Shafeeq M', role: 'Polisher', phone: '+968 9500 3333', nationality: 'Indian', salaryType: 'daily', rate: 9, allowance: 0, skills: ['PU', 'Lacquer'], active: true, color: '#9333ea', joinDate: '2024-06-10' },
      { id: 's4', createdAt: ts, name: 'Babu Raj', role: 'Helper', phone: '+968 9500 4444', nationality: 'Indian', salaryType: 'daily', rate: 7, allowance: 0, skills: ['Loading', 'Assembly'], active: true, color: '#059669', joinDate: '2024-09-01' },
    ],
    jobs: [
      { id: 'j1', createdAt: ts, code: 'JOB-101', title: 'Kitchen cabinets — Villa 12', customerId: 'c1', workTypeId: 'wt-carp', status: 'production', priority: 'high', startDate: d(-10), dueDate: d(6), value: 1850, staffIds: ['s1', 's4'], details: { 'Item type': 'Kitchen', 'Dimensions (W×H×D)': '4200×2400×600', 'Wood type': 'Marine ply + HPL' }, materials: [], progress: 55 },
      { id: 'j2', createdAt: ts, code: 'JOB-102', title: 'CNC jali panels (12 pcs)', customerId: 'c2', workTypeId: 'wt-cnc', status: 'design', priority: 'normal', startDate: d(-2), dueDate: d(4), value: 420, staffIds: ['s2'], details: { 'Design file': 'jali-arabic-v2.dxf', Material: 'MDF', 'Sheet size': '1220×2440', 'Thickness (mm)': '18', 'Machine hours': '9' }, materials: [], progress: 20 },
      { id: 'j3', createdAt: ts, code: 'JOB-103', title: 'Wardrobe — master bedroom', customerId: 'c3', workTypeId: 'wt-board', status: 'finishing', priority: 'normal', startDate: d(-15), dueDate: d(2), value: 780, staffIds: ['s1', 's3'], details: { 'Board type': 'Melamine MDF', 'Thickness (mm)': '18', Sheets: '9', 'Colour / finish': 'Oak grey' }, materials: [], progress: 80 },
      { id: 'j4', createdAt: ts, code: 'JOB-104', title: 'Main door polish', customerId: 'c1', workTypeId: 'wt-polish', status: 'enquiry', priority: 'low', dueDate: d(14), value: 120, staffIds: [], details: {}, materials: [], progress: 0 },
    ],
    tasks: [
      { id: 't1', createdAt: ts, title: 'Cut carcass panels', jobId: 'j1', staffId: 's1', status: 'doing', priority: 'high', dueDate: d(1), hours: 6 },
      { id: 't2', createdAt: ts, title: 'Prepare toolpaths in Aspire', jobId: 'j2', staffId: 's2', status: 'todo', priority: 'normal', dueDate: d(1) },
      { id: 't3', createdAt: ts, title: 'Sanding + 2 coats PU', jobId: 'j3', staffId: 's3', status: 'doing', priority: 'normal', dueDate: d(0) },
      { id: 't4', createdAt: ts, title: 'Site measurement', jobId: 'j4', staffId: 's4', status: 'todo', priority: 'low', dueDate: d(3) },
      { id: 't5', createdAt: ts, title: 'Edge banding', jobId: 'j3', staffId: 's1', status: 'done', priority: 'normal', dueDate: d(-1) },
    ],
    attendance: [], advances: [{ id: 'a1', createdAt: ts, staffId: 's4', date: d(-5), amount: 20, note: 'Personal', recovered: false }], payslips: [],
    quotations: [
      { id: 'q1', createdAt: ts, number: `QT-${new Date().getFullYear()}-0001`, date: d(-12), validUntil: d(3), customerId: 'c1', title: 'Kitchen cabinets — Villa 12', status: 'accepted', discount: 50, vat: 5, jobId: 'j1',
        items: [{ id: 'l1', description: 'Base cabinets, marine ply with HPL', qty: 4.2, unit: 'rm', rate: 220 }, { id: 'l2', description: 'Wall cabinets', qty: 3.6, unit: 'rm', rate: 160 }, { id: 'l3', description: 'Soft-close hardware set', qty: 1, unit: 'lot', rate: 95 }] },
      { id: 'q2', createdAt: ts, number: `QT-${new Date().getFullYear()}-0002`, date: d(-1), validUntil: d(14), customerId: 'c2', title: 'CNC Jali panels', status: 'sent', discount: 0, vat: 5, items: [{ id: 'l4', description: 'CNC cutting jali 18mm MDF', workTypeId: 'wt-cnc', qty: 12, unit: 'pcs', rate: 35 }] },
    ],
    invoices: [
      { id: 'i1', createdAt: ts, number: '1212', date: d(-10), dueDate: d(20), customerId: 'c1', title: 'Kitchen cabinets — advance', jobId: 'j1', quotationId: 'q1', discount: 0, vat: 5, paid: 900,
        items: [{ id: 'l5', description: '50% advance — kitchen cabinets', qty: 1, unit: 'lot', rate: 900 }] },
    ],
    txns: [
      { id: 'x1', createdAt: ts, date: d(-10), kind: 'income', category: 'Advance', amount: 900, method: 'Bank', description: 'Advance — Kitchen Villa 12', ref: 'INV-0001', jobId: 'j1' },
      { id: 'x2', createdAt: ts, date: d(-8), kind: 'expense', category: 'Boards & Sheets', amount: 340, method: 'Cash', description: '20 sheets marine ply', jobId: 'j1' },
      { id: 'x3', createdAt: ts, date: d(-6), kind: 'expense', category: 'Electricity & Water', amount: 85, method: 'Bank', description: 'Workshop electricity' },
      { id: 'x4', createdAt: ts, date: d(-4), kind: 'income', category: 'Product Sale', amount: 65, method: 'Cash', description: 'Walk-in sale' },
      { id: 'x5', createdAt: ts, date: d(-35), kind: 'income', category: 'Job Payment', amount: 1200, method: 'Bank', description: 'Office partitions' },
      { id: 'x6', createdAt: ts, date: d(-33), kind: 'expense', category: 'Salary', amount: 720, method: 'Bank', description: 'Salaries' },
      { id: 'x7', createdAt: ts, date: d(-40), kind: 'expense', category: 'Rent', amount: 250, method: 'Bank', description: 'Workshop rent' },
      { id: 'x8', createdAt: ts, date: d(-65), kind: 'income', category: 'CNC Service', amount: 640, method: 'Cash', description: 'CNC signage' },
      { id: 'x9', createdAt: ts, date: d(-63), kind: 'expense', category: 'Materials', amount: 310, method: 'Cash', description: 'MDF, glue, screws' },
    ],
    items: [
      { id: 'm1', createdAt: ts, name: 'MDF Board', kind: 'material', category: 'Boards & Sheets', unit: 'sheet', qty: 34, cost: 9.5, price: 12, reorder: 15, thickness: '18mm', size: '1220×2440' },
      { id: 'm2', createdAt: ts, name: 'Marine Plywood', kind: 'material', category: 'Boards & Sheets', unit: 'sheet', qty: 8, cost: 17, price: 21, reorder: 10, thickness: '18mm', size: '1220×2440' },
      { id: 'm3', createdAt: ts, name: 'Melamine Board — Oak Grey', kind: 'material', category: 'Boards & Sheets', unit: 'sheet', qty: 22, cost: 13, price: 16, reorder: 8, thickness: '18mm', size: '1830×2440' },
      { id: 'm4', createdAt: ts, name: 'Soft-close hinge', kind: 'material', category: 'Hardware', unit: 'pcs', qty: 140, cost: 0.6, price: 1, reorder: 50 },
      { id: 'm5', createdAt: ts, name: 'PVC Edge Band 22mm', kind: 'material', category: 'Hardware', unit: 'roll', qty: 3, cost: 6, price: 9, reorder: 4 },
      { id: 'p1', createdAt: ts, name: 'Wooden Wall Shelf', kind: 'product', category: 'Furniture', unit: 'pcs', qty: 12, cost: 6, price: 15, reorder: 3, showOnWebsite: true, image: 'https://images.unsplash.com/photo-1594620302200-9a762244a156?w=600', description: 'Solid wood floating shelf, 80cm' },
      { id: 'p2', createdAt: ts, name: 'CNC Arabic Jali Panel', kind: 'product', category: 'Decor', unit: 'pcs', qty: 6, cost: 12, price: 35, reorder: 2, showOnWebsite: true, image: 'https://images.unsplash.com/photo-1618221195710-dd6b41faaea6?w=600', description: 'Decorative MDF panel, 60×120cm' },
      { id: 'p3', createdAt: ts, name: 'Kids Study Table', kind: 'product', category: 'Furniture', unit: 'pcs', qty: 4, cost: 28, price: 65, reorder: 1, showOnWebsite: true, image: 'https://images.unsplash.com/photo-1519710164239-da123dc03ef4?w=600', description: 'Compact desk with drawer' },
    ],
    sales: [],
    socialAccounts: [
      { id: 'sa1', createdAt: ts, platform: 'Instagram', handle: '@salalahgallery', url: 'https://instagram.com/', followers: 1200 },
      { id: 'sa2', createdAt: ts, platform: 'Facebook', handle: 'Salalah Gallery Woodworks', url: 'https://facebook.com/', followers: 860 },
      { id: 'sa3', createdAt: ts, platform: 'WhatsApp Business', handle: '+968 9000 0000', url: 'https://wa.me/96890000000' },
    ],
    socialPosts: [
      { id: 'sp1', createdAt: ts, title: 'Kitchen reveal', caption: 'Fresh kitchen delivered in Al Saada ✨ Marine ply + HPL, soft-close everything. DM for a free quote!', platforms: ['Instagram', 'Facebook'], date: d(2), status: 'scheduled' },
      { id: 'sp2', createdAt: ts, title: 'CNC process reel', caption: 'Watch our CNC carve an Arabic jali pattern in 18mm MDF 🔥', platforms: ['Instagram', 'TikTok'], date: d(5), status: 'draft' },
    ],
    suppliers: [
      { id: 'sup1', createdAt: ts, name: 'Dhofar Timber Trading', phone: '+968 2329 0000', category: 'Boards & Sheets', address: 'Industrial Area, Salalah' },
      { id: 'sup2', createdAt: ts, name: 'Gulf ACP & Acrylic', phone: '+968 9911 2233', category: 'Signage materials' },
    ],
    purchases: [], receipts: [], deliveries: [], measurements: [], creditNotes: [],
    cheques: [{ id: 'ch1', createdAt: ts, direction: 'received', chequeNo: '004512', bank: 'Bank Dhofar', date: d(5), amount: 500, party: 'Dhofar Interiors LLC', status: 'pending', note: 'PDC for CNC jali panels' }],
    brands: [
      { id: 'br1', createdAt: ts, name: 'Formica', website: 'https://www.formica.com', country: 'USA' },
      { id: 'br2', createdAt: ts, name: 'Egger', website: 'https://www.egger.com', country: 'Austria' },
    ],
    catalog: [
      { id: 'ci1', createdAt: ts, brandId: 'br1', code: 'F7912', name: 'Grey Glace', category: 'Laminate', finish: 'Matte', size: '1220×2440', thickness: '0.8mm', price: 14, unit: 'sheet', active: true },
      { id: 'ci2', createdAt: ts, brandId: 'br1', code: 'F5374', name: 'Cherry Wood', category: 'Laminate', finish: 'Suede', size: '1220×2440', thickness: '0.8mm', price: 15, unit: 'sheet', active: true },
      { id: 'ci3', createdAt: ts, brandId: 'br2', code: 'H1145 ST10', name: 'Natural Bardolino Oak', category: 'Board decor', finish: 'Feelwood', size: '2800×2070', thickness: '18mm', price: 32, unit: 'sheet', active: true },
      { id: 'ci4', createdAt: ts, brandId: 'br2', code: 'W980 ST2', name: 'Platinum White', category: 'Board decor', finish: 'Smoothtouch', size: '2800×2070', thickness: '18mm', price: 28, unit: 'sheet', active: true },
    ],
    selections: [], expenseChat: [],
    services: [{ id: 'sv1', createdAt: ts, number: 'SV-0001', date: d(-1), customerId: 'c3', jobId: 'j3', issue: 'Wardrobe door hinge loose', status: 'open', warranty: true }],
    recurring: [{ id: 'rc1', createdAt: ts, description: 'Workshop rent', category: 'Rent', amount: 250, method: 'Bank', day: 1, active: true, startMonth: d(0).slice(0, 7), lastMonth: d(0).slice(0, 7) }],
  };
}
