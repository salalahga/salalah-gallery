/**
 * MODULE REGISTRY
 * ----------------
 * To add a new feature in future: create a component in src/modules/,
 * then add ONE entry below. It appears in the sidebar, search and routing automatically.
 */
import type { ComponentType } from 'react';
import {
  LayoutDashboard, Hammer, ListChecks, Users, CalendarCheck, Wallet, Contact, FileText, Receipt, Landmark, Boxes, ShoppingCart,
  Share2, Globe, Settings as Cog, Puzzle, Zap, Truck, Ruler, FileCheck2, type LucideIcon,
} from 'lucide-react';
import Dashboard from './Dashboard';
import Jobs from './Jobs';
import Tasks from './Tasks';
import StaffPage from './Staff';
import AttendancePage from './Attendance';
import Payroll from './Payroll';
import Customers from './Customers';
import Quotations from './Quotations';
import Invoices from './Invoices';
import Accounts from './Accounts';
import Inventory from './Inventory';
import Sales from './Sales';
import Social from './Social';
import Website from './Website';
import SettingsPage from './Settings';
import Plugins from './Plugins';
import Purchases from './Purchases';
import Measurements from './Measurements';
import Documents from './Documents';
import Automations from './Automations';

import type { Role } from '../core/session';

export interface ModuleDef { id: string; label: string; group: string; icon: LucideIcon; component: ComponentType; desc: string; roles?: Role[] }
const OWNER: Role[] = ['admin'];
const OFFICE: Role[] = ['admin', 'manager'];

export const modules: ModuleDef[] = [
  { id: 'dashboard', label: 'Dashboard', group: 'Workshop', icon: LayoutDashboard, component: Dashboard, roles: OFFICE, desc: 'Overview of everything' },
  { id: 'jobs', label: 'Projects', group: 'Workshop', icon: Hammer, component: Jobs, desc: 'Every work as a project: value, collections, expenses, profit' },
  { id: 'tasks', label: 'Tasks', group: 'Workshop', icon: ListChecks, component: Tasks, desc: 'Assign work to staff' },
  { id: 'measurements', label: 'Site measurements', group: 'Workshop', icon: Ruler, component: Measurements, desc: 'Measure on site with photos & GPS, then quote' },
  { id: 'purchases', label: 'Purchases', group: 'Workshop', icon: Truck, component: Purchases, roles: OFFICE, desc: 'Suppliers, purchase orders, goods received' },
  { id: 'inventory', label: 'Inventory', group: 'Workshop', icon: Boxes, component: Inventory, desc: 'Boards, hardware & products stock' },
  { id: 'staff', label: 'Staff', group: 'Team', icon: Users, component: StaffPage, roles: OFFICE, desc: 'Employees, skills and documents' },
  { id: 'attendance', label: 'Attendance', group: 'Team', icon: CalendarCheck, component: AttendancePage, roles: OFFICE, desc: 'Daily attendance & overtime' },
  { id: 'payroll', label: 'Payroll', group: 'Team', icon: Wallet, component: Payroll, roles: OWNER, desc: 'Monthly salary, advances, payslips' },
  { id: 'customers', label: 'Customers', group: 'Business', icon: Contact, component: Customers, roles: OFFICE, desc: 'Clients and contacts' },
  { id: 'quotations', label: 'Quotations', group: 'Business', icon: FileText, component: Quotations, roles: OFFICE, desc: 'Create & send quotations' },
  { id: 'invoices', label: 'Invoices', group: 'Business', icon: Receipt, component: Invoices, roles: OFFICE, desc: 'Billing and payments' },
  { id: 'documents', label: 'Receipts & Delivery', group: 'Business', icon: FileCheck2, component: Documents, roles: OFFICE, desc: 'Advance/payment receipts and delivery notes' },
  { id: 'sales', label: 'Sales', group: 'Business', icon: ShoppingCart, component: Sales, roles: OFFICE, desc: 'Product sales / POS' },
  { id: 'accounts', label: 'Accounts', group: 'Money', icon: Landmark, component: Accounts, roles: OFFICE, desc: 'Income, expenses, profit & loss' },
  { id: 'social', label: 'Social Media', group: 'Growth', icon: Share2, component: Social, roles: OFFICE, desc: 'Plan & share posts' },
  { id: 'website', label: 'Website', group: 'Growth', icon: Globe, component: Website, roles: OWNER, desc: 'Build your business website' },
  { id: 'plugins', label: 'Plugins', group: 'System', icon: Puzzle, component: Plugins, roles: OWNER, desc: 'Telegram, email, webhooks, calendar, QR, export, app install' },
  { id: 'automations', label: 'Automations', group: 'System', icon: Zap, component: Automations, roles: OWNER, desc: 'When X happens → notify / webhook / create task' },
  { id: 'settings', label: 'Settings', group: 'System', icon: Cog, component: SettingsPage, roles: OWNER, desc: 'Business profile, work types, backup' },
];

export const modulesFor = (role: Role) => modules.filter((m) => !m.roles || m.roles.includes(role));
