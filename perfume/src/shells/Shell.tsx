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

// Clickable table rows: reachable with Tab and opened with Enter, like links.
if (typeof window !== 'undefined') {
  new MutationObserver(() => document.querySelectorAll<HTMLElement>('tr.click:not([tabindex])').forEach((tr) => { tr.tabIndex = 0; tr.setAttribute('role', 'link'); }))
    .observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener('keydown', (e) => { const t = e.target as HTMLElement; if (e.key === 'Enter' && t?.matches?.('tr.click')) t.click(); });
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
      <a className="skip" href="#main" onClick={(e) => { e.preventDefault(); document.getElementById('main')?.focus(); }}>Skip to content</a>
      <aside className={'side' + (open ? ' open' : '')} onClick={() => setOpen(false)} aria-label="Main menu">
        <div className="brand">
          <img src="/brand/mark.png" alt="" width="40" height="40" />
          <div><b>{me.settings.business.name}</b><small>{appName}</small></div>
        </div>
        <nav className="nav" aria-label="Modules">
          {visible.map((m) => {
            const head = m.section !== section ? (section = m.section) : null;
            return (
              <div key={m.route}>
                {head && <div className="sec">{t(head)}</div>}
                <a href={'#/' + m.route} className={current?.route === m.route ? 'on' : ''} aria-current={current?.route === m.route ? 'page' : undefined}><Icon name={m.icon} />{t(m.label)}</a>
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
        <main className="page" id="main" tabIndex={-1} style={{ outline: 'none' }}>{Page ? <Page params={params} /> : <Empty>You do not have access to any module. Ask the owner.</Empty>}</main>
      </div>
    </div>
  );
}
