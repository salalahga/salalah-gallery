// Role-based access control, enforced on the server for every API call.
// A user's rights for a module = the role default, unless the owner saved an explicit grant for that user
// (user_permissions), which replaces the default — always clamped by the role's hard ceiling.

export const LEVELS = ['view', 'create', 'edit', 'approve', 'manage', 'export'];

export const MODULES = {
  dashboard: 'Dashboard', pos: 'POS & till', sales: 'Sales & orders', inventory: 'Inventory', purchases: 'Purchases & suppliers',
  promotions: 'Offers & promotions', customers: 'Customers (CRM)', finance: 'Finance & accounting', payments: 'Payments',
  reports: 'Reports & exports', hr: 'HR & payroll', staff: 'Staff, attendance & leave', branches: 'Branches', online: 'Online store',
  whatsapp: 'WhatsApp', marketing: 'Social & campaigns', assistant: 'AI assistant', audit: 'Audit log', users: 'Users & logins', settings: 'Business settings',
};
export const MODULE_KEYS = Object.keys(MODULES);

const ALL = LEVELS;
const V = ['view'];
const VC = ['view', 'create'];
const VCE = ['view', 'create', 'edit'];
const VX = ['view', 'export'];

export const ROLE_DEFAULTS = {
  owner: Object.fromEntries(MODULE_KEYS.map((m) => [m, ALL])),
  admin: Object.fromEntries(MODULE_KEYS.map((m) => [m, ALL])),
  // Managers start with operational monitoring only. The owner widens this per manager.
  manager: { dashboard: V, sales: V, pos: V, inventory: V, purchases: V, promotions: V, customers: V, staff: V, branches: V, online: V, whatsapp: V, reports: V },
  accountant: { dashboard: V, finance: ALL, payments: ALL, reports: VX, purchases: ['view', 'create', 'edit'], sales: V, inventory: V, customers: V, assistant: V },
  hr: { dashboard: V, hr: ALL, staff: ALL, reports: VX },
  cashier: { pos: VC, customers: VC, inventory: V, promotions: V }, // cashiers see only their own sales
  staff: { pos: VC, customers: VC, inventory: V },
};

// What a role can never be granted, whatever the owner saves.
export const ROLE_CEILING = {
  owner: null, admin: null,
  manager: { users: [], settings: [] },
  accountant: { users: [], settings: [] },
  hr: { users: [], settings: [], finance: [] },
  cashier: { users: [], settings: [], finance: [], hr: [], audit: [] },
  staff: { users: [], settings: [], finance: [], hr: [], audit: [], reports: [] },
};

/** Effective permissions: { module: Set(levels) } */
export function effectivePermissions(user, grants = []) {
  const base = ROLE_DEFAULTS[user.role] || {};
  const ceiling = ROLE_CEILING[user.role];
  const out = {};
  for (const m of MODULE_KEYS) out[m] = new Set(base[m] || []);
  if (user.role !== 'owner') for (const g of grants) {
    if (!MODULES[g.module]) continue;
    out[g.module] = new Set((g.levels || []).filter((l) => LEVELS.includes(l)));
  }
  if (ceiling) for (const [m, allowed] of Object.entries(ceiling)) out[m] = new Set([...out[m]].filter((l) => allowed.includes(l)));
  // any level implies view
  for (const m of MODULE_KEYS) if (out[m].size) out[m].add('view');
  return out;
}

export const can = (perms, module, level = 'view') => !!perms?.[module]?.has(level);

/** Branch restriction: null = all branches, otherwise the list the user may act on. */
export function branchScope(user, grants, module) {
  if (['owner', 'admin', 'accountant'].includes(user.role)) return null;
  const g = grants.find((x) => x.module === module);
  if (g?.branch_ids?.length) return g.branch_ids;
  if (['cashier', 'staff'].includes(user.role) && user.branch_id) return [user.branch_id];
  if (user.role === 'manager' && user.branch_id && !g) return [user.branch_id];
  return null;
}

/** Cost prices, margins and profit are financial information. */
export const canSeeCost = (perms) => can(perms, 'finance', 'view') || can(perms, 'inventory', 'manage');

export const serialisePerms = (perms) => Object.fromEntries(Object.entries(perms).map(([k, v]) => [k, [...v]]));
