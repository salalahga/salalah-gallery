import { useEffect, useState } from 'react';
import { useRoute, go } from '../core/router';
import { Plus, Trash2, ChevronLeft, ChevronRight, Copy, ExternalLink, Sparkles, Users } from 'lucide-react';
import { store, useDB, today } from '../core/store';
import type { SocialAccount, SocialPost } from '../core/types';
import { statusMeta, lookup } from '../core/helpers';
import { Modal, Field, PageHeader, Badge, Empty, Tabs, Stat, toast, confirmDelete } from '../components/ui';
import { useT } from '../core/i18n';

export const PLATFORMS: Record<string, { color: string; short: string; share?: (text: string, url: string) => string }> = {
  Instagram: { color: '#d62976', short: 'IG' },
  Facebook: { color: '#1877f2', short: 'f', share: (_t, u) => `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(u)}` },
  'WhatsApp Business': { color: '#25d366', short: 'WA', share: (t) => `https://wa.me/?text=${encodeURIComponent(t)}` },
  TikTok: { color: '#111111', short: 'TT' },
  YouTube: { color: '#ff0000', short: 'YT' },
  'X (Twitter)': { color: '#000000', short: 'X', share: (t) => `https://twitter.com/intent/tweet?text=${encodeURIComponent(t)}` },
  LinkedIn: { color: '#0a66c2', short: 'in', share: (_t, u) => `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(u)}` },
  Snapchat: { color: '#f7d000', short: 'SC' },
  'Google Business': { color: '#4285f4', short: 'G' },
};
const Pf = ({ p }: { p: string }) => <span className="pf-dot" style={{ background: PLATFORMS[p]?.color || '#888' }}>{PLATFORMS[p]?.short || p[0]}</span>;
const TAGS = '#carpentry #woodwork #cnc #interiordesign #furniture #kitchen #wardrobe #salalah #oman #madeinoman';

