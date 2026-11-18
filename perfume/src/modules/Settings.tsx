import { useState } from 'react';
import { api } from '../core/api';
import { t } from '../core/i18n';
import { money, parseMoney, useSession } from '../core/session';
import { Card, Field, Loading, PageHead, Tabs, useAction, useData } from '../components/ui';

type Tab = 'business' | 'tax' | 'pos' | 'branches' | 'security' | 'integrations';

export default function Settings() {
  const { me } = useSession();
  const [tab, setTab] = useState<Tab>('business');
  const { data: s, reload } = useData<any>('/settings');
  const tabs: [Tab, string][] = [['business', 'Business'], ['tax', 'Tax & currency'], ['pos', 'POS, loyalty & purchasing'], ['branches', 'Branches & tills'], ['integrations', t('Integrations')]];
  if (me.user.role === 'owner') tabs.push(['security', 'Security']);
  return (
    <>
      <PageHead title={t('Settings')} />
      <Tabs tabs={tabs} value={tab} onChange={setTab} />
      {!s ? <Loading /> : <>
        {tab === 'business' && <Section k="business" s={s} reload={reload} fields={[['name', 'Business name'], ['nameAr', 'Business name (Arabic)'], ['address', 'Address'], ['phone', 'Phone'], ['email', 'Email'], ['vatNumber', 'VAT registration number (VATIN)'], ['crNumber', 'Commercial registration (CR)'], ['receiptFooter', 'Receipt footer'], ['receiptFooterAr', 'Receipt footer (Arabic)']]} />}
        {tab === 'tax' && <Tax s={s} reload={reload} />}
        {tab === 'pos' && <PosSettings s={s} reload={reload} />}
        {tab === 'branches' && <Branches />}
        {tab === 'security' && <Security s={s} reload={reload} />}
        {tab === 'integrations' && <Integrations />}
      </>}
    </>
  );
}

function Section({ k, s, reload, fields }: { k: string; s: any; reload: () => void; fields: [string, string][] }) {
  const [f, setF] = useState<any>(s[k]);
  const { busy, run } = useAction();
  return (
    <Card>
      <div className="grid g2">{fields.map(([key, label]) => <Field key={key} label={label}><input value={f[key] ?? ''} onChange={(e) => setF({ ...f, [key]: e.target.value })} dir={key.endsWith('Ar') ? 'rtl' : undefined} /></Field>)}</div>
      <button className="btn primary" style={{ marginTop: 12 }} disabled={busy} onClick={() => run(() => api.put(`/settings/${k}`, f), 'Saved').then(reload)}>Save</button>
    </Card>
  );
}

function Tax({ s, reload }: { s: any; reload: () => void }) {
  const [tax, setTax] = useState(s.tax);
  const [fx, setFx] = useState<Record<string, number>>(s.fx);
  const { busy, run } = useAction();
  return (
    <div className="grid g2">
      <Card title="VAT">
        <div className="col">
          <label className="check"><input type="checkbox" checked={tax.registered} onChange={(e) => setTax({ ...tax, registered: e.target.checked })} /> VAT registered (charge VAT on sales)</label>
          <Field label="Standard VAT rate (%)" hint="Oman's standard rate has been 5 % since April 2021. Check the Tax Authority for current rules and zero-rated items."><input value={tax.defaultRateBp / 100} onChange={(e) => setTax({ ...tax, defaultRateBp: Math.round(Number(e.target.value) * 100) || 0 })} /></Field>
          <label className="check"><input type="checkbox" checked={tax.pricesIncludeVat} onChange={(e) => setTax({ ...tax, pricesIncludeVat: e.target.checked })} /> Shelf prices include VAT</label>
          <button className="btn primary" disabled={busy} onClick={() => run(() => api.put('/settings/tax', tax), 'Saved').then(reload)}>Save</button>
        </div>
      </Card>
      <Card title="Currencies">
        <div className="small muted" style={{ marginBottom: 8 }}>The books are kept in Omani Rial (OMR, 3 decimals). Rates convert foreign purchase orders — OMR per 1 unit.</div>
        <div className="grid g2">{Object.entries(fx).map(([c, v]) => <Field key={c} label={c}><input value={v} onChange={(e) => setFx({ ...fx, [c]: Number(e.target.value) })} /></Field>)}</div>
        <button className="btn primary" style={{ marginTop: 10 }} disabled={busy} onClick={() => run(() => api.put('/settings/fx', fx), 'Saved').then(reload)}>Save rates</button>
      </Card>
    </div>
  );
}

