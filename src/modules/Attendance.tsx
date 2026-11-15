import { useState } from 'react';
import { ChevronLeft, ChevronRight, CheckCheck } from 'lucide-react';
import { store, useDB, today } from '../core/store';
import type { AttendanceMark } from '../core/types';
import { daysInMonth, monthLabel } from '../core/calc';
import { PageHeader, Badge, Empty, toast } from '../components/ui';
import { useT } from '../core/i18n';

const CYCLE: (AttendanceMark | '')[] = ['', 'P', 'A', 'H', 'L'];

export default function AttendancePage() {
  const db = useDB(); const t = useT();
  const [month, setMonth] = useState(today().slice(0, 7));
  const shift = (n: number) => { const d = new Date(month + '-01T00:00:00'); d.setMonth(d.getMonth() + n); setMonth(d.toISOString().slice(0, 7)); };
  const staff = db.staff.filter((x) => x.active);
  const days = Array.from({ length: daysInMonth(month) }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`);
  const rec = (sid: string, d: string) => db.attendance.find((a) => a.staffId === sid && a.date === d);
  const toggle = (sid: string, d: string) => {
    const r = rec(sid, d); const next = CYCLE[(CYCLE.indexOf(r?.mark || '') + 1) % CYCLE.length];
    if (!next) { if (r) store.remove('attendance', r.id); return; }
    store.upsert('attendance', r ? { ...r, mark: next } : { staffId: sid, date: d, mark: next, overtime: 0 });
  };
  const setOT = (sid: string, d: string, ot: number) => { const r = rec(sid, d); store.upsert('attendance', r ? { ...r, overtime: ot } : { staffId: sid, date: d, mark: 'P', overtime: ot }); };
  const markAllToday = () => { const d = today(); staff.forEach((p) => { if (!rec(p.id, d)) store.upsert('attendance', { staffId: p.id, date: d, mark: 'P', overtime: 0 }); }); toast('Everyone marked present today'); };
  const [otDay, setOtDay] = useState(today());

  return (
    <>
      <PageHeader title={t('Attendance')} sub="Tap a cell to cycle: P present · A absent · H half day · L paid leave"
        actions={<><div className="flex"><button className="icon-btn" onClick={() => shift(-1)}><ChevronLeft size={18} /></button><b style={{ minWidth: 90, textAlign: 'center' }}>{monthLabel(month)}</b><button className="icon-btn" onClick={() => shift(1)}><ChevronRight size={18} /></button></div>
          <button className="btn primary" onClick={markAllToday}><CheckCheck size={16} />Mark all present today</button></>} />
      <div className="card mb">
        {staff.length ? <div className="table-wrap"><table className="att-grid">
          <thead><tr><th>Staff</th>{days.map((d) => <th key={d} className={new Date(d).getDay() === 5 ? 'weekend' : ''}>{+d.slice(8)}</th>)}<th>P</th><th>A</th><th>OT h</th></tr></thead>
          <tbody>{staff.map((p) => { const recs = db.attendance.filter((a) => a.staffId === p.id && a.date.startsWith(month)); return (
            <tr key={p.id}><td><b>{p.name}</b><div className="muted">{p.role}</div></td>
              {days.map((d) => { const r = rec(p.id, d); return <td key={d} className={new Date(d).getDay() === 5 ? 'weekend' : ''}><button className={`att-cell att-${r?.mark || ''}`} onClick={() => toggle(p.id, d)} title={r?.overtime ? `${r.overtime}h OT` : ''}>{r?.mark || ''}</button></td>; })}
              <td><b>{recs.filter((a) => a.mark === 'P').length + recs.filter((a) => a.mark === 'H').length / 2}</b></td><td>{recs.filter((a) => a.mark === 'A').length}</td><td>{recs.reduce((n, a) => n + (a.overtime || 0), 0)}</td>
            </tr>); })}</tbody></table></div> : <Empty title="Add staff first" />}
      </div>
      <div className="card">
        <h3>Overtime entry <input type="date" value={otDay} onChange={(e) => setOtDay(e.target.value)} style={{ width: 'auto' }} /></h3>
        <ul className="list">{staff.map((p) => { const r = rec(p.id, otDay); return (
          <li key={p.id}><div className="grow title">{p.name}</div>{r ? <Badge tone={r.mark === 'P' ? 'green' : r.mark === 'A' ? 'red' : 'amber'}>{r.mark}</Badge> : <Badge>not marked</Badge>}
            <input type="number" min={0} step={0.5} style={{ width: 100 }} value={r?.overtime || 0} onChange={(e) => setOT(p.id, otDay, +e.target.value)} /><span className="muted">hours</span></li>); })}</ul>
      </div>
    </>
  );
}
