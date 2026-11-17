import { useState, type ComponentType } from 'react';
import { useRoute } from '../core/router';
import { t, useLang } from '../core/i18n';
import { useSession } from '../core/session';
import { api } from '../core/api';
import { Icon } from '../components/Icon';
import { LangPick } from '../components/Auth';
import { useData, Empty } from '../components/ui';
import { MODULES, type ModuleDef } from '../modules/registry';

function Notifications() {
  const [open, setOpen] = useState(false);
  const { data, reload } = useData<any[]>('/notifications');
  const unread = (data || []).filter((n) => !n.read).length;
  return (
    <div style={{ position: 'relative' }}>
      <button className="btn ghost" onClick={() => { setOpen(!open); reload(); }} aria-label={t('Notifications')}>
        <Icon name="bell" />{unread > 0 && <span className="badge bad" style={{ marginInlineStart: -6 }}>{unread}</span>}
      </button>
      {open && (
        <div className="card" style={{ position: 'absolute', insetInlineEnd: 0, top: 44, width: 340, maxHeight: 420, overflowY: 'auto', zIndex: 40, padding: 8 }}>
          {!data?.length && <Empty>No notifications</Empty>}
          {data?.map((n) => (
            <div key={n.id} style={{ padding: '8px 10px', borderBottom: '1px solid #f0ece2', opacity: n.read ? 0.6 : 1, cursor: 'pointer' }}
              onClick={async () => { await api.post(`/notifications/${n.id}/read`); reload(); }}>
              <div style={{ fontWeight: 600 }}>{n.title}</div>
              {n.body && <div className="small muted">{n.body}</div>}
              <div className="small muted">{new Date(n.at).toLocaleString()}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function Shell({ appName, modules = MODULES }: { appName: string; modules?: ModuleDef[] }) {
  useLang();
  const { me, logout, can } = useSession();
  const { route, params } = useRoute();
  const [open, setOpen] = useState(false);
  const visible = modules.filter((m) => !m.need || m.need.some(([mod, lvl]) => can(mod, lvl)));
  const current = visible.find((m) => m.route === route) || visible[0];
  const Page = current?.component as ComponentType<{ params: string[] }> | undefined;
  let section = '';
  return (
    <div className="shell">
      <aside className={'side' + (open ? ' open' : '')} onClick={() => setOpen(false)}>
        <div className="brand">
          <svg width="34" height="34" viewBox="0 0 64 64" aria-hidden="true"><rect x="26" y="8" width="12" height="9" rx="2" fill="#c9a24b" /><rect x="22" y="17" width="20" height="5" rx="1.5" fill="#c9a24b" /><path d="M16 30a8 8 0 0 1 8-8h16a8 8 0 0 1 8 8v20a6 6 0 0 1-6 6H22a6 6 0 0 1-6-6z" fill="none" stroke="#c9a24b" strokeWidth="3" /></svg>
          <div><b>{me.settings.business.name}</b><small>{appName}</small></div>
        </div>
        <nav className="nav">
          {visible.map((m) => {
            const head = m.section !== section ? (section = m.section) : null;
            return (
              <div key={m.route}>
                {head && <div className="sec">{t(head)}</div>}
                <a href={'#/' + m.route} className={current?.route === m.route ? 'on' : ''}><Icon name={m.icon} />{t(m.label)}</a>
              </div>
            );
          })}
        </nav>
      </aside>
      <div className="main">
        <header className="top no-print">
          <button className="btn ghost burger" onClick={() => setOpen(!open)} aria-label="Menu"><Icon name="menu" /></button>
          <div className="grow" style={{ fontWeight: 600 }}>{current && t(current.label)}</div>
          <LangPick />
          <Notifications />
          <a className="btn ghost sm" href="#/account" title="My account"><span className="who">{me.user.name}</span> <span className="badge gold">{me.user.role}</span></a>
          <button className="btn sm" onClick={logout}>{t('Log out')}</button>
        </header>
        {!me.user.totpEnabled && ['owner', 'admin', 'accountant'].includes(me.user.role) && <div className="testbar no-print">Two-factor authentication is off for your account. <a href="#/account">Turn it on</a> — strongly recommended for anyone who can see finances.</div>}
        <main className="page">{Page ? <Page params={params} /> : <Empty>You do not have access to any module. Ask the owner.</Empty>}</main>
      </div>
    </div>
  );
}
