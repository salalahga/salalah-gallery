// Role based access. Enforced on the server; the UI only hides what a role cannot use.
//   admin   — owner: everything, including payroll, settings and user accounts
//   manager — everything except payroll (payslips/advances), settings and users
//   staff   — sees jobs, own tasks and the team; can update only tasks and service visits assigned
//             to them and record their own site measurements
//   viewer  — read-only. "Owner viewer" sees everything (modules ['*']); other viewers only the
//             modules the owner ticked. A viewer can never create, change or delete anything.
export const COLLECTIONS = ['customers', 'jobs', 'tasks', 'staff', 'attendance', 'advances', 'payslips', 'quotations', 'invoices', 'txns', 'items', 'sales', 'socialAccounts', 'socialPosts', 'suppliers', 'purchases', 'receipts', 'deliveries', 'measurements', 'cheques', 'creditNotes', 'services', 'recurring', 'brands', 'catalog', 'selections', 'expenseChat', 'stockMoves', 'journals', 'workReports'];
const ALL = new Set(COLLECTIONS);
const MANAGER = new Set(COLLECTIONS.filter((c) => !['payslips', 'advances'].includes(c)));
const STAFF_READ = new Set(['jobs', 'tasks', 'staff', 'items', 'customers', 'measurements', 'services', 'brands', 'catalog', 'expenseChat', 'workReports']);

// What each app module needs to read (for viewers with chosen modules).
export const MODULE_COLS = {
  dashboard: ['jobs', 'tasks', 'invoices', 'txns', 'quotations', 'items', 'staff', 'customers', 'cheques', 'services', 'selections', 'expenseChat', 'purchases', 'receipts', 'sales', 'suppliers', 'creditNotes'],
  jobs: ['jobs', 'customers', 'tasks', 'staff', 'items', 'txns', 'invoices', 'receipts', 'quotations', 'expenseChat', 'measurements', 'selections', 'catalog', 'brands', 'creditNotes'],
  expchat: ['expenseChat', 'jobs', 'txns'], tasks: ['tasks', 'jobs', 'staff'], measurements: ['measurements', 'customers', 'jobs', 'staff'],
  services: ['services', 'customers', 'jobs', 'staff', 'invoices'], catalog: ['catalog', 'brands', 'selections', 'customers', 'jobs', 'items'],
  purchases: ['purchases', 'suppliers', 'items', 'jobs', 'txns', 'cheques', 'stockMoves'], inventory: ['items', 'stockMoves', 'jobs'],
  production: ['jobs', 'customers', 'staff', 'tasks'],
  finance: ['txns', 'journals', 'invoices', 'purchases', 'items', 'receipts', 'cheques', 'creditNotes', 'sales', 'jobs', 'suppliers', 'customers', 'advances', 'payslips', 'stockMoves'],
  assistant: ['jobs', 'customers', 'txns', 'invoices', 'receipts', 'items', 'purchases', 'suppliers', 'expenseChat', 'tasks', 'staff', 'creditNotes', 'stockMoves', 'quotations', 'sales'],
  staff: ['staff', 'tasks', 'jobs', 'attendance', 'payslips', 'advances', 'workReports'], attendance: ['attendance', 'staff'], payroll: ['payslips', 'advances', 'staff', 'attendance'],
  customers: ['customers', 'jobs', 'quotations', 'invoices', 'receipts', 'creditNotes', 'sales', 'services', 'measurements', 'txns'],
  quotations: ['quotations', 'customers', 'jobs', 'invoices', 'receipts'], invoices: ['invoices', 'customers', 'jobs', 'receipts', 'creditNotes'],
  documents: ['receipts', 'deliveries', 'cheques', 'creditNotes', 'customers', 'invoices', 'jobs', 'quotations'], sales: ['sales', 'items', 'customers'],
  accounts: ['txns', 'jobs', 'cheques', 'recurring', 'receipts', 'sales', 'advances', 'expenseChat'],
  reports: ['invoices', 'purchases', 'suppliers', 'customers', 'staff', 'attendance', 'creditNotes', 'sales', 'receipts', 'txns', 'cheques', 'jobs', 'quotations', 'items', 'stockMoves', 'tasks', 'workReports', 'journals', 'advances'],
  social: ['socialAccounts', 'socialPosts', 'jobs'], website: ['items'],
};
export const VIEWER_MODULES = Object.keys(MODULE_COLS);
function viewerCols(modules) {
  const m = Array.isArray(modules) ? modules : [];
  if (m.includes('*')) return ALL;
  return new Set(m.flatMap((id) => MODULE_COLS[id] || []));
}
export const isCollection = (col) => ALL.has(col);
/** user = the users row (or a role string, for older callers). */
export const canRead = (user, col) => {
  const role = typeof user === 'string' ? user : user.role;
  if (role === 'viewer') return viewerCols(typeof user === 'string' ? [] : user.modules).has(col);
  return (role === 'admin' ? ALL : role === 'manager' ? MANAGER : STAFF_READ).has(col);
};

export function canWrite(user, col, before, after) {
  if (user.role === 'viewer') return false;
  if (user.role === 'admin') return ALL.has(col);
  // only the owner closes a project, and a closed project can only be changed by the owner
  if (col === 'jobs' && ((before && before.closedAt) || (after && after.closedAt))) return false;
  // manual journals are the owner's
  if (col === 'journals') return false;
  if (user.role === 'manager') return MANAGER.has(col);
  if (!user.staff_id) return false;
  // staff record their own site measurements
  if (col === 'measurements') return (!before || before.measuredBy === user.staff_id) && (!after || after.measuredBy === user.staff_id);
  // staff update the service visits assigned to them (cannot create or reassign)
  // staff post bill photos as claims (or notes); the office approves them into Accounts
  if (col === 'expenseChat') {
    const own = (r) => !r || (r.byStaffId === user.staff_id && ['pending', 'note'].includes(r.status) && !r.txnId);
    return own(before) && own(after) && (!before || before.status !== 'posted');
  }
  // staff write their own daily work reports (the office can see and rate them)
  if (col === 'workReports') { const own = (r) => !r || (r.staffId === user.staff_id && !r.rating); return own(before) && own(after); }
  if (col === 'services') return !!before && before.staffId === user.staff_id && (!after || after.staffId === user.staff_id);
  if (col !== 'tasks') return false;
  return (!before || before.staffId === user.staff_id) && (!after || after.staffId === user.staff_id);
}
export const canDelete = (user, col) => user.role === 'admin' || (user.role === 'manager' && MANAGER.has(col));

// Hide sensitive fields from lower roles.
export function redact(role, col, rec, staffId) {
  if (role === 'admin' || !rec) return rec;
  if (role === 'staff') {
    if (col === 'staff') { const { rate, allowance, bank, idNumber, documents, ...r } = rec; return r; }
    if (col === 'jobs') { const { value, ...r } = rec; return r; }
    if (col === 'items') { const { cost, ...r } = rec; return r; }
    if (col === 'services') { const { charge, ...r } = rec; return r; }
    if (col === 'catalog') { const { price, ...r } = rec; return r; }
    // staff only see their own expense messages
    if (col === 'workReports') return rec.staffId === staffId ? rec : null;
    if (col === 'expenseChat') return rec.byStaffId && rec.byStaffId === staffId ? rec : null;
    if (col === 'customers') return { id: rec.id, name: rec.name, address: rec.address, phone: rec.phone, createdAt: rec.createdAt };
  }
  return rec;
}

// Fields a manager/staff save must not overwrite with their redacted copy.
export function mergeProtected(role, col, before, after) {
  if (role !== 'staff' || !before) return after;
  return { ...before, ...after };
}
