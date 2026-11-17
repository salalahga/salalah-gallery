import type { ComponentType } from 'react';
import Dashboard from './Dashboard';
import POS from './POS';
import Sales from './Sales';
import Inventory from './Inventory';
import Purchases from './Purchases';
import Promotions from './Promotions';
import Customers from './Customers';
import Finance from './Finance';
import HR from './HR';
import Users from './Users';
import Settings from './Settings';
import { Assistant, Approvals, Reports, Audit, Account } from './Misc';

export type ModuleDef = { route: string; label: string; icon: string; section: string; need?: [string, string][]; component: ComponentType<any> };

// One registry, filtered per user by the permissions the server returns.
export const MODULES: ModuleDef[] = [
  { route: '', label: 'Dashboard', icon: 'dashboard', section: 'Overview', need: [['dashboard', 'view'], ['sales', 'view']], component: Dashboard },
  { route: 'assistant', label: 'Assistant', icon: 'assistant', section: 'Overview', need: [['assistant', 'view'], ['dashboard', 'view']], component: Assistant },
  { route: 'approvals', label: 'Approvals', icon: 'approvals', section: 'Overview', need: [['pos', 'approve']], component: Approvals },
  { route: 'pos', label: 'Point of sale', icon: 'pos', section: 'Selling', need: [['pos', 'create']], component: POS },
  { route: 'sales', label: 'Sales & orders', icon: 'sales', section: 'Selling', need: [['sales', 'view'], ['pos', 'view']], component: Sales },
  { route: 'customers', label: 'Customers', icon: 'customers', section: 'Selling', need: [['customers', 'view']], component: Customers },
  { route: 'promotions', label: 'Promotions', icon: 'promotions', section: 'Selling', need: [['promotions', 'view']], component: Promotions },
  { route: 'inventory', label: 'Inventory', icon: 'inventory', section: 'Stock', need: [['inventory', 'view']], component: Inventory },
  { route: 'purchases', label: 'Purchases', icon: 'purchases', section: 'Stock', need: [['purchases', 'view']], component: Purchases },
  { route: 'finance', label: 'Finance', icon: 'finance', section: 'Money', need: [['finance', 'view']], component: Finance },
  { route: 'reports', label: 'Reports', icon: 'reports', section: 'Money', need: [['reports', 'view']], component: Reports },
  { route: 'hr', label: 'HR & staff', icon: 'hr', section: 'Team', need: [['hr', 'view'], ['staff', 'view']], component: HR },
  { route: 'users', label: 'Users', icon: 'users', section: 'System', need: [['users', 'view']], component: Users },
  { route: 'settings', label: 'Settings', icon: 'settings', section: 'System', need: [['settings', 'view'], ['branches', 'manage']], component: Settings },
  { route: 'audit', label: 'Audit log', icon: 'audit', section: 'System', need: [['audit', 'view']], component: Audit },
  { route: 'account', label: 'My account', icon: 'users', section: 'System', component: Account },
];

// The business manager's app: monitoring first; editing only where the owner granted it.
export const MANAGER_MODULES: ModuleDef[] = MODULES.filter((m) => !['users', 'settings', 'pos'].includes(m.route));
