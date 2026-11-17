import type { DB } from './types';
import { money } from './calc';

/** Photos kept on this server (/api/files/…) need the full address on the published website. */
const abs = (u: string) => (u.startsWith('/') && typeof window !== 'undefined' ? window.location.origin + u : u);

const esc = (s = '') => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
export const THEMES: Record<string, { name: string; bg: string; ink: string; accent: string; dark: string; soft: string }> = {
  walnut: { name: 'Walnut', bg: '#faf6f0', ink: '#2a1f17', accent: '#a0652f', dark: '#2b1d13', soft: '#f1e6d8' },
  oak: { name: 'Light Oak', bg: '#ffffff', ink: '#1f2933', accent: '#c58b3c', dark: '#3d2b1a', soft: '#f7efe3' },
  charcoal: { name: 'Charcoal', bg: '#161616', ink: '#f2f2f2', accent: '#e0a458', dark: '#0b0b0b', soft: '#222' },
  olive: { name: 'Olive', bg: '#f6f7f2', ink: '#20251c', accent: '#5f7a3a', dark: '#1e2618', soft: '#e7ecdc' },
};

export function buildSite(db: DB) {
  const s = db.settings; const w = s.website; const th = THEMES[w.theme] || THEMES.walnut;
  const products = w.showProducts ? db.items.filter((i) => i.kind === 'product' && i.showOnWebsite) : [];
  const wa = `https://wa.me/${s.whatsapp.replace(/\D/g, '')}?text=${encodeURIComponent('Hello, I would like a quotation.')}`;
  const socials = db.socialAccounts.filter((a) => a.url);
  const api = typeof window !== 'undefined' ? window.location.origin : '';
  const SPECIAL = [
    { id: 'furniture', name: 'Custom Furniture', text: 'Beds, tables, TV units, shelves and office furniture made to your size, wood and finish.' },
    { id: 'kitchens', name: 'Kitchen Cabinets', text: 'Complete kitchens — carcass, shutters, worktops, hardware and installation.' },
    { id: 'wardrobes', name: 'Wardrobes', text: 'Built-in and walk-in wardrobes with sliding or hinged doors and smart interiors.' },
    { id: 'interiors', name: 'Interior Works', text: 'Wall panelling, false ceilings, doors, partitions and complete fit-outs for villas and offices.' },
  ];
  // completed projects with “after” photos
  const done = db.jobs.filter((j) => j.status === 'completed' && (j.photos || []).some((p) => p.kind === 'after')).slice(0, 9);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(s.businessName)} — ${esc(s.city)}</title><meta name="description" content="${esc(s.tagline)}">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600&family=Fraunces:opsz,wght@9..144,700&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box}body{margin:0;font-family:Inter,system-ui,sans-serif;background:${th.bg};color:${th.ink};line-height:1.6}
