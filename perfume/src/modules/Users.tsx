import { useState } from 'react';
import { api } from '../core/api';
import { t } from '../core/i18n';
import { useSession, date } from '../core/session';
import { Card, Field, Loading, Modal, PageHead, Status, useAction, useData } from '../components/ui';

const ROLES: [string, string][] = [['admin', 'Admin — everything except owner security'], ['manager', 'Business manager — separate app, owner chooses access'], ['accountant', 'Accountant — finance & payments'], ['hr', 'HR — staff, attendance, payroll'], ['cashier', 'Cashier — POS at their branch'], ['staff', 'Staff — self-service and POS'], ['marketing', 'Marketing manager — prepares content; owner approves & publishes']];

export default function Users() {
  const { can, me } = useSession();
  const { data, reload } = useData<any[]>('/users');
  const [edit, setEdit] = useState<any>(null);
  const [perms, setPerms] = useState<any>(null);
  return (
    <>
      <PageHead title={t('Users')} sub="Logins, roles and exactly what each person may do. Every action is recorded in the audit log." actions={can('users', 'manage') && <button className="btn primary" onClick={() => setEdit({})}>+ User</button>} />
      <div className="card tablewrap">{!data ? <Loading /> : (
        <table className="t"><thead><tr><th>Name</th><th>Username</th><th>Role</th><th>2FA</th><th>Status</th><th>Since</th><th /></tr></thead>
          <tbody>{data.map((u) => <tr key={u.id}><td><b>{u.name}</b><div className="small muted">{u.email}</div></td><td>{u.username}</td><td><span className="badge gold">{u.role}</span></td><td>{u.totpEnabled ? <span className="badge ok">on</span> : <span className="badge">off</span>}</td><td>{u.active ? <Status s="active" /> : <Status s="disabled" />}{u.lockedUntil && new Date(u.lockedUntil) > new Date() && <span className="badge bad">locked</span>}</td><td>{date(u.createdAt)}</td>
            <td className="right" style={{ whiteSpace: 'nowrap' }}>{u.role !== 'owner' && me.user.role === 'owner' && <button className="btn sm" onClick={() => setPerms(u)}>Permissions</button>} {can('users', 'manage') && u.role !== 'owner' && <button className="btn ghost sm" onClick={() => setEdit(u)}>Edit</button>}</td></tr>)}</tbody></table>
      )}</div>
      {edit && <UserForm u={edit} onClose={() => setEdit(null)} onDone={() => { setEdit(null); reload(); }} />}
      {perms && <PermissionEditor u={perms} onClose={() => setPerms(null)} />}
    </>
  );
}

