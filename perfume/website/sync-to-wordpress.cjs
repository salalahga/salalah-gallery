const { chromium } = require('playwright');
const fs = require('fs'); const path = require('path');
const B = 'https://prosperous-white-anteater-57.hostingersite.com';
const [pwFile, W] = process.argv.slice(2);
(async () => {
  const b = await chromium.launch();
  const p = await (await b.newContext()).newPage();
  await p.goto(B + '/wp-login.php'); await p.fill('#user_login', 'belleame_admin'); await p.fill('#user_pass', fs.readFileSync(pwFile, 'utf8').trim());
  await Promise.all([p.waitForNavigation({ timeout: 60000 }), p.click('#wp-submit')]);
  await p.goto(B + '/wp-admin/post-new.php?post_type=page', { waitUntil: 'domcontentloaded' });
  const nonce = await p.evaluate(() => window.wpApiSettings?.nonce);
  if (!nonce) throw new Error('no REST nonce');
  const api = async (method, route, body, raw) => {
    const res = await p.evaluate(async ({ url, method, nonce, body, raw }) => {
      const headers = { 'X-WP-Nonce': nonce };
      let data;
      if (raw) { Object.assign(headers, raw.headers); data = Uint8Array.from(atob(raw.b64), (c) => c.charCodeAt(0)); }
      else if (body) { headers['Content-Type'] = 'application/json'; data = JSON.stringify(body); }
      const r = await fetch(url, { method, headers, body: data, credentials: 'include' });
      return { status: r.status, text: await r.text() };
    }, { url: B + '/wp-json/' + route, method, nonce, body, raw: raw ? { headers: raw.headers, b64: Buffer.from(raw.data).toString('base64') } : null });
    let j; try { j = JSON.parse(res.text); } catch { j = res.text; }
    if (res.status >= 300) throw new Error(`${method} ${route} ${res.status} ${res.text.slice(0, 300)}`);
    return j;
  };
  // 1. photos → media library (reuse by slug)
  const media = {};
  for (const f of ['shop-front', 'french-perfumes', 'arabic-perfumes', 'gift-boxes']) {
    const ex = await api('GET', `wp/v2/media?search=belleame-v2-${f}&per_page=5`);
    let m = ex.find((x) => x.slug === `belleame-v2-${f}`);
    if (!m) m = await api('POST', 'wp/v2/media', null, { headers: { 'Content-Type': 'image/jpeg', 'Content-Disposition': `attachment; filename="belleame-v2-${f}.jpg"` }, data: fs.readFileSync(path.join(W, 'belleame-theme/assets', f + '.jpg')) });
    media[f] = m.source_url; console.log('media', f, m.id);
  }
  const fix = (s) => s.replace(/\/wp-content\/themes\/belleame\/assets\/(shop-front|french-perfumes|arabic-perfumes|gift-boxes)\.jpg/g, (_, k) => media[k]);
  // 2. templates / parts (saved as customisations of the active theme)
  for (const [kind, slug, file] of [['templates', 'front-page', 'belleame-theme/templates/front-page.html'], ['template-parts', 'header', 'belleame-theme/parts/header.html'], ['template-parts', 'footer', 'belleame-theme/parts/footer.html']]) {
    const content = fix(fs.readFileSync(path.join(W, file), 'utf8'));
    const id = `belleame//${slug}`;
    let ok;
    try { ok = await api('POST', `wp/v2/${kind}/${encodeURIComponent(id)}`, { content }); }
    catch (e) { if (!/404|rest_template_not_found/.test(e.message)) throw e; ok = await api('POST', `wp/v2/${kind}`, { slug, theme: 'belleame', content, ...(kind === 'template-parts' ? { area: slug } : {}) }); }
    console.log(kind, slug, ok.id, ok.source);
  }
  // 3. About page
  const about = fix(fs.readFileSync(path.join(W, 'pages/about.html'), 'utf8'));
  const pages = await api('GET', 'wp/v2/pages?slug=about&status=any');
  const pg = pages[0] ? await api('POST', `wp/v2/pages/${pages[0].id}`, { title: 'About us', content: about, status: 'publish' }) : await api('POST', 'wp/v2/pages', { title: 'About us', slug: 'about', content: about, status: 'publish' });
  console.log('about', pg.id, pg.link);
  // 4. site tagline (old site's) 
  const st = await api('POST', 'wp/v2/settings', { description: 'The place that compels all perfume lovers — Salalah, Oman' });
  console.log('tagline', st.description);
  await b.close();
})().catch((e) => { console.error(e.message); process.exit(1); });
