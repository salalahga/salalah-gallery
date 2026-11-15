import { useEffect, useState } from 'react';
import { Menu, Moon, Sun, Languages, Plus, Search } from 'lucide-react';
import { modules } from './modules/registry';
import { useRoute, go } from './core/router';
import { store, useSettings } from './core/store';
import { useT } from './core/i18n';
import { Toaster } from './components/ui';

export default function App() {
  const { page } = useRoute();
  const s = useSettings();
  const t = useT();
  const [open, setOpen] = useState(false);
  const [dark, setDark] = useState(() => { try { return localStorage.getItem('ww-theme') === 'dark'; } catch { return false; } });
  const [palette, setPalette] = useState(false);
  const [q, setQ] = useState('');

  useEffect(() => { document.documentElement.dataset.theme = dark ? 'dark' : 'light'; try { localStorage.setItem('ww-theme', dark ? 'dark' : 'light'); } catch { /* */ } }, [dark]);
  useEffect(() => { document.documentElement.lang = s.lang; }, [s.lang]);
  useEffect(() => { setOpen(false); window.scrollTo(0, 0); }, [page]);
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setPalette(true); } };
    window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h);
  }, []);

  const mod = modules.find((m) => m.id === page) || modules[0];
  const Page = mod.component;
  const groups = [...new Set(modules.map((m) => m.group))];
  const quick = [
    { label: t('New job'), go: () => go('jobs', { new: '1' }) },
    { label: t('New quotation'), go: () => go('quotations', { new: '1' }) },
    { label: t('New sale'), go: () => go('sales', { new: '1' }) },
    { label: t('Add expense'), go: () => go('accounts', { new: 'expense' }) },
  ];
  const results = modules.filter((m) => (m.label + ' ' + t(m.label) + ' ' + m.desc).toLowerCase().includes(q.toLowerCase()));

  return (
    <div className={`shell ${open ? 'nav-open' : ''}`}>
      <aside className="sidebar">
        <div className="brand" onClick={() => go('dashboard')}>
          <div className="logo">{s.logo ? <img src={s.logo} alt="" /> : <svg viewBox="0 0 64 64"><path d="M14 44 L32 14 L50 44 Z" fill="none" stroke="currentColor" strokeWidth="6" strokeLinejoin="round" /><path d="M22 44h20" stroke="#e0a458" strokeWidth="6" strokeLinecap="round" /></svg>}</div>
          <div><b>{s.businessName}</b><small>Workshop Manager</small></div>
        </div>
        <nav>
          {groups.map((g) => (
            <div key={g} className="nav-group">
              <div className="nav-label">{t(g)}</div>
              {modules.filter((m) => m.group === g).map((m) => (
                <a key={m.id} href={`#/${m.id}`} className={m.id === mod.id ? 'active' : ''}><m.icon size={18} /><span>{t(m.label)}</span></a>
              ))}
            </div>
          ))}
        </nav>
        <div className="side-foot">v1.0 · data saved on this device</div>
      </aside>
      <div className="scrim" onClick={() => setOpen(false)} />
      <main>
        <header className="topbar">
          <button className="icon-btn mobile-only" onClick={() => setOpen(true)} aria-label="Menu"><Menu size={20} /></button>
          <button className="cmd" onClick={() => setPalette(true)}><Search size={16} /><span>Search modules…</span><kbd>Ctrl K</kbd></button>
          <div className="top-actions">
            <div className="quick">
              <button className="btn primary sm"><Plus size={16} /><span className="hide-sm">Quick add</span></button>
              <div className="quick-menu">{quick.map((x) => <button key={x.label} onClick={x.go}>{x.label}</button>)}</div>
            </div>
            <button className="icon-btn" title="Malayalam / English" onClick={() => store.setSettings({ lang: s.lang === 'en' ? 'ml' : 'en' })}><Languages size={18} /><small>{s.lang === 'en' ? 'മ' : 'EN'}</small></button>
            <button className="icon-btn" title="Theme" onClick={() => setDark(!dark)}>{dark ? <Sun size={18} /> : <Moon size={18} />}</button>
          </div>
        </header>
        <div className="content"><Page key={mod.id} /></div>
      </main>
      {palette && (
        <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && setPalette(false)}>
          <div className="palette">
            <input autoFocus placeholder="Go to… (jobs, payroll, website)" value={q} onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Escape') setPalette(false); if (e.key === 'Enter' && results[0]) { go(results[0].id); setPalette(false); setQ(''); } }} />
            <ul>{results.map((m) => <li key={m.id} onClick={() => { go(m.id); setPalette(false); setQ(''); }}><m.icon size={18} /><div><b>{t(m.label)}</b><small>{m.desc}</small></div></li>)}</ul>
          </div>
        </div>
      )}
      <Toaster />
    </div>
  );
}
