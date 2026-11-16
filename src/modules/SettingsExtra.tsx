import { useCallback, useEffect, useState } from 'react';
import { CloudDownload, RefreshCw, ShieldCheck } from 'lucide-react';
import { api } from '../core/api';
import { store } from '../core/store';
import { Badge, Empty, toast } from '../components/ui';

type BackupCfg = { enabled?: boolean; telegram?: boolean; email?: boolean; keep?: number };

/** Daily automatic backup on the server, optionally sent to Telegram / email. */
export function AutoBackup() {
  const [cfg, setCfg] = useState<BackupCfg>({}); const [list, setList] = useState<{ date: string; size: number }[]>([]);
  const [busy, setBusy] = useState(false); const [loaded, setLoaded] = useState(false);
  const load = useCallback(async () => {
    try {
      const [p, b] = await Promise.all([api<{ config: Record<string, BackupCfg> }>('/api/plugins'), api<{ backups: { date: string; size: number }[] }>('/api/backups')]);
      setCfg(p.config.backup || {}); setList(b.backups); setLoaded(true);
    } catch (e) { toast((e as Error).message); }
  }, []);
  useEffect(() => { if (store.mode === 'server') void load(); }, [load]);
  if (store.mode !== 'server') return <div className="card"><h3>Automatic backup</h3><p className="muted">Available when the app runs with the online database.</p></div>;
  const save = async (patch: BackupCfg) => {
    const next = { ...cfg, ...patch }; setCfg(next);
    try { await api('/api/plugins/backup', { method: 'PUT', body: next }); toast('Backup settings saved'); } catch (e) { toast((e as Error).message); }
  };
  const runNow = async () => {
    setBusy(true);
    try {
      const r = await api<{ records: number; sent: string[]; errors: string[] }>('/api/backups/run', { method: 'POST' });
      toast(`Backup made (${r.records} records)${r.sent.length ? ' · sent to ' + r.sent.join(' & ') : ''}${r.errors.length ? ' · ' + r.errors.join('; ') : ''}`);
      await load();
    } catch (e) { toast((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <div className="card span-all">
      <h3><span className="flex"><ShieldCheck size={17} />Automatic daily backup</span>{cfg.enabled ? <Badge tone="green">On</Badge> : <Badge>Off</Badge>}</h3>
      <p className="muted" style={{ marginTop: 0 }}>Every morning (at the daily summary time) a compressed copy of all your data is kept on the server and can be sent to you, so nothing is lost even if the hosting has a problem. Photos are stored separately and are not inside the backup.</p>
      {loaded && <div className="flex wrap" style={{ gap: 16, marginBottom: 12 }}>
        <label className="flex"><input type="checkbox" checked={!!cfg.enabled} onChange={(e) => save({ enabled: e.target.checked })} />Back up every day</label>
        <label className="flex"><input type="checkbox" checked={!!cfg.telegram} disabled={!cfg.enabled} onChange={(e) => save({ telegram: e.target.checked })} />Send to my Telegram</label>
        <label className="flex"><input type="checkbox" checked={!!cfg.email} disabled={!cfg.enabled} onChange={(e) => save({ email: e.target.checked })} />Send by email</label>
        <label className="flex">Keep last <input type="number" min={1} max={60} style={{ width: 70 }} value={cfg.keep || 7} onChange={(e) => setCfg({ ...cfg, keep: +e.target.value })} onBlur={() => save({})} /> days</label>
        <button className="btn sm" disabled={busy} onClick={runNow}><RefreshCw size={14} className={busy ? 'spin' : ''} />Back up now</button>
      </div>}
      {(cfg.telegram || cfg.email) && <p className="muted">Telegram and email must be set up in <a className="link" href="#/plugins">Plugins</a>.</p>}
      {list.length ? <ul className="list">{list.map((b) => <li key={b.date}><div className="grow"><div className="title">{b.date}</div><div className="muted">{(b.size / 1024).toFixed(1)} KB compressed</div></div>
        <a className="btn sm" href={`/api/backups/${b.date}`} download><CloudDownload size={14} />Download</a></li>)}</ul> : loaded && <Empty title="No server backups yet" hint="Press Back up now, or switch on daily backup." />}
    </div>
  );
}

type Row = { id: string; at: number; user?: string; col: string; recId?: string; action: string; label?: string };
const ACTION_TONE: Record<string, string> = { create: 'green', update: 'blue', delete: 'red', login: 'gray', restore: 'amber', backup: 'gray', setup: 'green' };
const COL_LABEL: Record<string, string> = { txns: 'Accounts', jobs: 'Projects', creditNotes: 'Credit notes', socialPosts: 'Social posts', socialAccounts: 'Social accounts' };

/** Who changed what — from the server's activity log. */
export function ActivityLog() {
  const [rows, setRows] = useState<Row[]>([]); const [col, setCol] = useState(''); const [loading, setLoading] = useState(false);
  const load = useCallback(async (more = false) => {
    setLoading(true);
    try {
      const before = more && rows.length ? `&before=${rows[rows.length - 1].at}` : '';
      const r = await api<{ log: Row[] }>(`/api/audit?limit=150${col ? '&col=' + col : ''}${before}`);
      setRows(more ? [...rows, ...r.log] : r.log);
    } catch (e) { toast((e as Error).message); } finally { setLoading(false); }
  }, [col, rows]);
  useEffect(() => { if (store.mode === 'server') void load(); }, [col]); // eslint-disable-line react-hooks/exhaustive-deps
  if (store.mode !== 'server') return <div className="card"><Empty title="Activity log needs the online database" /></div>;
  const cols = ['', 'invoices', 'receipts', 'txns', 'jobs', 'quotations', 'payslips', 'items', 'customers', 'staff', 'users', 'settings', 'system'];
  return (
    <div className="card">
      <h3>Activity log <span className="flex"><select style={{ width: 'auto' }} value={col} onChange={(e) => setCol(e.target.value)}>{cols.map((c) => <option key={c} value={c}>{c ? COL_LABEL[c] || c[0].toUpperCase() + c.slice(1) : 'Everything'}</option>)}</select>
        <button className="icon-btn" title="Refresh" onClick={() => load()}><RefreshCw size={15} /></button></span></h3>
      {rows.length ? <div className="table-wrap"><table>
        <thead><tr><th>When</th><th>Who</th><th>What</th><th>Record</th></tr></thead>
        <tbody>{rows.map((r) => <tr key={r.id}>
          <td>{new Date(r.at).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</td>
          <td>{r.user || '—'}</td>
          <td><Badge tone={ACTION_TONE[r.action] || 'gray'}>{r.action}</Badge> <span className="muted">{COL_LABEL[r.col] || r.col}</span></td>
          <td>{r.label || r.recId || ''}</td></tr>)}</tbody></table></div> : <Empty title={loading ? 'Loading…' : 'Nothing recorded yet'} />}
      {rows.length >= 150 && <button className="btn sm" style={{ marginTop: 10 }} disabled={loading} onClick={() => load(true)}>Older</button>}
    </div>
  );
}
