// Website gallery: every finished image from the Studio gallery goes to the WordPress media library
// once, and a "Gallery" page shows them all. Run again after new images are made: only new ones upload.
import * as P from './providers.js';
import { loadFile } from './studio.js';

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export async function publishGallery(db) {
  const q = db.query;
  const assets = await q(`SELECT a.id, a.file_id, a.title, a.format, a.params, p.name AS product, b.name AS brand
    FROM mkt_assets a LEFT JOIN products p ON p.id = a.product_id LEFT JOIN brands b ON b.id = p.brand_id
    WHERE a.kind = 'image' AND a.status = 'ready' AND a.source <> 'cutout' AND a.file_id IS NOT NULL ORDER BY a.created_at DESC`);
  let uploaded = 0; const failed = [];
  const items = [];
  for (const a of assets) {
    const params = a.params || {};
    const label = [a.brand, a.product].filter(Boolean).join(' ') || a.title || 'Belle Âme';
    if (!params.wpMediaId) {
      try {
        const f = await loadFile(q, a.file_id);
        const ext = f.mime === 'image/png' ? 'png' : f.mime === 'image/webp' ? 'webp' : 'jpg';
        const m = await P.websiteMedia(q, f.buf, f.mime, `belleame-${a.id}.${ext}`, { alt: label, ref: a.id });
        params.wpMediaId = m.id; params.wpMediaUrl = m.source_url;
        await q('UPDATE mkt_assets SET params = $2 WHERE id = $1', [a.id, params]);
        uploaded++;
      } catch (e) { failed.push({ id: a.id, error: e.message }); continue; }
    }
    items.push({ id: params.wpMediaId, url: params.wpMediaUrl, label });
  }
  if (!items.length) return { total: 0, uploaded, failed, url: null };
  const imgs = items.map((i) => `<!-- wp:image {"id":${Number(i.id)},"sizeSlug":"large","linkDestination":"media"} -->
<figure class="wp-block-image size-large"><a href="${esc(i.url)}"><img src="${esc(i.url)}" alt="${esc(i.label)}" class="wp-image-${Number(i.id)}"/></a><figcaption class="wp-element-caption">${esc(i.label)}</figcaption></figure>
<!-- /wp:image -->`).join('\n');
  const content = `<!-- wp:paragraph {"align":"center"} -->
<p class="has-text-align-center">Our perfumes, offers and new arrivals — from the Belle Âme studio in Salalah.</p>
<!-- /wp:paragraph -->
<!-- wp:gallery {"columns":3,"linkTo":"media","sizeSlug":"large"} -->
<figure class="wp-block-gallery has-nested-images columns-3 is-cropped">${imgs}</figure>
<!-- /wp:gallery -->`;
  const existing = await P.website(q, 'wp_find_page', 'GET', 'wp/v2/pages?slug=gallery&status=publish,draft,private', null, 'gallery');
  const page = existing?.[0]
    ? await P.website(q, 'wp_update_page', 'POST', `wp/v2/pages/${existing[0].id}`, { title: 'Gallery', content, status: 'publish' }, 'gallery')
    : await P.website(q, 'wp_create_page', 'POST', 'wp/v2/pages', { title: 'Gallery', slug: 'gallery', content, status: 'publish' }, 'gallery');
  return { total: items.length, uploaded, failed, url: page.link };
}
