import { useMemo, useState } from 'react';
import { Download, Monitor, Smartphone, Tablet, Plus, Trash2, Rocket } from 'lucide-react';
import { store, useDB } from '../core/store';
import { buildSite, THEMES } from '../core/site';
import { PageHeader, Field, toast } from '../components/ui';
import { useT } from '../core/i18n';

export default function Website() {
  const db = useDB(); const s = db.settings; const w = s.website; const t = useT();
  const [device, setDevice] = useState<'100%' | '768px' | '390px'>('100%');
  const html = useMemo(() => buildSite(db), [db]);
  const setW = (p: Partial<typeof w>) => store.setSettings({ website: { ...w, ...p } });
  const download = () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([html], { type: 'text/html' })); a.download = 'index.html'; a.click(); toast('Website downloaded — upload index.html to any host'); };
  return (
    <>
      <PageHeader title={t('Website')} sub="Your business website is built automatically from your profile, services and products."
        actions={<><button className="btn" onClick={() => { const win = window.open(); win?.document.write(html); win?.document.close(); }}><Monitor size={16} />Open full page</button><button className="btn primary" onClick={download}><Download size={16} />Download website</button></>} />
      <div className="grid site-grid">
        <div className="card">
          <h3>Design</h3>
          <div className="form" style={{ gridTemplateColumns: '1fr' }}>
            <Field label="Theme"><div className="chips">{Object.entries(THEMES).map(([k, v]) => <button key={k} className={`chip ${w.theme === k ? 'on' : ''}`} onClick={() => setW({ theme: k })}><span className="dot" style={{ background: v.accent, marginRight: 6 }} />{v.name}</button>)}</div></Field>
            <Field label="Headline (tagline)"><input value={s.tagline} onChange={(e) => store.setSettings({ tagline: e.target.value })} /></Field>
            <Field label="Hero text"><textarea value={w.hero} onChange={(e) => setW({ hero: e.target.value })} /></Field>
            <Field label="About us"><textarea value={w.about} onChange={(e) => setW({ about: e.target.value })} /></Field>
            <Field label="Gallery images (URLs)">
              {w.gallery.map((g, i) => <div key={i} className="flex" style={{ marginBottom: 6 }}><input value={g} onChange={(e) => setW({ gallery: w.gallery.map((x, k) => (k === i ? e.target.value : x)) })} /><button className="icon-btn" onClick={() => setW({ gallery: w.gallery.filter((_, k) => k !== i) })}><Trash2 size={15} /></button></div>)}
              <button className="btn sm" onClick={() => setW({ gallery: [...w.gallery, ''] })}><Plus size={14} />Add image</button>
            </Field>
            <Field label="Show products shop"><select value={w.showProducts ? '1' : '0'} onChange={(e) => setW({ showProducts: e.target.value === '1' })}><option value="1">Yes</option><option value="0">No</option></select></Field>
            <Field label="Google Maps embed URL"><input value={w.mapUrl} onChange={(e) => setW({ mapUrl: e.target.value })} placeholder="https://www.google.com/maps/embed?pb=…" /></Field>
            <p className="muted">Services come from Settings → Work types. Products marked “Show on website” in Inventory appear in the shop. Contact details come from Settings.</p>
          </div>
          <div className="section-title" style={{ marginTop: 16 }}>Publish</div>
          <p className="muted"><Rocket size={14} style={{ verticalAlign: -2 }} /> Download the file and upload it to any host (Netlify, Hostinger, GitHub Pages), or ask Claude to publish it to your domain using the connected Netlify / Hostinger / Wix connectors.</p>
        </div>
        <div>
          <div className="device-bar">
            <button className={`chip ${device === '100%' ? 'on' : ''}`} onClick={() => setDevice('100%')}><Monitor size={14} /> Desktop</button>
            <button className={`chip ${device === '768px' ? 'on' : ''}`} onClick={() => setDevice('768px')}><Tablet size={14} /> Tablet</button>
            <button className={`chip ${device === '390px' ? 'on' : ''}`} onClick={() => setDevice('390px')}><Smartphone size={14} /> Phone</button>
          </div>
          <iframe title="Website preview" className="site-frame" style={{ width: device, display: 'block', margin: '0 auto' }} srcDoc={html} />
        </div>
      </div>
    </>
  );
}
