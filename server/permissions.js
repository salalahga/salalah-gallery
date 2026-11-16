// Role based access. Enforced on the server; the UI only hides what a role cannot use.
//   admin   — owner: everything, including payroll, settings and user accounts
//   manager — everything except payroll (payslips/advances), settings and users
//   staff   — sees jobs, own tasks and the team; can update only tasks and service visits assigned
//             to them and record their own site measurements
export const COLLECTIONS = ['customers', 'jobs', 'tasks', 'staff', 'attendance', 'advances', 'payslips', 'quotations', 'invoices', 'txns', 'items', 'sales', 'socialAccounts', 'socialPosts', 'suppliers', 'purchases', 'receipts', 'deliveries', 'measurements', 'cheques', 'creditNotes', 'services', 'recurring', 'brands', 'catalog', 'selections', 'expenseChat'];
const ALL = new Set(COLLECTIONS);
const MANAGER = new Set(COLLECTIONS.filter((c) => !['payslips', 'advances'].includes(c)));
const STAFF_READ = new Set(['jobs', 'tasks', 'staff', 'items', 'customers', 'measurements', 'services', 'brands', 'catalog', 'expenseChat']);

export const isCollection = (col) => ALL.has(col);
export const canRead = (role, col) => (role === 'admin' ? ALL : role === 'manager' ? MANAGER : STAFF_READ).has(col);

export function canWrite(user, col, before, after) {
  if (user.role === 'admin') return ALL.has(col);
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