function UserForm({ u, onClose, onDone }: { u: any; onClose: () => void; onDone: () => void }) {
  const { me } = useSession();
  const { data: branches } = useData<any[]>('/branches');
  const { data: emps } = useData<any[]>('/employees');
  const [f, setF] = useState({ name: u.name || '', username: u.username || '', email: u.email || '', phone: u.phone || '', role: u.role || 'cashier', branchId: u.branchId || '', employeeId: u.employeeId || '', active: u.active !== false, password: '' });
  const { busy, run } = useAction();
  const set = (k: string, v: unknown) => setF({ ...f, [k]: v });
  const roles = ROLES.filter(([r]) => me.user.role === 'owner' || r !== 'admin');
  return (
    <Modal title={u.id ? `Edit ${u.name}` : 'New user'} onClose={onClose} footer={<>
      {u.id && <button className="btn" disabled={busy} onClick={() => { const p = prompt('New temporary password (8+ characters, letters and numbers). They must change it at next login.'); if (p) run(() => api.post(`/users/${u.id}/reset-password`, { password: p, reset2fa: confirm('Also reset their two-factor authentication?') }), 'Password reset, all their sessions signed out'); }}>Reset password</button>}
      {u.id && <button className="btn" disabled={busy} onClick={() => run(() => api.post(`/users/${u.id}/revoke-sessions`), 'Signed out everywhere')}>Sign out everywhere</button>}
      <button className="btn primary" disabled={busy} onClick={() => run(() => (u.id ? api.put(`/users/${u.id}`, f) : api.post('/users', f)), 'Saved').then((r) => r && onDone())}>Save</button>
    </>}>
      <div className="grid g2">
        <Field label="Name"><input value={f.name} onChange={(e) => set('name', e.target.value)} /></Field>
        <Field label="Username"><input value={f.username} onChange={(e) => set('username', e.target.value)} disabled={!!u.id} autoCapitalize="none" /></Field>
        <Field label="Email"><input value={f.email} onChange={(e) => set('email', e.target.value)} /></Field>
        <Field label="Phone"><input value={f.phone} onChange={(e) => set('phone', e.target.value)} /></Field>
        <Field label="Role"><select value={f.role} onChange={(e) => set('role', e.target.value)}>{roles.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
        <Field label="Home branch" hint="Cashiers and staff can only sell at this branch"><select value={f.branchId} onChange={(e) => set('branchId', e.target.value)}><option value="">All / none</option>{branches?.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></Field>
        <Field label="Employee profile" hint="Needed for the staff app: attendance, leave, own sales"><select value={f.employeeId} onChange={(e) => set('employeeId', e.target.value)}><option value="">—</option>{emps?.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></Field>
        {!u.id && <Field label="Temporary password" hint="They choose their own at first login"><input value={f.password} onChange={(e) => set('password', e.target.value)} /></Field>}
        {u.id && <label className="check"><input type="checkbox" checked={f.active} onChange={(e) => set('active', e.target.checked)} /> Active (untick to block the login immediately)</label>}
      </div>
    </Modal>
  );
}

/** The owner's control panel for one user — above all the business manager. */
function PermissionEditor({ u, onClose }: { u: any; onClose: () => void }) {
  const { data: cat } = useData<any>('/permissions/catalogue');
  const { data: cur, reload } = useData<any>(`/users/${u.id}/permissions`);
  const { data: branches } = useData<any[]>('/branches');
  const [draft, setDraft] = useState<Record<string, { levels: string[]; branchIds: string[] } | null> | null>(null);
  const { busy, run } = useAction();
  if (!cat || !cur) return <Modal title="Permissions" onClose={onClose}><Loading /></Modal>;
  const ceiling = cat.ceilings[u.role] || {};
  const state = draft ?? Object.fromEntries(Object.keys(cat.modules).map((m) => {
    const g = cur.grants.find((x: any) => x.module === m);
    return [m, g ? { levels: g.levels, branchIds: g.branch_ids || [] } : null];
  }));
  const effective = (m: string) => state[m]?.levels ?? cat.roleDefaults[u.role]?.[m] ?? [];
  const toggle = (m: string, l: string) => {
    const now = effective(m);
    const next = now.includes(l) ? now.filter((x: string) => x !== l) : [...now, l];
    setDraft({ ...state, [m]: { levels: next, branchIds: state[m]?.branchIds || [] } });
  };
  return (
    <Modal wide title={`Permissions — ${u.name} (${u.role})`} onClose={onClose} footer={<>
      <button className="btn" onClick={() => setDraft(Object.fromEntries(Object.keys(cat.modules).map((m) => [m, null])))}>Reset to role defaults</button>
      <button className="btn primary" disabled={busy || !draft} onClick={() => run(() => api.put(`/users/${u.id}/permissions`, { grants: draft }), 'Permissions saved — they apply immediately').then(() => { setDraft(null); reload(); })}>Save</button>
    </>}>
      {u.role === 'manager' && <div className="alert info" style={{ marginBottom: 10 }}>The business manager signs in to the separate Manager app. Finance (profit, bank and cash balances) is hidden unless you tick it. Managers can never manage users or change business settings, and everything they do is in the audit log.</div>}
      <div className="tablewrap"><table className="t">
        <thead><tr><th>Area</th>{cat.levels.map((l: string) => <th key={l} style={{ textAlign: 'center' }}>{l}</th>)}<th>Branches</th></tr></thead>
        <tbody>{Object.entries(cat.modules).map(([m, label]) => {
          const blocked = ceiling[m] && ceiling[m].length === 0;
          const custom = !!state[m];
          return (
            <tr key={m}>
              <td>{label as string}{custom ? <span className="badge gold" style={{ marginInlineStart: 6 }}>custom</span> : <span className="small muted"> (role default)</span>}{blocked && <div className="small bad">not allowed for this role</div>}</td>
              {cat.levels.map((l: string) => <td key={l} style={{ textAlign: 'center' }}><input type="checkbox" disabled={blocked || (ceiling[m] && !ceiling[m].includes(l))} checked={!blocked && effective(m).includes(l)} onChange={() => toggle(m, l)} aria-label={`${label} ${l}`} /></td>)}
              <td>{custom && (branches?.length || 0) > 1 && <select multiple value={state[m]!.branchIds} onChange={(e) => setDraft({ ...state, [m]: { levels: effective(m), branchIds: [...e.target.selectedOptions].map((o) => o.value) } })} style={{ minWidth: 140 }}>{branches!.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>}</td>
            </tr>
          );
        })}</tbody>
      </table></div>
      <Card><div className="small muted">view = see · create = add new · edit = change · approve = approve refunds, purchase orders, offers, leave · manage = full control incl. stock adjustments and settings of that area · export = download reports. No branch selected = all branches.</div></Card>
    </Modal>
  );
}

