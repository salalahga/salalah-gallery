// One-time import of the catalogue published on the old belleameoman.com (Hostinger Website Builder).
// Names, brand lines, prices and photos are exactly as they appear on that site (checked 2026-11-18).
import sharp from 'sharp';
import { id } from '../../util.js';
import { saveFile } from './studio.js';

const IMG_DEFAULT = 'https://cdn.zyrosite.com/cdn-cgi/image/format=jpeg,w=1200,fit=scale-down/cdn-ecommerce/store_01J2XQ8XF6VDEKN8HWT6Z7VCEK%2Fassets%2F';
const D1 = 'Indulge in our carefully curated collection of perfumes and fragrances that embody elegance, sophistication, and allure. Each scent tells a unique story, crafted to enhance your natural charm and captivate the senses.';
const D2 = 'Indulge in our exquisite fragrances that embody elegance, sophistication, and allure. Each scent tells a unique story, enhancing your natural charm and captivating the senses.';

export const LEGACY_PRODUCTS = [
  { name: 'Leo Hebrew Collection', brand: null, price: 15750, file: '1722416327300-WhatsApp%20Image%202024-07-31%20at%2012.13.33%20PM.jpeg', old: '/leo-hebrew-collection' },
  { name: 'Luxury Edition Magic', brand: 'Linea De Bella', price: 20000, file: '1722414432052-WhatsApp%20Image%202024-07-30%20at%206.07.06%20PM.jpeg', old: '/luxury-edition-magic' },
  { name: 'Laid Back Girl', brand: 'Paris', price: 15750, file: '1722414997201-WhatsApp%20Image%202024-07-31%20at%2012.13.29%20PM.jpeg', old: '/captivating-fragrances-collection', description: D1 },
  { name: 'Sensu', brand: null, price: 11025, file: '1722415096908-WhatsApp%20Image%202024-07-31%20at%2012.13.30%20PM.jpeg', old: '/captivating-fragrances-collection-2', description: D2 },
  { name: 'Sports Homme', brand: 'Luxe', price: 13650, file: '1722415156438-WhatsApp%20Image%202024-07-31%20at%2012.13.30%20PM%20(1).jpeg', old: '/captivating-fragrances-collection-3', description: D2 },
  { name: '3D Emperor', brand: 'Luxe', price: 14700, file: '1722415212220-WhatsApp%20Image%202024-07-31%20at%2012.13.31%20PM.jpeg', old: '/captivating-fragrances-for-beautiful-souls', description: D1 },
  { name: 'Signature Collection Pantheon', brand: 'Pantheon', price: 8400, file: '1722415267401-WhatsApp%20Image%202024-07-31%20at%2012.13.31%20PM%20(1).jpeg', old: '/captivating-fragrance-collection-2', description: D2 },
  { name: 'Signature Collection Charonne', brand: 'Charonne', price: 8400, file: '1722415392820-WhatsApp%20Image%202024-07-31%20at%2012.13.31%20PM%20(2).jpeg', old: '/captivating-fragrances-collection-4', description: D1 },
];

async function brandId(q, name) {
  if (!name) return null;
  const b = await q.one('SELECT id FROM brands WHERE lower(name) = lower($1)', [name]);
  if (b) return b.id;
  const bid = id('brd_');
  await q('INSERT INTO brands (id, name) VALUES ($1,$2)', [bid, name]);
  return bid;
}

async function photo(q, it, fetchImpl) {
  const r = await fetchImpl(it.url ? (process.env.LEGACY_IMG_BASE ? process.env.LEGACY_IMG_BASE + it.url.split('/').pop() : it.url) : (process.env.LEGACY_IMG_BASE || IMG_DEFAULT) + it.file);
  if (!r.ok) throw new Error(`photo download failed (${r.status})`);
  const buf = await sharp(Buffer.from(await r.arrayBuffer())).rotate().jpeg({ quality: 90 }).toBuffer();
  return `/api/files/${await saveFile(q, buf, 'image/jpeg', decodeURIComponent(it.file || it.url.split('/').pop()))}`;
}

/** Creates the old-site products that are not in the catalogue yet (matched by name). Safe to run again. */
export async function importLegacy(db, { saveVariant, productFields, fetchImpl = fetch, items = LEGACY_PRODUCTS }) {
  const q = db.query;
  const created = []; const skipped = []; const failed = [];
  for (const it of items) {
    if (await q.one('SELECT id FROM products WHERE lower(name) = lower($1) AND active', [it.name])) { skipped.push(it.name); continue; }
    try {
      const imageUrl = await photo(q, it, fetchImpl);
      const pid = await db.tx(async (tq) => {
        const pid = id('prd_');
        const b = { name: it.name, brandId: await brandId(tq, it.brand), description: it.description || null, concentration: it.concentration || null, imageUrl, webVisible: true, active: true };
        await tq(`INSERT INTO products (name, name_ar, brand_id, category_id, description, description_ar, gender, concentration, notes_top, notes_heart, notes_base, image_url, web_visible, active, id, is_test)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,false)`, [...productFields(b), pid]);
        await saveVariant(tq, pid, { label: it.sizeMl ? null : 'Standard', sizeMl: it.sizeMl || null, retailPrice: it.price || 0, webPrice: it.price || null, openingQty: 0 }, null, { perms: {} }, b);
        return pid;
      });
      created.push({ id: pid, name: it.name, price: it.price });
    } catch (e) { failed.push({ name: it.name, error: e.message }); }
  }
  return { created, skipped, failed };
}