a{color:inherit}.wrap{max-width:1120px;margin:0 auto;padding:0 20px}
header{position:sticky;top:0;background:${th.bg}ee;backdrop-filter:blur(8px);z-index:9;border-bottom:1px solid ${th.soft}}
header .wrap{display:flex;align-items:center;justify-content:space-between;height:66px;gap:12px}
.logo{font-family:Fraunces,serif;font-size:20px;font-weight:700;text-decoration:none}
nav a{margin-left:20px;text-decoration:none;font-size:15px;opacity:.8;white-space:nowrap}.logo,.btn{white-space:nowrap}nav a:hover{opacity:1}
.btn{display:inline-block;background:${th.accent};color:#fff;padding:13px 24px;border-radius:999px;text-decoration:none;font-weight:600}
.btn.alt{background:transparent;border:2px solid currentColor;color:inherit}
.hero{background:linear-gradient(120deg,${th.dark}e6,${th.dark}99),url('${esc(abs(w.gallery[0] || ''))}') center/cover;color:#fff;padding:120px 0 110px}
.hero h1{font-family:Fraunces,serif;font-size:clamp(34px,6vw,62px);line-height:1.1;margin:0 0 16px;max-width:760px}
.hero p{font-size:19px;max-width:620px;opacity:.9;margin:0 0 28px}.hero .cta{display:flex;gap:12px;flex-wrap:wrap}
section{padding:80px 0}h2{font-family:Fraunces,serif;font-size:clamp(28px,4vw,40px);margin:0 0 12px}.lead{opacity:.75;max-width:640px;margin:0 0 36px}
.grid{display:grid;gap:20px;grid-template-columns:repeat(auto-fit,minmax(230px,1fr))}
.svc{background:${th.soft};padding:26px;border-radius:18px;border-top:4px solid var(--c)}.svc h3{margin:0 0 6px}
.gal{display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(260px,1fr))}.gal img{width:100%;aspect-ratio:4/3;object-fit:cover;border-radius:16px;display:block}
.prod{background:${th.soft};border-radius:18px;overflow:hidden}.prod img{width:100%;aspect-ratio:1;object-fit:cover;display:block}.prod div{padding:16px}.prod b{display:block}.price{color:${th.accent};font-weight:700}
.about{display:grid;gap:40px;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));align-items:center}
.stats{display:flex;gap:30px;flex-wrap:wrap;margin-top:24px}.stats b{display:block;font-size:30px;font-family:Fraunces,serif;color:${th.accent}}
.contact{background:${th.dark};color:#fff}.contact .grid div{background:#ffffff12;padding:22px;border-radius:16px}
footer{background:${th.dark};color:#ffffff99;padding:24px 0;font-size:14px;border-top:1px solid #ffffff14}
.qf{display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));max-width:900px}.qf input,.qf select,.qf textarea{font:inherit;padding:13px 14px;border-radius:12px;border:1px solid #0002;background:#fff;color:#222}.qf textarea,.qf button,.qf p{grid-column:1/-1}.qf button{border:0;cursor:pointer;justify-self:start}
.wa{position:fixed;right:20px;bottom:20px;background:#25d366;color:#fff;width:58px;height:58px;border-radius:50%;display:grid;place-items:center;box-shadow:0 10px 30px -8px #0008;font-size:26px;text-decoration:none}
@media(max-width:900px){nav{display:none}}@media(max-width:700px){.hero{padding:80px 0}}
</style></head><body>
<header><div class="wrap"><a class="logo" href="#">${esc(s.businessName)}</a><nav><a href="#about">About</a><a href="#services">Services</a><a href="#work">Gallery</a>${done.length ? '<a href="#projects">Completed projects</a>' : ''}${products.length ? '<a href="#shop">Shop</a>' : ''}<a href="#contact">Contact</a></nav><a class="btn" href="#quote">Request a quotation</a></div></header>
<div class="hero"><div class="wrap"><h1>${esc(s.tagline)}</h1><p>${esc(w.hero)}</p><div class="cta"><a class="btn" href="${wa}">WhatsApp us</a><a class="btn alt" href="tel:${esc(s.phone)}">Call ${esc(s.phone)}</a></div></div></div>
<section id="services"><div class="wrap"><h2>What we do</h2><p class="lead">From precise CNC cutting to full interior fit-outs — one workshop, one team, one point of contact.</p>
<div class="grid">${SPECIAL.map((x) => `<div class="svc" id="${x.id}" style="--c:${th.accent}"><h3>${x.name}</h3><p style="opacity:.75;margin:0 0 12px">${x.text}</p><a href="#quote" data-svc="${x.name}" style="font-weight:600;color:${th.accent}">Get a price →</a></div>`).join('')}</div>
<div class="grid" style="margin-top:20px">${s.workTypes.filter((t) => !SPECIAL.some((x) => x.name.toLowerCase() === t.name.toLowerCase())).map((t) => `<div class="svc" style="--c:${t.color}"><h3>${esc(t.name)}</h3><p style="opacity:.75;margin:0">${esc(t.fields.slice(0, 3).join(' · '))}</p></div>`).join('')}</div></div></section>
<section id="work" style="background:${th.soft}"><div class="wrap"><h2>Recent work</h2><p class="lead">A few projects from our workshop.</p><div class="gal">${w.gallery.filter(Boolean).map((g) => `<img src="${esc(abs(g))}" alt="Project" loading="lazy">`).join('')}</div></div></section>
${done.length ? `<section id="projects"><div class="wrap"><h2>Completed projects</h2><p class="lead">Finished and installed for our customers.</p><div class="gal">${done.map((j) => { const ph = (j.photos || []).find((p) => p.kind === 'after')!; return `<figure style="margin:0"><img src="${esc(abs(ph.url))}" alt="${esc(j.title)}" loading="lazy"><figcaption style="margin-top:8px;font-weight:600">${esc(j.title)}</figcaption></figure>`; }).join('')}</div></div></section>` : ''}
${products.length ? `<section id="shop"><div class="wrap"><h2>Ready-made products</h2><p class="lead">Available from our showroom. Message us to order.</p><div class="grid">${products.map((p) => `<div class="prod">${p.image ? `<img src="${esc(abs(p.image))}" alt="${esc(p.name)}" loading="lazy">` : ''}<div><b>${esc(p.name)}</b><span style="opacity:.7;font-size:14px">${esc(p.description || '')}</span><div class="price">${money(p.price, s)}</div><a class="btn" style="margin-top:10px;padding:9px 18px;font-size:14px" href="https://wa.me/${s.whatsapp.replace(/\D/g, '')}?text=${encodeURIComponent('I want to order: ' + p.name)}">Order</a></div></div>`).join('')}</div></div></section>` : ''}
<section id="about"><div class="wrap about"><div><h2>About us</h2><p>${esc(w.about)}</p><div class="stats"><div><b>${db.jobs.filter((j) => j.status === 'completed').length + 100}+</b>Projects</div><div><b>${db.staff.filter((x) => x.active).length}</b>Craftsmen</div><div><b>${s.workTypes.length}</b>Services</div></div></div>${w.gallery[1] ? `<img src="${esc(abs(w.gallery[1]))}" alt="" style="width:100%;border-radius:20px">` : ''}</div></section>
<section id="quote"><div class="wrap"><h2>Request a quotation</h2><p class="lead">Tell us what you need — we reply within one working day and the site measurement is free.</p>
<form id="qf" class="qf"><input name="name" placeholder="Your name *" required maxlength="80"><input name="phone" placeholder="Phone / WhatsApp *" required maxlength="30"><input name="email" type="email" placeholder="Email" maxlength="120">
<select name="service"><option value="">What do you need?</option>${[...SPECIAL.map((x) => x.name), ...s.workTypes.map((t) => t.name)].filter((v, i, a) => a.indexOf(v) === i).map((n) => `<option>${esc(n)}</option>`).join('')}<option>Other</option></select>
<input name="location" placeholder="Area / location" maxlength="80"><textarea name="message" placeholder="Sizes, style, timeline…" maxlength="1500" rows="4"></textarea><input name="website" style="display:none" tabindex="-1" autocomplete="off">
<button class="btn" type="submit">Send request</button><p id="qmsg" style="margin:0"></p></form></div></section>
<script>
document.querySelectorAll('[data-svc]').forEach(function(a){a.addEventListener('click',function(){var s=document.querySelector('#qf select');if(s)s.value=a.getAttribute('data-svc')})});
document.getElementById('qf').addEventListener('submit',function(e){e.preventDefault();var f=e.target,b=f.querySelector('button'),m=document.getElementById('qmsg');var d={};new FormData(f).forEach(function(v,k){d[k]=v});d.source=(new URLSearchParams(location.search).get('utm_source'))||'Website';b.disabled=true;m.textContent='Sending…';
fetch(${JSON.stringify(api)}+'/api/public/enquiry',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(d)}).then(function(r){return r.json().then(function(j){if(!r.ok)throw new Error(j.error||'Error');m.textContent='Thank you! We will contact you shortly.';f.reset()})}).catch(function(err){m.textContent=err.message+' — or WhatsApp us.';}).finally(function(){b.disabled=false})});
</script>
<section id="contact" class="contact"><div class="wrap"><h2>Visit or contact us</h2><p class="lead" style="color:#fff">Free site measurement and quotation.</p><div class="grid">
<div><b>Phone</b><br><a href="tel:${esc(s.phone)}">${esc(s.phone)}</a></div><div><b>Email</b><br><a href="mailto:${esc(s.email)}">${esc(s.email)}</a></div><div><b>Workshop</b><br>${esc(s.address)}, ${esc(s.city)}, ${esc(s.country)}</div>
${socials.length ? `<div><b>Follow us</b><br>${socials.map((a) => `<a href="${esc(a.url)}" target="_blank" rel="noopener">${esc(a.platform)}</a>`).join(' · ')}</div>` : ''}</div>
${w.mapUrl ? `<iframe src="${esc(w.mapUrl)}" style="width:100%;height:320px;border:0;border-radius:16px;margin-top:24px" loading="lazy"></iframe>` : ''}</div></section>
<footer><div class="wrap">© ${new Date().getFullYear()} ${esc(s.businessName)}${s.crNumber ? ' · CR ' + esc(s.crNumber) : ''}</div></footer>
<a class="wa" href="${wa}" aria-label="WhatsApp">✆</a></body></html>`;
}