function PosSettings({ s, reload }: { s: any; reload: () => void }) {
  const [pos, setPos] = useState(s.pos);
  const [loy, setLoy] = useState({ ...s.loyalty, vipThresholdStr: money(s.loyalty.vipThreshold) });
  const [pur, setPur] = useState({ ...s.purchases, autoStr: money(s.purchases.autoApproveBelow) });
  const [dl, setDl] = useState(money(s.delivery.defaultFee));
  const { busy, run } = useAction();
  return (
    <div className="grid g2">
      <Card title="Point of sale">
        <div className="col">
          <Field label="Max manual discount without approval (%)"><input value={pos.maxManualDiscountPct} onChange={(e) => setPos({ ...pos, maxManualDiscountPct: Number(e.target.value) })} /></Field>
          <label className="check"><input type="checkbox" checked={pos.allowNegativeStock} onChange={(e) => setPos({ ...pos, allowNegativeStock: e.target.checked })} /> Allow selling more than the stock shown (not recommended)</label>
          <Field label="Default delivery fee (OMR)"><input value={dl} onChange={(e) => setDl(e.target.value)} /></Field>
          <button className="btn primary" disabled={busy} onClick={() => run(async () => { await api.put('/settings/pos', pos); await api.put('/settings/delivery', { defaultFee: parseMoney(dl) }); }, 'Saved').then(reload)}>Save</button>
        </div>
      </Card>
      <Card title="Loyalty & VIP">
        <div className="col">
          <label className="check"><input type="checkbox" checked={loy.enabled} onChange={(e) => setLoy({ ...loy, enabled: e.target.checked })} /> Loyalty programme on</label>
          <Field label="Points earned per 1 OMR spent"><input value={loy.pointsPerOmr} onChange={(e) => setLoy({ ...loy, pointsPerOmr: Number(e.target.value) })} /></Field>
          <Field label="Value of 1 point (baisa)" hint="10 baisa → 100 points = 1 OMR"><input value={loy.pointValueBaisa} onChange={(e) => setLoy({ ...loy, pointValueBaisa: Number(e.target.value) })} /></Field>
          <Field label="Customers become VIP after spending (OMR)"><input value={loy.vipThresholdStr} onChange={(e) => setLoy({ ...loy, vipThresholdStr: e.target.value })} /></Field>
          <button className="btn primary" disabled={busy} onClick={() => run(() => api.put('/settings/loyalty', { enabled: loy.enabled, pointsPerOmr: loy.pointsPerOmr, pointValueBaisa: loy.pointValueBaisa, vipThreshold: parseMoney(loy.vipThresholdStr) }), 'Saved').then(reload)}>Save</button>
        </div>
      </Card>
      <Card title="Purchase approval">
        <div className="col">
          <Field label="Auto-approve purchase orders below (OMR, 0 = always need approval)"><input value={pur.autoStr} onChange={(e) => setPur({ ...pur, autoStr: e.target.value })} /></Field>
          <label className="check"><input type="checkbox" checked={pur.approverMustDiffer} onChange={(e) => setPur({ ...pur, approverMustDiffer: e.target.checked })} /> The approver must be someone other than the creator (owner excepted)</label>
          <button className="btn primary" disabled={busy} onClick={() => run(() => api.put('/settings/purchases', { autoApproveBelow: parseMoney(pur.autoStr), approverMustDiffer: pur.approverMustDiffer }), 'Saved').then(reload)}>Save</button>
        </div>
      </Card>
    </div>
  );
}

function Branches() {
  const { can } = useSession();
  const { data, reload } = useData<any[]>('/branches');
  const { data: regs, reload: rr } = useData<any[]>('/registers');
  const [f, setF] = useState({ code: '', name: '', nameAr: '', address: '', phone: '' });
  const { busy, run } = useAction();
  return (
    <div className="grid g2">
      <Card title="Branches">
        <table className="t"><tbody>{data?.map((b) => <tr key={b.id}><td><b>{b.name}</b> <span className="small muted">{b.code}</span><div className="small muted">{b.address}</div></td><td className="small">{regs?.filter((r) => r.branch_id === b.id).map((r) => r.name).join(', ')}</td></tr>)}</tbody></table>
      </Card>
      {can('branches', 'manage') && <Card title="Add a branch">
        <div className="grid g2">{(['code', 'name', 'nameAr', 'address', 'phone'] as const).map((k) => <Field key={k} label={k === 'nameAr' ? 'Name (Arabic)' : k[0].toUpperCase() + k.slice(1)}><input value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></Field>)}</div>
        <button className="btn primary" style={{ marginTop: 10 }} disabled={busy || !f.code || !f.name} onClick={() => run(() => api.post('/branches', f), 'Branch added with one till').then(() => { setF({ code: '', name: '', nameAr: '', address: '', phone: '' }); reload(); rr(); })}>Add branch</button>
      </Card>}
    </div>
  );
}

function Security({ s, reload }: { s: any; reload: () => void }) {
  const [sec, setSec] = useState(s.security);
  const { busy, run } = useAction();
  const roles = ['owner', 'admin', 'manager', 'accountant', 'hr', 'cashier', 'staff', 'marketing'];
  return (
    <Card title="Security (owner only)">
      <div className="col">
        <Field label="Require two-factor authentication for"><div className="pill-group">{roles.map((r) => <button key={r} className={sec.require2faRoles.includes(r) ? 'on' : ''} onClick={() => setSec({ ...sec, require2faRoles: sec.require2faRoles.includes(r) ? sec.require2faRoles.filter((x: string) => x !== r) : [...sec.require2faRoles, r] })}>{r}</button>)}</div></Field>
        <Field label="Sign out after (hours)"><input value={sec.sessionHours} onChange={(e) => setSec({ ...sec, sessionHours: Number(e.target.value) || 12 })} style={{ maxWidth: 120 }} /></Field>
        <div className="small muted">Passwords are hashed (scrypt), sessions are server-side and can be revoked, 5 wrong passwords lock an account for 15 minutes, 2FA secrets, IBANs and ID numbers are encrypted at rest, and card numbers are never stored.</div>
        <button className="btn primary" disabled={busy} onClick={() => run(() => api.put('/settings/security', sec), 'Saved').then(reload)}>Save</button>
      </div>
    </Card>
  );
}

function Integrations() {
  const { data } = useData<any[]>('/integrations');
  return (
    <div className="grid g2">{data?.map((i) => (
      <Card key={i.key} title={i.name} actions={i.connected ? <span className="badge warn">credentials present — not yet verified end-to-end</span> : <span className="badge">not connected</span>}>
        <div>{i.status}</div>
        <div className="small muted" style={{ marginTop: 6 }}>Needs: {i.needs.join(', ')}</div>
      </Card>
    ))}</div>
  );
}
