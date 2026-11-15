import { useEffect, useState } from 'react';
import { Plus, Trash2, ShieldCheck, UserCog, HardHat } from 'lucide-react';
import { api } from '../core/api';
import { store, useDB } from '../core/store';
import { useUser, type Role, type User } from '../core/session';
import { Modal, Field, Badge, Avatar, Empty, toast, confirmDelete } from '../components/ui';

const ROLES: { id: Role; label: string; icon: typeof ShieldCheck; desc: string }[] = [
  { id: 'admin', label: 'Owner', icon: ShieldCheck, desc: 'Everything, including payroll, settings, website and user logins.' },
  { id: 'manager', label: 'Manager', icon: UserCog, desc: 'Jobs, tasks, customers, quotations, invoices, sales, accounts, stock, staff & attendance. No payroll or settings.' },
  { id: 'staff', label: 'Staff', icon: HardHat, desc: 'Sees jobs and their own tasks; can update task status. No prices, salaries or customer contacts.' },
];

type Edit = Partial<User> & { password?: string };

export default function Users() {
  const db = useDB(); const me = useUser();
  const [users, setUsers] = useState<User[] | null>(null);
  const [edit, setEdit] = useState<Edit | null>(null);
  const load = () => api<{ users: User[] }>('/api/users').then((r) => setUsers(r.users), (e) => toast(e.message));
  useEffect(() => { if (store.mode === 'server') void load(); }, []);

  if (store.mode !== 'server') return (
    <div className="card"><Empty title="Logins need the online server"
      hint="This copy of the app is running on this device only. Start it with the server (npm start) or use the online version — the setup screen will ask you to create the owner account." /></div>
  );

  const save = async () => {
    if (!edit) return;
    try {
      if (edit.id) await api(`/api/users/${edit.id}`, { method: 'PUT', body: { name: edit.name, role: edit.role, staffId: edit.staffId || null, active: edit.active, password: edit.password || undefined } });
      else await api('/api/users', { method: 'POST', body: edit });
      toast('User saved'); setEdit(null); void load();
    } catch (e) { toast((e as Error).message); }
  };
  const remove = async (u: User) => {
    if (!confirmDelete(`login for ${u.name}`)) return;
    try { await api(`/api/users/${u.id}`, { method: 'DELETE' }); void load(); } catch (e) { toast((e as Error).message); }
  };
  const staffName = (id?: string) => db.staff.find((x) => x.id === id)?.name;

  return (
    <>
      <div className="grid g3 mb">{ROLES.map((r) => <div key={r.id} className="integ"><r.icon size={20} color="var(--wood)" /><div><b>{r.label}</b><span className="muted">{r.desc}</span></div></div>)}</div>
      <div className="card">
        <h3>Logins <button className="btn sm primary" onClick={() => setEdit({ role: 'staff', active: true })}><Plus size={14} />Add login</button></h3>
        {users === null ? <p className="muted">Loading…</p> : <div className="table-wrap"><table>
          <thead><tr><th>Name</th><th>Username</th><th>Role</th><th>Staff profile</th><th>Status</th><th /></tr></thead>
          <tbody>{users.map((u) => <tr key={u.id} className="click" onClick={() => setEdit({ ...u })}>
            <td><div className="flex"><Avatar name={u.name} size={30} /><b>{u.name}</b>{u.id === me?.id && <Badge>you</Badge>}</div></td>
            <td>{u.username}</td><td><Badge tone={u.role === 'admin' ? 'amber' : u.role === 'manager' ? 'blue' : 'gray'}>{ROLES.find((r) => r.id === u.role)?.label}</Badge></td>
            <td>{staffName(u.staffId) || <span className="muted">—</span>}</td>
            <td>{u.active ? <Badge tone="green">Active</Badge> : <Badge tone="red">Disabled</Badge>}</td>
            <td onClick={(e) => e.stopPropagation()}>{u.id !== me?.id && <button className="icon-btn" onClick={() => remove(u)}><Trash2 size={15} /></button>}</td>
          </tr>)}</tbody></table></div>}
      </div>
      {edit && <Modal open title={edit.id ? `Edit login — ${edit.name}` : 'New login'} onClose={() => setEdit(null)} footer={<><button className="btn" onClick={() => setEdit(null)}>Cancel</button><button className="btn primary" onClick={save}>Save</button></>}>
        <div className="form two">
          <Field label="Name"><input autoFocus value={edit.name || ''} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
          <Field label="Username"><input disabled={!!edit.id} autoCapitalize="none" value={edit.username || ''} onChange={(e) => setEdit({ ...edit, username: e.target.value })} /></Field>
          <Field label={edit.id ? 'New password (leave empty to keep)' : 'Password (min 6)'}><input type="password" autoComplete="new-password" value={edit.password || ''} onChange={(e) => setEdit({ ...edit, password: e.target.value })} /></Field>
          <Field label="Role"><select disabled={edit.id === me?.id} value={edit.role} onChange={(e) => setEdit({ ...edit, role: e.target.value as Role })}>{ROLES.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}</select></Field>
          <Field label="Linked staff profile"><select value={edit.staffId || ''} onChange={(e) => {
            const st = db.staff.find((x) => x.id === e.target.value);
            setEdit({ ...edit, staffId: e.target.value, name: edit.name || st?.name, username: edit.username || st?.name.split(' ')[0].toLowerCase() });
          }}><option value="">— none —</option>{db.staff.map((x) => <option key={x.id} value={x.id}>{x.name} · {x.role}</option>)}</select></Field>
          {edit.id && <Field label="Status"><select disabled={edit.id === me?.id} value={edit.active ? '1' : '0'} onChange={(e) => setEdit({ ...edit, active: e.target.value === '1' })}><option value="1">Active</option><option value="0">Disabled</option></select></Field>}
          <p className="span-3 muted">{ROLES.find((r) => r.id === edit.role)?.desc}{edit.role === 'staff' && ' Link a staff profile so they see the tasks assigned to them.'}</p>
        </div>
      </Modal>}
    </>
  );
}
