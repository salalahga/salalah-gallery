/**
 * MODULE REGISTRY
 * ----------------
 * To add a new feature in future: create a component in src/modules/,
 * then add ONE entry below. It appears in the sidebar, search and routing automatically.
 */
import type { ComponentType } from 'react';
import {
  LayoutDashboard, Hammer, ListChecks, Users, CalendarCheck, Wallet, Contact, FileText, Receipt, Landmark, Boxes, ShoppingCart,
  Share2, Globe, Settings as Cog, type LucideIcon,
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

export interface ModuleDef { id: string; label: string; group: string; icon: LucideIcon; component: ComponentType; desc: string }

export const modules: ModuleDef[] = [
  { id: 'dashboard', label: 'Dashboard', group: 'Workshop', icon: LayoutDashboard, component: Dashboard, desc: 'Overview of everything' },
  { id: 'jobs', label: 'Jobs', group: 'Workshop', icon: Hammer, component: Jobs, desc: 'CNC, carpentry, board & other work orders' },
  { id: 'tasks', label: 'Tasks', group: 'Workshop', icon: ListChecks, component: Tasks, desc: 'Assign work to staff' },
  { id: 'inventory', label: 'Inventory', group: 'Workshop', icon: Boxes, component: Inventory, desc: 'Boards, hardware & products stock' },
  { id: 'staff', label: 'Staff', group: 'Team', icon: Users, component: StaffPage, desc: 'Employees, skills and documents' },
  { id: 'attendance', label: 'Attendance', group: 'Team', icon: CalendarCheck, component: AttendancePage, desc: 'Daily attendance & overtime' },
  { id: 'payroll', label: 'Payroll', group: 'Team', icon: Wallet, component: Payroll, desc: 'Monthly salary, advances, payslips' },
  { id: 'customers', label: 'Customers', group: 'Business', icon: Contact, component: Customers, desc: 'Clients and contacts' },
  { id: 'quotations', label: 'Quotations', group: 'Business', icon: FileText, component: Quotations, desc: 'Create & send quotations' },
  { id: 'invoices', label: 'Invoices', group: 'Business', icon: Receipt, component: Invoices, desc: 'Billing and payments' },
  { id: 'sales', label: 'Sales', group: 'Business', icon: ShoppingCart, component: Sales, desc: 'Product sales / POS' },
  { id: 'accounts', label: 'Accounts', group: 'Money', icon: Landmark, component: Accounts, desc: 'Income, expenses, profit & loss' },
  { id: 'social', label: 'Social Media', group: 'Growth', icon: Share2, component: Social, desc: 'Plan & share posts' },
  { id: 'website', label: 'Website', group: 'Growth', icon: Globe, component: Website, desc: 'Build your business website' },
  { id: 'settings', label: 'Settings', group: 'System', icon: Cog, component: SettingsPage, desc: 'Business profile, work types, backup' },
];