export default function Social() {
  const db = useDB(); const s = db.settings; const L = lookup(db); const t = useT();
  const [tab, setTab] = useState<'calendar' | 'posts' | 'accounts'>('calendar');
  const [month, setMonth] = useState(today().slice(0, 7));
  const [post, setPost] = useState<Partial<SocialPost> | null>(null);
  const [acc, setAcc] = useState<Partial<SocialAccount> | null>(null);
  const shift = (n: number) => { const d = new Date(month + '-01T00:00:00'); d.setMonth(d.getMonth() + n); setMonth(d.toISOString().slice(0, 7)); };
  const first = new Date(month + '-01T00:00:00'); const start = new Date(first); start.setDate(1 - first.getDay());
  const cells = Array.from({ length: 42 }, (_, i) => { const d = new Date(start); d.setDate(start.getDate() + i); return d.toISOString().slice(0, 10); });
  const savePost = () => { if (!post?.title) return toast('Give the post a title'); store.upsert('socialPosts', post as SocialPost); setPost(null); toast('Post saved'); };
  const saveAcc = () => { if (!acc?.platform || !acc.handle) return toast('Platform and handle required'); store.upsert('socialAccounts', acc as SocialAccount); setAcc(null); toast('Account connected'); };
  const { params } = useRoute();
  useEffect(() => {
    if (params.new !== 'photo') return;
    let shared: { url?: string; jobId?: string } = {};
    try { shared = JSON.parse(sessionStorage.getItem('ww-share-photo') || '{}'); sessionStorage.removeItem('ww-share-photo'); } catch { /* */ }
    const base: Partial<SocialPost> = { date: today(), status: 'draft', platforms: ['Instagram', 'Facebook'], caption: '', image: shared.url };
    setPost(base);
    if (shared.jobId) setTimeout(() => fromJob(shared.jobId!, base), 0);
    go('social');
  }, [params.new]); // eslint-disable-line
  const fromJob = (jobId: string, base?: Partial<SocialPost>) => {
    const j = L.job(jobId); if (!j) return; const w = L.workType(j.workTypeId);
    const lines = Object.entries(j.details).filter(([, v]) => v).slice(0, 3).map(([k, v]) => `▫️ ${k}: ${v}`).join('\n');
    setPost({ ...(base || post), jobId, title: j.title, caption: `✨ Just finished: ${j.title}!\n${w ? `Our ${w.name.toLowerCase()} team delivered another quality project.` : ''}\n${lines}\n\n📍 ${s.city} · 📞 ${s.phone}\n💬 DM or WhatsApp us for a free quotation.\n\n${TAGS}` });
  };
  const followers = db.socialAccounts.reduce((n, a) => n + (a.followers || 0), 0);
  const upcoming = db.socialPosts.filter((p) => p.date >= today() && p.status !== 'posted').length;
  const siteUrl = window.location.origin;

  return (
    <>
      <PageHeader title={t('Social Media')} sub="Plan posts, write captions, and share to all your platforms from one place."
        actions={<><Tabs value={tab} onChange={setTab} tabs={[{ id: 'calendar', label: 'Calendar' }, { id: 'posts', label: 'Posts', count: db.socialPosts.length }, { id: 'accounts', label: 'Accounts', count: db.socialAccounts.length }]} />
          <button className="btn primary" onClick={() => setPost({ date: today(), status: 'draft', platforms: ['Instagram', 'Facebook'], caption: '' })}><Plus size={16} />New post</button></>} />
      <div className="grid g3 mb">
        <Stat label="Total followers" value={followers.toLocaleString()} icon={<Users size={20} />} tone="violet" sub={`${db.socialAccounts.length} accounts`} />
        <Stat label="Upcoming posts" value={upcoming} icon={<Sparkles size={20} />} tone="blue" />
        <Stat label="Posted" value={db.socialPosts.filter((p) => p.status === 'posted').length} icon={<ExternalLink size={20} />} tone="green" />
      </div>

      {tab === 'calendar' && <div className="card">
        <h3><span className="flex"><button className="icon-btn" onClick={() => shift(-1)}><ChevronLeft size={18} /></button>{first.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}<button className="icon-btn" onClick={() => shift(1)}><ChevronRight size={18} /></button></span></h3>
        <div className="cal">
          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => <div key={d} className="dow">{d}</div>)}
          {cells.map((d) => { const ps = db.socialPosts.filter((p) => p.date === d); return (
            <div key={d} className={`day ${d.slice(0, 7) !== month ? 'out' : ''} ${d === today() ? 'today' : ''}`} onClick={() => setPost({ date: d, status: 'draft', platforms: ['Instagram', 'Facebook'], caption: '' })}>
              <div className="n">{+d.slice(8)}</div>
              {ps.map((p) => <div key={p.id} className="ev" style={{ borderLeftColor: statusMeta[p.status].color }} onClick={(e) => { e.stopPropagation(); setPost({ ...p }); }}>{p.title}</div>)}
            </div>); })}
        </div>
      </div>}

      {tab === 'posts' && <div className="card">{db.socialPosts.length ? <div className="table-wrap"><table>
        <thead><tr><th>Post</th><th>Platforms</th><th>Date</th><th>Status</th></tr></thead>
        <tbody>{[...db.socialPosts].sort((a, b) => b.date.localeCompare(a.date)).map((p) => <tr key={p.id} className="click" onClick={() => setPost({ ...p })}>
          <td><b>{p.title}</b><div className="muted" style={{ maxWidth: 420, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.caption}</div></td>
          <td><div className="flex">{p.platforms.map((x) => <Pf key={x} p={x} />)}</div></td><td>{p.date}</td><td><Badge tone={statusMeta[p.status].tone}>{statusMeta[p.status].label}</Badge></td></tr>)}</tbody></table></div> : <Empty title="No posts planned" />}</div>}

      {tab === 'accounts' && <>
        <div className="grid g3">
          {db.socialAccounts.map((a) => <div key={a.id} className="card" style={{ cursor: 'pointer' }} onClick={() => setAcc({ ...a })}>
            <div className="flex"><Pf p={a.platform} /><b>{a.platform}</b></div>
            <div style={{ margin: '10px 0 4px', fontSize: 17, fontWeight: 600 }}>{a.handle}</div>
            <div className="flex between"><span className="muted">{a.followers ? `${a.followers.toLocaleString()} followers` : '—'}</span>
              <a className="btn sm" href={a.url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}><ExternalLink size={14} />Open</a></div>
          </div>)}
          <button className="card" style={{ cursor: 'pointer', borderStyle: 'dashed', display: 'grid', placeItems: 'center', minHeight: 130, background: 'transparent' }} onClick={() => setAcc({ platform: 'Instagram' })}><span className="flex"><Plus size={18} />Connect account</span></button>
        </div>
        <p className="muted" style={{ marginTop: 14 }}>Tip: for automatic scheduled publishing and analytics, connect a scheduler such as Metricool or Postiz under Settings → Integrations. Until then, use the share buttons in each post.</p>
      </>}

      {post && <Modal open wide title={post.id ? 'Edit post' : 'New post'} onClose={() => setPost(null)} footer={<>
        {post.id && <button className="btn danger ghost" onClick={() => { if (confirmDelete('this post')) { store.remove('socialPosts', post.id!); setPost(null); } }}><Trash2 size={15} />Delete</button>}
        <button className="btn ghost" onClick={() => { navigator.clipboard?.writeText(post.caption || ''); toast('Caption copied'); }}><Copy size={15} />Copy caption</button>
        <span className="spacer" /><button className="btn" onClick={() => setPost(null)}>Cancel</button><button className="btn primary" onClick={savePost}>Save</button></>}>
        <div className="grid g-main">
          <div className="form two">
            <Field label="Title" span={3}><input autoFocus value={post.title || ''} onChange={(e) => setPost({ ...post, title: e.target.value })} /></Field>
            <Field label="Date"><input type="date" value={post.date} onChange={(e) => setPost({ ...post, date: e.target.value })} /></Field>
            <Field label="Status"><select value={post.status} onChange={(e) => setPost({ ...post, status: e.target.value as SocialPost['status'] })}>{['idea', 'draft', 'scheduled', 'posted'].map((x) => <option key={x} value={x}>{statusMeta[x].label}</option>)}</select></Field>
            <Field label="Generate caption from a job" span={3}><select value={post.jobId || ''} onChange={(e) => fromJob(e.target.value)}><option value="">— choose a job —</option>{db.jobs.map((j) => <option key={j.id} value={j.id}>{j.code} · {j.title}</option>)}</select></Field>
            <Field label="Caption" span={3}><textarea style={{ minHeight: 150 }} value={post.caption || ''} onChange={(e) => setPost({ ...post, caption: e.target.value })} /></Field>
            <div className="span-3 flex wrap"><button className="btn sm" onClick={() => setPost({ ...post, caption: (post.caption || '') + '\n\n' + TAGS })}>+ Hashtags</button><span className="muted">{(post.caption || '').length} characters</span></div>
            <Field label="Image URL" span={3}><input value={post.image || ''} onChange={(e) => setPost({ ...post, image: e.target.value })} placeholder="https://…" /></Field>
            <Field label="Platforms" span={3}><div className="chips">{Object.keys(PLATFORMS).map((p) => { const on = post.platforms?.includes(p); return <button key={p} type="button" className={`chip ${on ? 'on' : ''}`} onClick={() => setPost({ ...post, platforms: on ? post.platforms!.filter((x) => x !== p) : [...(post.platforms || []), p] })}>{p}</button>; })}</div></Field>
            <div className="span-3"><div className="section-title" style={{ marginBottom: 8 }}>Share now</div><div className="chips">
              {(post.platforms || []).map((p) => { const share = PLATFORMS[p]?.share; const a = db.socialAccounts.find((x) => x.platform === p);
                const href = share ? share(post.caption || '', siteUrl) : a?.url; return href ? <a key={p} className="btn sm" target="_blank" rel="noreferrer" href={href} onClick={() => { navigator.clipboard?.writeText(post.caption || ''); }}><Pf p={p} />{share ? 'Share' : 'Open'} {p}</a> : null; })}
            </div><p className="muted">Caption is copied to clipboard when you open a platform — just paste it.</p></div>
          </div>
          <div><div className="muted" style={{ marginBottom: 6 }}>Preview</div><div className="preview-post">
            <div className="ph"><span className="avatar" style={{ width: 30, height: 30, background: '#7c4a1e', fontSize: 11 }}>{s.businessName[0]}</span>{s.businessName}</div>
            {post.image ? <img src={post.image} alt="" /> : <div style={{ aspectRatio: '1', background: 'linear-gradient(135deg,#f4e6d6,#d9b890)', display: 'grid', placeItems: 'center', color: '#7c4a1e' }}>Image</div>}
            <p>{post.caption || 'Your caption…'}</p></div></div>
        </div>
      </Modal>}

      {acc && <Modal open title={acc.id ? 'Edit account' : 'Connect account'} onClose={() => setAcc(null)} footer={<>
        {acc.id && <button className="btn danger ghost" onClick={() => { if (confirmDelete(acc.handle)) { store.remove('socialAccounts', acc.id!); setAcc(null); } }}><Trash2 size={15} />Remove</button>}
        <span className="spacer" /><button className="btn" onClick={() => setAcc(null)}>Cancel</button><button className="btn primary" onClick={saveAcc}>Save</button></>}>
        <div className="form two">
          <Field label="Platform"><select value={acc.platform} onChange={(e) => setAcc({ ...acc, platform: e.target.value })}>{Object.keys(PLATFORMS).map((p) => <option key={p}>{p}</option>)}</select></Field>
          <Field label="Handle / page name"><input value={acc.handle || ''} onChange={(e) => setAcc({ ...acc, handle: e.target.value })} /></Field>
          <Field label="Profile URL" span={3}><input value={acc.url || ''} onChange={(e) => setAcc({ ...acc, url: e.target.value })} placeholder="https://instagram.com/yourpage" /></Field>
          <Field label="Followers"><input type="number" value={acc.followers || ''} onChange={(e) => setAcc({ ...acc, followers: +e.target.value })} /></Field>
        </div>
      </Modal>}
    </>
  );
}