/**
 * Owner-requested: put the imported old-site products on the website through the normal content workflow
 * (website content → approved by the owner account → published). Products already on the website are skipped.
 */
export async function publishLegacy(db, { items = LEGACY_PRODUCTS } = {}) {
  const q = db.query;
  const E = await import('./engine.js');
  const owner = await q.one("SELECT id, name, role FROM users WHERE role = 'owner' AND active ORDER BY created_at LIMIT 1");
  if (!owner) throw new Error('No owner account');
  const ctx = { user: owner, can: () => true };
  const published = []; const skipped = []; const failed = [];
  for (const it of items) {
    const p = await q.one('SELECT id, web_external_id FROM products WHERE lower(name) = lower($1) AND active', [it.name]);
    if (!p) { failed.push({ name: it.name, error: 'not in the catalogue' }); continue; }
    if (p.web_external_id) { skipped.push(it.name); continue; }
    try {
      let c = await q.one(`SELECT id, status FROM mkt_content WHERE product_id = $1 AND kind = 'web_product' AND status NOT IN ('published', 'archived') ORDER BY created_at DESC LIMIT 1`, [p.id]);
      if (!c) {
        const r = await E.buildPackage(q, { productId: p.id, kinds: ['web_product'], user: owner });
        c = await q.one('SELECT id, status FROM mkt_content WHERE id = ANY($1) LIMIT 1', [r.created]);
        if (!c) c = await q.one(`SELECT id, status FROM mkt_content WHERE product_id = $1 AND kind = 'web_product' AND status NOT IN ('published', 'archived') ORDER BY created_at DESC LIMIT 1`, [p.id]);
      }
      if (!['approved', 'scheduled'].includes(c.status)) await E.transition(q, c.id, 'approve', { ...ctx, note: 'Owner asked to move the old website catalogue to the new shop' });
      const done = await E.publish(q, c.id, ctx);
      published.push({ name: it.name, url: done.external_url });
    } catch (e) { failed.push({ name: it.name, error: e.message }); }
  }
  return { published, skipped, failed };
}

// Designer perfumes the owner sent for the website gallery (photos already in the website media library).
// They come in without a price: the owner sets it in Website & SEO → Set price, then adds them to the shop.
const W = 'https://prosperous-white-anteater-57.hostingersite.com/wp-content/uploads/2026/11/gallery-';
export const GALLERY_PRODUCTS = [
  { name: 'Déclaration', brand: 'Cartier', concentration: 'Parfum', sizeMl: 50, price: 0, url: W + 'cartier-declaration-parfum.jpg' },
  { name: 'La Panthère', brand: 'Cartier', concentration: 'Parfum', sizeMl: null, price: 0, url: W + 'cartier-la-panthere-parfum.jpg' },
  { name: 'Baiser Volé', brand: 'Cartier', concentration: 'EDP', sizeMl: 100, price: 0, url: W + 'cartier-baiser-vole-edp.jpg' },
  { name: 'Eros', brand: 'Versace', concentration: 'EDP', sizeMl: null, price: 0, url: W + 'versace-eros-edp.jpg' },
  { name: 'The One', brand: 'Dolce & Gabbana', concentration: 'EDP', sizeMl: null, price: 0, url: W + 'dolce-gabbana-the-one-edp.jpg' },
  { name: 'Black Opium', brand: 'Yves Saint Laurent', concentration: 'EDP', sizeMl: null, price: 0, url: W + 'ysl-black-opium.jpg' },
  { name: 'The Only One', brand: 'Dolce & Gabbana', concentration: 'EDP', sizeMl: null, price: 0, url: W + 'dolce-gabbana-the-only-one.jpg' },
  { name: 'Crystal Noir', brand: 'Versace', concentration: 'EDT', sizeMl: 30, price: 0, url: W + 'versace-crystal-noir-edt.jpg' },
  { name: 'Libre', brand: 'Yves Saint Laurent', concentration: null, sizeMl: null, price: 0, url: W + 'ysl-libre.jpg' },
  { name: 'CK Be', brand: 'Calvin Klein', concentration: 'EDT', sizeMl: 200, price: 0, url: W + 'ck-be-edt.jpg' },
  { name: 'Black Opium (pink)', brand: 'Yves Saint Laurent', concentration: null, sizeMl: null, price: 0, url: W + 'ysl-black-opium-pink.jpg' },
  { name: 'Women', brand: 'Calvin Klein', concentration: 'EDP', sizeMl: null, price: 0, url: W + 'calvin-klein-women-edp.jpg' },
  { name: 'Sauvage', brand: 'Dior', concentration: 'EDP', sizeMl: null, price: 0, url: W + 'dior-sauvage-edp.jpg' },
  { name: 'Hypnotic Poison', brand: 'Dior', concentration: 'EDP', sizeMl: null, price: 0, url: W + 'dior-hypnotic-poison-edp.jpg' },
];
